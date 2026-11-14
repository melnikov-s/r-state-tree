import { observable, source, isObservable } from "../src";

function object<T extends object>(obj: T = {} as T): Record<string, any> {
	return observable(obj);
}

describe("Source Purity (Unwrap-on-Write)", () => {
	test("assigning an observable to an object property unwraps it in the source", () => {
		const nested = observable({ count: 1 });
		const store = observable({ nested: null as any });

		// Assign observable
		store.nested = nested;

		// 1. Consumer gets the proxy back
		expect(isObservable(store.nested)).toBe(true);
		expect(store.nested).toBe(nested); // Should be the exact same instance

		// 2. Source should contain the RAW data, not the proxy
		const sourceObj = source(store);
		const nestedSource = source(nested);

		expect(isObservable(sourceObj.nested)).toBe(false); // Fails currently (is true)
		expect(sourceObj.nested).toBe(nestedSource);
		expect(sourceObj.nested).not.toBe(nested);
	});

	test("pushing an observable to an array unwraps it in the source", () => {
		const item = observable({ id: 1 });
		const list = observable([] as any[]);

		list.push(item);

		// 1. Consumer gets the proxy back
		expect(isObservable(list[0])).toBe(true);
		expect(list[0]).toBe(item);

		// 2. Source should contain RAW data
		const sourceList = source(list);

		expect(isObservable(sourceList[0])).toBe(false); // Fails currently
		expect(sourceList[0]).toBe(source(item));
	});

	test("setting an observable in a map unwraps it in the source", () => {
		const key = "key";
		const val = observable({ id: 1 });
		const map = observable(new Map());

		map.set(key, val);

		// 1. Consumer gets proxy
		expect(isObservable(map.get(key))).toBe(true);
		expect(map.get(key)).toBe(val);

		// 2. Source should contain RAW data
		const sourceMap = source(map) as Map<any, any>;
		const valSource = source(val);

		expect(isObservable(sourceMap.get(key))).toBe(false); // Fails currently
		expect(sourceMap.get(key)).toBe(valSource);
	});

	test("making an object observable in one store affects another store holding the same raw reference", () => {
		const raw = { id: 1 };

		const store1 = observable({ item: null as any });
		const store2 = observable({ item: null as any });

		// 1. Assign observable wrapper to store1
		// This registers 'raw' in the global administration map
		store1.item = observable(raw);

		// 2. Assign RAW object to store2
		store2.item = raw;

		// Check store1 (Expected to be observable)
		expect(isObservable(store1.item)).toBe(true);
		expect(source(store1.item)).toBe(raw); // Source purity preserved

		// Check store2
		// Desired behavior: Should NOT be observable (Strict Shallow Identity)
		const isStore2ItemObservable = isObservable(store2.item);

		expect(isStore2ItemObservable).toBe(false);
	});
});

describe("Detailed ObjectAdministration behavior", () => {
	test("Property stores raw in source", () => {
		const parent = observable({ child: null as any });
		const rawChild = { name: "child" };
		const obsChild = observable(rawChild);

		parent.child = obsChild;

		expect(parent.child).toBe(obsChild);
		expect(source(parent).child).toBe(rawChild);
		expect(isObservable(source(parent).child)).toBe(false);
	});

	test("Per-object independence", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		const a = observable({ child: null as any });
		const b = observable({ child: null as any });

		a.child = obs;
		b.child = source(obs);

		expect(isObservable(a.child)).toBe(true);
		expect(isObservable(b.child)).toBe(false);
	});

	test("Same raw at two props", () => {
		const raw = { value: 1 };
		const obs = observable(raw);
		const obj = observable({ a: null as any, b: null as any });

		obj.a = obs;
		obj.b = source(obs);

		expect(isObservable(obj.a)).toBe(true);
		expect(isObservable(obj.b)).toBe(false);
	});

	test("Reassignment clears/sets tracking", () => {
		const raw = { value: 1 };
		const obs = observable(raw);
		const obj = observable({ child: null as any });

		obj.child = obs;
		expect(isObservable(obj.child)).toBe(true);

		obj.child = source(obs);
		expect(isObservable(obj.child)).toBe(false);

		obj.child = obs;
		expect(isObservable(obj.child)).toBe(true);
	});

	test("Delete clears tracking", () => {
		const raw = { value: 1 };
		const obs = observable(raw);
		const obj = observable({ child: null as any }) as any;

		obj.child = obs;
		expect(isObservable(obj.child)).toBe(true);

		delete obj.child;
		obj.child = source(obs);
		expect(isObservable(obj.child)).toBe(false);
	});

	test("Initialization does not sanitize user-provided proxies", () => {
		const rawChild = { name: "child" };
		const obsChild = observable(rawChild);

		const obj = observable({ child: obsChild });

		expect(isObservable(obj.child)).toBe(true);
		expect(obj.child).toBe(obsChild);
		expect(source(obj).child).toBe(obsChild);
		expect(isObservable(source(obj).child)).toBe(true);

		// If a user explicitly seeds proxies into the source, structuredClone may throw.
		expect(() => structuredClone(source(obj))).toThrow();
	});

	test("Symbol property ownership + source purity", () => {
		const sym = Symbol("child");
		const rawChild = { name: "child" };
		const obsChild = observable(rawChild);

		const obj = observable({} as Record<PropertyKey, unknown>);

		obj[sym] = obsChild;
		expect(obj[sym]).toBe(obsChild);
		expect(isObservable(obj[sym])).toBe(true);

		expect(source(obj)[sym]).toBe(rawChild);
		expect(isObservable(source(obj)[sym])).toBe(false);

		// Delete clears tracking
		delete obj[sym];
		obj[sym] = rawChild;
		expect(obj[sym]).toBe(rawChild);
		expect(isObservable(obj[sym])).toBe(false);
	});
});
