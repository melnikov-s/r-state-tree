import { effect, observable, source, isObservable } from "../src";

const map = <K = any, V = any>(obj: Map<K, V> = new Map()): Map<K, V> => {
	return observable(obj) as Map<K, V>;
};

const keys = (map: Map<any, any>): any[] => {
	return Array.from(map.keys());
};

const values = (map: Map<any, any>): any[] => {
	return keys(map).map((key) => map.get(key));
};

// Removed: map values are deeply observable - no longer applies with shallow behavior

test("map keys returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const m = map();
	m.set(target, target);

	Array.from(m.keys()).forEach((t) => {
		ran = true;
		// Shallow behavior: keys are NOT wrapped
		expect(isObservable(t)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("map values returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const m = map();
	m.set(target, target);

	Array.from(m.values()).forEach((t) => {
		ran = true;
		// Shallow behavior: values are NOT wrapped
		expect(isObservable(t)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("map forEach returns raw (non-observable) key and value", () => {
	const target = {};
	const m = map();
	m.set(target, target);
	expect(
		m.forEach((v, k) => {
			// Shallow behavior: keys and values are NOT wrapped
			expect(isObservable(k)).toBe(false);
			expect(isObservable(v)).toBe(false);
		})
	);
});

test("map entries returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const m = map();
	m.set(target, target);

	Array.from(m.entries()).forEach(([k, v]) => {
		ran = true;
		// Shallow behavior: keys and values are NOT wrapped
		expect(isObservable(k)).toBe(false);
		expect(isObservable(v)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("map equality for observed and target objects", () => {
	let target = {};
	let m = map();
	m.set(target, target);
	let o = observable(target);
	expect(m.has(o)).toBe(true);

	m = map();
	target = {};
	o = observable(target);
	m.set(o, target);
	expect(m.has(target)).toBe(true);
	m.set(target, target);
	expect(m.size).toBe(1);

	m.delete(target);
	expect(m.size).toBe(0);
});

test("map can store and find observable values", () => {
	const o1 = observable({});
	const o2 = observable({});
	const plain = {};

	const m = map(
		new Map([
			[o1, o1],
			[o2, o2],
			[plain, plain],
		])
	);
	expect(m.has(o1)).toBe(true);
	expect(m.has(o2)).toBe(true);
	expect(m.has(plain)).toBe(true);
	expect(m.size).toBe(3);

	m.delete(o1);
	expect(m.size).toBe(2);
	m.delete(o2);
	expect(m.size).toBe(1);
	m.delete(plain);
	expect(m.size).toBe(0);
});

test("does not overwrite observable values", () => {
	const o1 = observable({});

	const m = map(new Map([[o1, o1]]));
	// If the user seeded the backing Map with proxies, we do not sanitize it.
	expect(source(m).get(o1)).toBe(o1);
	m.set(o1, o1);
	expect(source(m).get(o1)).toBe(o1);
});

test("instanceof Map", () => {
	const m = map();
	expect(m instanceof Map).toBe(true);
});

test("Map is reactive", () => {
	const m = map();

	const target = {};
	let count = 0;

	effect(() => {
		count++;
		m.has(target);
	});

	m.set(target, 1);
	expect(count).toBe(2);
	expect(m.get(target)).toBe(1);
});

test("does not trigger a change when same value is set on map", () => {
	const o1 = observable({ prop: 1 });
	const o2 = observable({ prop: 2 });

	const m = map(
		new Map([
			[o1, o1],
			[o2, o2],
		])
	);

	let count = 0;
	effect(() => {
		m.forEach(() => {});
		count++;
	});
	expect(count).toBe(1);
	// Setting same observable to same key should not trigger change
	m.set(o1, o1);
	expect(count).toBe(1);
	// Setting different value should trigger
	m.set(o1, o2);
	expect(count).toBe(2);
});

test("[mobx-test] initialize with entries", function () {
	const thing = [{ x: 3 }];
	const a = map(
		new Map([
			["a", 1],
			[thing, 2],
		] as any)
	);
	expect(Array.from(a)).toEqual([
		["a", 1],
		[thing, 2],
	]);
});

test("[mobx-test] has should not throw on invalid keys", function () {
	const x = map();
	expect(x.has(undefined)).toBe(false);
	expect(x.has({})).toBe(false);
	expect(x.get({})).toBe(undefined);
	expect(x.get(undefined)).toBe(undefined);
});

test("[mobx-test] map keys should be coerced to strings correctly", () => {
	const m = map();
	m.set(1, true);
	m.delete(1);
	expect(keys(m)).toEqual([]);

	m.set(1, true);
	m.set("1", false);
	m.set(0, true);
	m.set(-0, false);
	expect(Array.from(keys(m))).toEqual([1, "1", 0]);
	expect(m.get(-0)).toBe(false);
	expect(m.get(1)).toBe(true);

	m.delete("1");
	expect(Array.from(keys(m))).toEqual([1, 0]);

	m.delete(1);
	expect(keys(m)).toEqual([0]);

	m.set(true, true);
	expect(m.get("true")).toBe(undefined);
	expect(m.get(true)).toBe(true);
	m.delete(true);
	expect(keys(m)).toEqual([0]);
});

test("[mobx-test] support for ES6 Map", () => {
	const x = new Map();
	x.set("x", 3);
	x.set("y", 2);

	const m = map(x);
	expect(isObservable(m)).toBe(true);
	expect(Array.from(m)).toEqual([
		["x", 3],
		["y", 2],
	]);
});

test("[mobx-test] work with 'toString' key", () => {
	const m = map();
	expect(m.get("toString")).toBe(undefined);
	m.set("toString", "test");
	expect(m.get("toString")).toBe("test");
});

test("[mobx-test] NaN as map key", function () {
	const a = map(new Map([[NaN, 0]]));
	expect(a.has(NaN)).toBe(true);
	expect(a.get(NaN)).toBe(0);
	a.set(NaN, 1);
	a.set(NaN, 2);
	expect(a.get(NaN)).toBe(2);
	expect(a.size).toBe(1);
});

test("[mobx-test] toStringTag", () => {
	const x = map(new Map(Object.entries({ x: 1, y: 2 })));
	expect(x[Symbol.toStringTag]).toBe("Map");
	expect(Object.prototype.toString.call(x)).toBe("[object Map]");
});
