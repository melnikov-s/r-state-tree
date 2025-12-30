import { effect, observable, reaction, source, isObservable } from "../src";

const map = <K = any, V = any>(obj: Map<K, V> = new Map()): Map<K, V> => {
	return observable(obj) as Map<K, V>;
};

const weakMap = <K extends object = any, V = any>(
	obj: WeakMap<K, V> = new WeakMap()
): WeakMap<K, V> => {
	return observable(obj) as WeakMap<K, V>;
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

test("WeakMap is reactive", () => {
	const m = weakMap();

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

test("WeakMap with function key is reactive", () => {
	const m = weakMap();
	const fnKey = () => {};
	const obsVal = observable({ a: 1 });
	let count = 0;

	effect(() => {
		count++;
		m.get(fnKey);
	});

	m.set(fnKey, obsVal);
	expect(count).toBe(2);
	// Should return the proxy because it was explicitly assigned an observable
	expect(isObservable(m.get(fnKey))).toBe(true);
	expect(m.get(fnKey)).toBe(obsVal);
});

test("instanceof WeakMap", () => {
	const m = weakMap();
	expect(m instanceof WeakMap).toBe(true);
});

test("WeakMap does not report to have Map methods", () => {
	const m = weakMap();
	expect("size" in m).toBe(false);
	expect((m as any).size).toBe(undefined);
	expect("forEach" in m).toBe(false);
	expect((m as any).forEach).toBe(undefined);
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
	const propValues = [];
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

test("[mobx-test] has should not throw on invalid keys", function () {
	const x = map();
	expect(x.has(undefined)).toBe(false);
	expect(x.has({})).toBe(false);
	expect(x.get({})).toBe(undefined);
	expect(x.get(undefined)).toBe(undefined);
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

test("[mobx-test] can iterate maps", () => {
	const x = map();
	const y = [];
	const d = reaction(
		() => Array.from(x),
		(items) => y.push(items)
	);

	y.push(Array.from(x));
	x.set("a", "A");
	x.set("b", "B");
	expect(y).toEqual([
		[],
		[["a", "A"]],
		[
			["a", "A"],
			["b", "B"],
		],
	]);
	d();
});

function iteratorToArray(it) {
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

test("[mobx-test] can iterate map - entries", () => {
	const x = map();
	const y = [];
	const d = reaction(
		() => iteratorToArray(x.entries()),
		(items) => y.push(items)
	);

	y.push(iteratorToArray(x.entries()));
	x.set("a", "A");
	x.set("b", "B");
	expect(y).toEqual([
		[],
		[["a", "A"]],
		[
			["a", "A"],
			["b", "B"],
		],
	]);
	d();
});

test("[mobx-test] can iterate map - keys", () => {
	const x = map();
	const y = [];
	const d = reaction(
		() => iteratorToArray(x.keys()),
		(items) => y.push(items)
	);

	y.push(iteratorToArray(x.keys()));
	x.set("a", "A");
	x.set("b", "B");
	expect(y).toEqual([[], ["a"], ["a", "b"]]);
	d();
});

test("[mobx-test] can iterate map - values", () => {
	const x = map();
	const y = [];
	const d = reaction(
		() => iteratorToArray(x.values()),
		(items) => y.push(items)
	);

	y.push(iteratorToArray(x.values()));
	x.set("a", "A");
	x.set("b", "B");
	expect(y).toEqual([[], ["A"], ["A", "B"]]);
	d();
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

test("[mobx-test] maps.values, keys and maps.entries are iterables", () => {
	const x = map(new Map(Object.entries({ x: 1, y: 2 })));
	expect(Array.from(x.entries())).toEqual([
		["x", 1],
		["y", 2],
	]);
	expect(Array.from(x.values())).toEqual([1, 2]);
	expect(Array.from(x.keys())).toEqual(["x", "y"]);
});

test("[mobx-test] toStringTag", () => {
	const x = map(new Map(Object.entries({ x: 1, y: 2 })));
	expect(x[Symbol.toStringTag]).toBe("Map");
	expect(Object.prototype.toString.call(x)).toBe("[object Map]");
});

test("[mobx-test] map.size is reactive", () => {
	const m = map();
	const sizes = [];

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
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

test("[mobx-test] iterators should be resilient to concurrent delete operation", () => {
	function testIterator(method) {
		const m = map(
			new Map([
				[1, 1],
				[2, 2],
				[3, 3],
			])
		);
		const expectedMap = map(
			new Map([
				[1, 1],
				[2, 2],
				[3, 3],
			])
		);
		for (const entry of m[method]()) {
			const key = Array.isArray(entry) ? entry[0] : entry;
			const deleted1 = m.delete(key);
			const deleted2 = expectedMap.delete(key);
			expect(deleted1).toBe(true);
			expect(deleted2).toBe(true);
			expect(m.size).toBe(expectedMap.size);
			expect(Array.from(m)).toEqual(Array.from(expectedMap));
		}
	}

	testIterator("keys");
	testIterator("values");
	testIterator("entries");
});

describe("Parent Ownership (Strict Shallow)", () => {
	test("same source in two maps should have independent observability", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		// Map A gets the observable as value
		const mapA = map<string, any>();
		mapA.set("key", obs);

		// Map B gets the raw source as value
		const mapB = map<string, any>();
		mapB.set("key", source(obs));

		// Map A should return the observable proxy
		expect(isObservable(mapA.get("key"))).toBe(true);
		expect(mapA.get("key")).toBe(obs);

		// Map B should return the raw object (NOT the observable)
		expect(isObservable(mapB.get("key"))).toBe(false);
		expect(mapB.get("key")).toBe(raw);
	});

	test("observable assignment is tracked per-key", () => {
		const raw1 = { value: 1 };
		const raw2 = { value: 2 };
		const obs1 = observable(raw1);

		const m = map<string, any>();
		m.set("a", obs1); // Observable at key "a"
		m.set("b", raw2); // Raw at key "b"

		expect(isObservable(m.get("a"))).toBe(true);
		expect(isObservable(m.get("b"))).toBe(false);
	});

	test("source in map allows structuredClone", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		const m = map<string, any>();
		m.set("key", source(obs)); // Set the raw source

		// Should NOT throw - it's a plain object
		expect(() => structuredClone(m.get("key"))).not.toThrow();
	});

	test("source map contains raw values not proxies", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		const m = map<string, any>();
		m.set("key", obs);

		// The source map should contain the raw value
		const sourceMap = source(m);
		expect(isObservable(sourceMap.get("key"))).toBe(false);
	});
});

describe("Detailed Map behavior", () => {
	describe("Basic ownership + purity", () => {
		test("Value stores raw in source", () => {
			const m = map<string, any>();
			const raw = { id: 1 };
			const obs = observable(raw);
			m.set("k", obs);

			expect(m.get("k")).toBe(obs);
			expect(source(m).get("k")).toBe(raw);
			expect(isObservable(source(m).get("k"))).toBe(false);
		});

		test("Per-map independence", () => {
			const raw = { id: 1 };
			const obs = observable(raw);
			const mA = map();
			const mB = map();

			mA.set("k", obs);
			mB.set("k", source(obs));

			expect(isObservable(mA.get("k"))).toBe(true);
			expect(isObservable(mB.get("k"))).toBe(false);
		});

		test("Same raw under two keys", () => {
			const raw = { id: 1 };
			const obs = observable(raw);
			const m = map();

			m.set("a", obs);
			m.set("b", source(obs));

			expect(isObservable(m.get("a"))).toBe(true);
			expect(isObservable(m.get("b"))).toBe(false);
		});

		test("Reassignment clears", () => {
			const obs = observable({ id: 1 });
			const m = map();
			m.set("k", obs);

			expect(isObservable(m.get("k"))).toBe(true);
			m.set("k", source(obs));
			expect(isObservable(m.get("k"))).toBe(false);
		});

		test("delete clears tracking", () => {
			const obs = observable({ id: 1 });
			const m = map();
			m.set("k", obs);

			expect(isObservable(m.get("k"))).toBe(true);
			m.delete("k");
			m.set("k", source(obs));
			expect(isObservable(m.get("k"))).toBe(false);
		});

		test("clear clears all tracking", () => {
			const obs = observable({ id: 1 });
			const m = map();
			m.set("a", obs);
			m.clear();
			m.set("a", source(obs));
			expect(isObservable(m.get("a"))).toBe(false);
		});
	});

	describe("Iteration must match get", () => {
		test("for..of m / m.entries()", () => {
			const obs1 = observable({ id: 1 });
			const raw2 = { id: 2 };
			const m = map(
				new Map([
					["a", obs1],
					["b", raw2],
				])
			);

			for (const [k, v] of m) {
				expect(v).toBe(m.get(k));
				expect(isObservable(v)).toBe(k === "a");
			}

			for (const [k, v] of m.entries()) {
				expect(v).toBe(m.get(k));
			}
		});

		test("m.values()", () => {
			const obs1 = observable({ id: 1 });
			const m = map(new Map([["a", obs1]]));
			const vals = Array.from(m.values());
			expect(vals[0]).toBe(obs1);
		});

		test("m.forEach", () => {
			const obs1 = observable({ id: 1 });
			const m = map(new Map([["a", obs1]]));
			m.forEach((v, k) => {
				expect(v).toBe(m.get(k));
				expect(isObservable(v)).toBe(true);
			});
		});
	});

	describe("Observable keys", () => {
		test("Observable object key stored as raw key", () => {
			const rawKey = { id: "key" };
			const keyObs = observable(rawKey);
			const m = map();
			m.set(keyObs, 1);

			expect(source(m).has(rawKey)).toBe(true);
			expect(source(m).has(keyObs)).toBe(false);
			expect(m.get(keyObs)).toBe(1);
			expect(m.get(rawKey)).toBe(1);
		});

		test("Normalization on initialization", () => {
			const rawKey = { id: "key" };
			const keyObs = observable(rawKey);
			const rawVal = { id: "val" };
			const valObs = observable(rawVal);

			const m = map(new Map([[keyObs, valObs]]));
			// Must not sanitize / rewrite user-provided proxy keys/values.
			expect(source(m).has(keyObs)).toBe(true);
			expect(source(m).has(rawKey)).toBe(false);
			expect(source(m).get(keyObs)).toBe(valObs);

			// But observable lookups must work with both raw and proxy keys.
			expect(m.get(keyObs)).toBe(valObs);
			expect(m.get(rawKey)).toBe(valObs);

			// If a user explicitly seeds proxies into the source, structuredClone may throw.
			expect(() => structuredClone(source(m))).toThrow();
		});
	});

	test("Symbol key behavior", () => {
		const m = map<PropertyKey, unknown>();
		const sym = Symbol("k");
		const raw = { id: 1 };
		const obs = observable(raw);

		m.set(sym, obs);

		expect(m.get(sym)).toBe(obs);
		expect(isObservable(m.get(sym))).toBe(true);
		expect(source(m).get(sym)).toBe(raw);
		expect(isObservable(source(m).get(sym))).toBe(false);

		m.delete(sym);
		m.set(sym, raw);
		expect(m.get(sym)).toBe(raw);
		expect(isObservable(m.get(sym))).toBe(false);
	});

	describe("undefined values correctness", () => {
		test("Presence vs absence", () => {
			const m = map();
			m.set("k", undefined);
			expect(m.has("k")).toBe(true);
			expect(m.get("k")).toBe(undefined);
			expect(m.has("missing")).toBe(false);

			const obs = observable({ id: 1 });
			m.set("k", obs);
			expect(isObservable(m.get("k"))).toBe(true);
			m.set("k", undefined);
			// After setting to undefined, it should no longer be tracked as observable
			expect(isObservable(m.get("k"))).toBe(false);
		});
	});

	test("WeakMap basic functional behavior", () => {
		const wm = weakMap();
		const key = {};
		const obs = observable({ id: 1 });
		wm.set(key, obs);

		expect(wm.get(key)).toBe(obs);
		expect(isObservable(wm.get(key))).toBe(true);
	});

	test("WeakMap source purity (value stored unwrapped)", () => {
		const wm = weakMap<object, unknown>();
		const key = {};
		const raw = { id: 1 };
		const obs = observable(raw);

		wm.set(key, obs);

		expect(wm.get(key)).toBe(obs);
		expect(isObservable(wm.get(key))).toBe(true);

		expect(source(wm).get(key)).toBe(raw);
		expect(isObservable(source(wm).get(key))).toBe(false);
	});

	test("WeakMap ownership tracks per-key correctly", () => {
		const wm = weakMap<object, unknown>();
		const key1 = { id: "key1" };
		const key2 = { id: "key2" };
		const raw = { value: 42 };
		const obs = observable(raw);

		wm.set(key1, obs);
		wm.set(key2, source(obs));

		expect(wm.get(key1)).toBe(obs);
		expect(isObservable(wm.get(key1))).toBe(true);

		expect(wm.get(key2)).toBe(raw);
		expect(isObservable(wm.get(key2))).toBe(false);

		expect(source(wm).get(key1)).toBe(raw);
		expect(source(wm).get(key2)).toBe(raw);

		expect(() => structuredClone(source(wm).get(key1))).not.toThrow();
	});

	test("WeakMap delete clears ownership tracking", () => {
		const wm = weakMap<object, unknown>();
		const key = { id: "key" };
		const raw = { value: 42 };
		const obs = observable(raw);

		wm.set(key, obs);
		expect(isObservable(wm.get(key))).toBe(true);

		wm.delete(key);
		wm.set(key, source(obs));
		expect(isObservable(wm.get(key))).toBe(false);
	});

	test("WeakMap reassignment changes ownership", () => {
		const wm = weakMap<object, unknown>();
		const key = { id: "key" };
		const raw = { value: 42 };
		const obs = observable(raw);

		wm.set(key, obs);
		expect(isObservable(wm.get(key))).toBe(true);

		wm.set(key, source(obs));
		expect(isObservable(wm.get(key))).toBe(false);

		wm.set(key, obs);
		expect(isObservable(wm.get(key))).toBe(true);
	});
});

describe("WeakMap GC behavior (requires --expose-gc)", () => {
	const gc = (globalThis as { gc?: () => void }).gc;
	const describeGC = gc ? describe : describe.skip;

	describeGC("WeakMap does not retain keys via tracking", () => {
		test("key can be garbage collected when no strong refs remain", async () => {
			const wm = weakMap<object, unknown>();
			const obs = observable({ value: 42 });
			let collected = false;
			const registry = new FinalizationRegistry(() => {
				collected = true;
			});

			(() => {
				const key = { id: "ephemeral" };
				registry.register(key, undefined);
				wm.set(key, obs);
			})();

			for (let i = 0; i < 10 && !collected; i++) {
				gc!();
				await new Promise((r) => setTimeout(r, 10));
			}

			expect(collected).toBe(true);
		});
	});
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

test("iterator reflects mutations during iteration (Map)", () => {
	const m = map(new Map([["a", 1]]));
	const iterator = m.keys();
	m.set("b", 2);
	expect(iterator.next().value).toBe("a");
	expect(iterator.next().value).toBe("b");
	expect(iterator.next().done).toBe(true);
});

test("iterator reflect deletions during iteration (Map)", () => {
	const m = map(
		new Map([
			["a", 1],
			["b", 2],
		])
	);
	const iterator = m.keys();
	expect(iterator.next().value).toBe("a");
	m.delete("b");
	expect(iterator.next().done).toBe(true);
});

describe("Uninstrumented collection methods (Branding check safety)", () => {
	test("Map properties that are functions should not throw incompatible receiver", () => {
		const m = map(new Map([["a", 1]]));

		// Mock a native-like method on Map prototype
		const originalMethod = (Map.prototype as any).someNewMapMethod;
		(Map.prototype as any).someNewMapMethod = function () {
			if (!(this instanceof Map)) {
				throw new TypeError(
					"Method Map.prototype.someNewMapMethod called on incompatible receiver"
				);
			}
			return Array.from(this.entries());
		};

		try {
			let result;
			expect(() => {
				result = (m as any).someNewMapMethod();
			}).not.toThrow();
			expect(result).toEqual([["a", 1]]);
		} finally {
			delete (Map.prototype as any).someNewMapMethod;
		}
	});

	test("Fluent uninstrumented Map methods should return the proxy", () => {
		const m = map(new Map());

		(Map.prototype as any).fluentMapMethod = function () {
			return this;
		};

		try {
			const result = (m as any).fluentMapMethod();
			expect(result).toBe(m);
		} finally {
			delete (Map.prototype as any).fluentMapMethod;
		}
	});
});
