import { computed, effect, observable } from "../src";
import { getAdministration } from "../src/observables/internal/lookup";
import { MAX_INACTIVE_NODES } from "../src/observables/internal/NodeMap";

function record() {
	return observable<Record<string, number | undefined>>({});
}

test("a cold presence computed refreshes on add and delete", () => {
	const obj = record();
	let runs = 0;
	const hasX = computed(() => {
		runs++;
		return "x" in obj;
	});

	expect(hasX.value).toBe(false);
	obj.y = 1;
	expect(hasX.value).toBe(false);
	expect(runs).toBe(1);
	obj.x = undefined;
	expect(hasX.value).toBe(true);
	obj.x = 1;
	expect(hasX.value).toBe(true);
	expect(runs).toBe(2);
	delete obj.x;
	expect(hasX.value).toBe(false);
	expect(runs).toBe(3);
});

test("presence and value track separately when subscribed and after unsubscribe", () => {
	const obj = record();
	const presence: boolean[] = [];
	const values: (number | undefined)[] = [];
	const hasX = computed(() => "x" in obj);
	const disposePresence = effect(() => {
		presence.push("x" in obj);
	});
	const unsubscribe = hasX.subscribe(() => {});
	const disposeValue = effect(() => {
		values.push(obj.x);
	});
	try {
		obj.x = 1;
		obj.x = 2;
		Object.defineProperty(obj, "x", { value: 3 });
		delete obj.x;
		expect(hasX.value).toBe(false);
		expect(presence).toEqual([false, true, false]);
		expect(values).toEqual([undefined, 1, 2, 3, undefined]);
	} finally {
		disposePresence();
		unsubscribe();
		disposeValue();
	}
	expect(hasX.value).toBe(false);
	Object.defineProperty(obj, "x", { value: 4 });
	expect(hasX.value).toBe(true);
});

test("presence follows observable prototypes and instance shadowing", () => {
	const proto = record();
	const child = record();
	Object.setPrototypeOf(child, proto);
	const hasX = computed(() => "x" in child);

	expect(hasX.value).toBe(false);
	proto.x = 1;
	expect(hasX.value).toBe(true);
	child.x = 1;
	expect(Object.hasOwn(child, "x")).toBe(true);
	delete proto.x;
	expect(hasX.value).toBe(true);
	proto.x = 2;
	delete child.x;
	expect(hasX.value).toBe(true);
	delete proto.x;
	expect(hasX.value).toBe(false);
});

test("Object.prototype names respect actual presence on a null-prototype object", () => {
	const obj = observable(Object.create(null) as { toString?: () => string });
	const present = computed(() => "toString" in obj);
	expect("toString" in record()).toBe(true);
	expect(present.value).toBe(false);
	obj.toString = () => "own";
	expect(present.value).toBe(true);
	delete obj.toString;
	expect(present.value).toBe(false);
});

test("10,000 distinct misses bound per-key metadata without evicting live nodes", () => {
	const obj = record();
	const adm = getAdministration(obj);
	const missing = computed(() => "old" in obj);
	expect(missing.value).toBe(false);
	let runs = 0;
	const dispose = effect(() => {
		void obj.live;
		void ("live" in obj);
		runs++;
	});
	try {
		const liveValue = adm.valuesMap.get("live");
		const livePresence = adm.hasMap.get("live");
		for (let i = 0; i < 10_000; i++) {
			const key = `missing-${i}`;
			void obj[key];
			void (key in obj);
		}
		expect(adm.types.size).toBe(0);
		expect([...adm.valuesMap.keys()]).toHaveLength(MAX_INACTIVE_NODES + 1);
		expect([...adm.hasMap.keys()]).toHaveLength(MAX_INACTIVE_NODES + 1);
		expect(adm.valuesMap.get("live")).toBe(liveValue);
		expect(adm.hasMap.get("live")).toBe(livePresence);
		expect(runs).toBe(1);
		obj.live = 1;
		expect(runs).toBe(2);
		delete obj.live;
		expect(adm.valuesMap.get("live")).toBe(liveValue);
		obj.live = 2;
		expect(runs).toBe(4);
		obj.old = 2;
		expect(missing.value).toBe(true);
	} finally {
		dispose();
	}
});

test("deleting dynamic fields drops their classifications, including inherited methods they shadowed", () => {
	const proto = { method: () => 1 };
	const obj = record();
	Object.setPrototypeOf(obj, proto);
	for (let i = 0; i < 10_000; i++) {
		const key = `field-${i}`;
		obj[key] = i;
		void obj[key];
		delete obj[key];
	}
	expect(getAdministration(obj).types.size).toBe(0);

	const inherited = obj.method;
	expect(inherited).not.toBe(proto.method); // Wrapped as an action.
	Object.defineProperty(obj, "method", { value: 2, configurable: true });
	expect(obj.method).toBe(2);
	delete obj.method;
	expect(obj.method).toBe(inherited);
});
