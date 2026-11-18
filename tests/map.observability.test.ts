import {
	effect,
	observable,
	reaction,
	source,
	computed,
	mount,
	createStore,
	Store,
} from "../src";

const map = <K = any, V = any>(obj: Map<K, V> = new Map()): Map<K, V> => {
	return observable(obj) as Map<K, V>;
};

const keys = (map: Map<any, any>): any[] => {
	return Array.from(map.keys());
};

const values = (map: Map<any, any>): any[] => {
	return keys(map).map((key) => map.get(key));
};

function iteratorToArray(it: any) {
	const res = [];
	while (true) {
		const r = it.next();
		if (!r.done) {
			res.push(r.value);
		} else {
			break;
		}
	}
	return res;
}

test("[mobx-test] observe value", function () {
	const a = map();
	let hasX = false;
	let valueX = undefined;
	let valueY = undefined;

	effect(function () {
		hasX = a.has("x");
	});

	effect(function () {
		valueX = a.get("x");
	});

	effect(function () {
		valueY = a.get("y");
	});

	expect(hasX).toBe(false);
	expect(valueX).toBe(undefined);

	a.set("x", 3);
	expect(hasX).toBe(true);
	expect(valueX).toBe(3);

	a.set("x", 4);
	expect(hasX).toBe(true);
	expect(valueX).toBe(4);

	a.delete("x");
	expect(hasX).toBe(false);
	expect(valueX).toBe(undefined);

	a.set("x", 5);
	expect(hasX).toBe(true);
	expect(valueX).toBe(5);

	expect(valueY).toBe(undefined);
});

test("[mobx-test] observe collections", function () {
	const x = map();
	let ks, vs, entries;

	effect(function () {
		ks = keys(x);
	});
	effect(function () {
		vs = iteratorToArray(x.values());
	});
	effect(function () {
		entries = iteratorToArray(x.entries());
	});

	x.set("a", 1);
	expect(ks).toEqual(["a"]);
	expect(vs).toEqual([1]);
	expect(entries).toEqual([["a", 1]]);

	// should not retrigger:
	ks = null;
	vs = null;
	entries = null;
	x.set("a", 1);
	expect(ks).toEqual(null);
	expect(vs).toEqual(null);
	expect(entries).toEqual(null);

	x.set("a", 2);
	expect(vs).toEqual([2]);
	expect(entries).toEqual([["a", 2]]);

	x.set("b", 3);
	expect(ks).toEqual(["a", "b"]);
	expect(vs).toEqual([2, 3]);
	expect(entries).toEqual([
		["a", 2],
		["b", 3],
	]);

	x.has("c");
	expect(ks).toEqual(["a", "b"]);
	expect(vs).toEqual([2, 3]);
	expect(entries).toEqual([
		["a", 2],
		["b", 3],
	]);

	x.delete("a");
	expect(ks).toEqual(["b"]);
	expect(vs).toEqual([3]);
	expect(entries).toEqual([["b", 3]]);
});

test("[mobx-test] unobserve before delete", function () {
	const propValues: any[] = [];
	const myObservable = observable({
		myMap: source(map()),
	}) as any;
	myObservable.myMap.set("myId", {
		myProp: "myPropValue",
		get myCalculatedProp() {
			if (myObservable.myMap.has("myId"))
				return myObservable.myMap.get("myId").myProp + " calculated";
			return undefined;
		},
	});
	// the error only happens if the value is observed
	effect(function () {
		values(myObservable.myMap).forEach(function (value) {
			propValues.push(value.myCalculatedProp);
		});
	});
	myObservable.myMap.delete("myId");

	expect(propValues).toEqual(["myPropValue calculated"]);
});

test("[mobx-test] map.clear should not be tracked", () => {
	const x = map(new Map(Object.entries({ a: 3 })));
	let c = 0;
	effect(() => {
		c++;
		x.clear();
	});

	expect(c).toBe(1);
	x.set("b", 3);
	expect(c).toBe(1);
});

test("[mobx-test] map.size is reactive", () => {
	const m = map();
	const sizes: any[] = [];

	effect(() => {
		sizes.push(m.size);
	});

	m.set(1, 1);
	m.set(2, 2);
	expect(sizes).toEqual([0, 1, 2]);
});

test("[mobx-test] .forEach() subscribes for key changes", () => {
	const m = map();
	let effectInvocationCount = 0;

	effect(() => {
		effectInvocationCount++;
		m.forEach(() => {});
	});

	m.set(1, 1);
	m.set(2, 2);
	m.delete(1);

	expect(effectInvocationCount).toBe(4);
});

test("[mobx-test] .keys() subscribes for key changes", () => {
	const m = map();
	let effectInvocationCount = 0;

	effect(() => {
		effectInvocationCount++;
		for (const _ of m.keys()) {
		}
	});

	m.set(1, 1);
	m.set(2, 2);
	m.delete(1);

	expect(effectInvocationCount).toBe(4);
});

test("[mobx-test] .values() subscribes for key changes", () => {
	const m = map();
	let effectInvocationCount = 0;

	effect(() => {
		effectInvocationCount++;
		for (const _ of m.values()) {
		}
	});

	m.set(1, 1);
	m.set(2, 2);
	m.delete(1);

	expect(effectInvocationCount).toBe(4);
});

test("[mobx-test] .entries() subscribes for key changes", () => {
	const m = map();
	let effectInvocationCount = 0;

	effect(() => {
		effectInvocationCount++;
		for (const _ of m.entries()) {
		}
	});

	m.set(1, 1);
	m.set(2, 2);
	m.delete(1);

	expect(effectInvocationCount).toBe(4);
});

test("[mobx-test] .entries() subscribes for value changes", () => {
	const m = map(
		new Map([
			[1, 1],
			[2, 2],
			[3, 3],
		])
	);
	let effectInvocationCount = 0;

	effect(() => {
		effectInvocationCount++;
		for (const _ of m.entries()) {
		}
	});

	m.set(1, 11);
	m.set(2, 22);
	m.set(3, 33);

	expect(effectInvocationCount).toBe(4);
});

test("[mobx-test] .values() subscribes for value changes", () => {
	const m = map(
		new Map([
			[1, 1],
			[2, 2],
			[3, 3],
		])
	);
	let effectInvocationCount = 0;

	effect(() => {
		effectInvocationCount++;
		for (const _ of m.values()) {
		}
	});

	m.set(1, 11);
	m.set(2, 22);
	m.set(3, 33);

	expect(effectInvocationCount).toBe(4);
});

test("[mobx-test] .forEach() subscribes for value changes", () => {
	const m = map(
		new Map([
			[1, 1],
			[2, 2],
			[3, 3],
		])
	);
	let effectInvocationCount = 0;

	effect(() => {
		effectInvocationCount++;
		m.forEach(() => {});
	});

	m.set(1, 11);
	m.set(2, 22);
	m.set(3, 33);

	expect(effectInvocationCount).toBe(4);
});

test("[mobx-test] .keys() does NOT subscribe for value changes", () => {
	const m = map(
		new Map([
			[1, 1],
			[2, 2],
			[3, 3],
		])
	);
	let effectInvocationCount = 0;

	effect(() => {
		effectInvocationCount++;
		for (const _ of m.keys()) {
		}
	});

	m.set(1, 11);
	m.set(2, 22);
	m.set(3, 33);

	expect(effectInvocationCount).toBe(1);
});

test("[mobx-test] noop mutations do NOT reportChanges", () => {
	const m = map(
		new Map([
			[1, 1],
			[2, 2],
			[3, 3],
		])
	);
	let effectInvocationCount = 0;

	effect(() => {
		effectInvocationCount++;
		m.forEach(() => {});
	});

	m.set(1, 1);
	m.set(2, 2);
	m.set(3, 3);
	m.delete("NOT IN MAP" as any);

	expect(effectInvocationCount).toBe(1);
});

describe("has() per-key tracking", () => {
	test("has() is reactive inside effects", () => {
		const m = map<string, number>();
		let count = 0;
		let hasX = false;

		effect(() => {
			hasX = m.has("x");
			count++;
		});

		expect(count).toBe(1);
		expect(hasX).toBe(false);

		m.set("x", 1);
		expect(count).toBe(2);
		expect(hasX).toBe(true);

		m.delete("x");
		expect(count).toBe(3);
		expect(hasX).toBe(false);
	});

	test("has() triggers effect only for watched keys after first run", () => {
		const m = map<string, number>();
		let count = 0;

		// Effect watches key "a"
		effect(() => {
			m.has("a");
			count++;
		});

		expect(count).toBe(1);

		// First run subscribes to the per-key atom for "a"
		// Subsequent changes to other keys should not trigger
		m.set("b", 2);
		// Note: After first run, per-key tracking is established for "a"
		// Changes to "b" should not trigger on subsequent runs
		// But on first run, we're subscribed to "a" already
		expect(count).toBe(1); // "b" doesn't trigger effect

		m.set("a", 1);
		expect(count).toBe(2); // "a" triggers effect
	});

	test("has() works correctly with reactions", () => {
		const m = map<string, number>();
		const results: boolean[] = [];

		const dispose = reaction(
			() => m.has("key"),
			(value) => results.push(value)
		);

		// Initially key doesn't exist, but reaction doesn't fire for initial value
		expect(results).toEqual([]);

		m.set("key", 1);
		expect(results).toEqual([true]);

		m.delete("key");
		expect(results).toEqual([true, false]);

		dispose();
	});

	test("Map#set chaining", () => {
		const m = map<string, number>();
		expect(m.set("a", 1)).toBe(m);
		expect(m.set("a", 1).set("b", 2)).toBe(m);
		expect(m.get("a")).toBe(1);
		expect(m.get("b")).toBe(2);
	});
});

describe("Computed Reactivity Bugs", () => {
	test("computed re-subscribe sees updates that happened while unwatched (Map case)", () => {
		const m = observable(new Map<string, number>());
		const c = computed(() => m.get("v") ?? null);

		const seen: (number | null)[] = [];
		const dispose1 = effect(() => {
			seen.push(c.value);
		});
		expect(seen[0]).toBe(null);
		dispose1();

		m.set("v", 123);

		const seen2: (number | null)[] = [];
		const dispose2 = effect(() => {
			seen2.push(c.value);
		});
		expect(seen2[0]).toBe(123);
		dispose2();
	});

	test("same bug via Store @computed getter (Map case)", () => {
		class S extends Store {
			m = observable(new Map<string, number>());

			@computed
			get v() {
				return this.m.get("v") ?? null;
			}
		}

		const s = mount(createStore(S as any)) as any;
		const seen: (number | null)[] = [];
		const dispose1 = effect(() => {
			seen.push(s.v);
		});
		expect(seen[0]).toBe(null);
		dispose1();

		s.m.set("v", 123);

		const seen2: (number | null)[] = [];
		const dispose2 = effect(() => {
			seen2.push(s.v);
		});
		expect(seen2[0]).toBe(123);
		dispose2();
	});
});
