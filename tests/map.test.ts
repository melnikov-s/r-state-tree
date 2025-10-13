import {
	createEffect,
	observable,
	createReaction,
	source,
	isObservable,
} from "../src";

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

test("map values are deeply observable", () => {
	const o = { prop: "value" };
	const m = map();
	let count = 0;
	m.set(o, o);
	expect(isObservable(m.get(o))).toBe(true);

	createEffect(() => {
		m.get(o).prop;
		count++;
	});

	m.get(o).prop = "newValue";
	expect(count).toBe(2);
	expect(o.prop).toBe("newValue");
});

test("map keys returns observable objects", () => {
	const target = {};
	let ran = false;
	const m = map();
	m.set(target, target);

	Array.from(m.keys()).forEach((t) => {
		ran = true;
		expect(isObservable(t)).toBe(true);
	});

	expect(ran).toBe(true);
});

test("map values returns observable objects", () => {
	const target = {};
	let ran = false;
	const m = map();
	m.set(target, target);

	Array.from(m.values()).forEach((t) => {
		ran = true;
		expect(isObservable(t)).toBe(true);
	});

	expect(ran).toBe(true);
});

test("map forEach returns observable key and value", () => {
	const target = {};
	const m = map();
	m.set(target, target);
	expect(
		m.forEach((v, k) => {
			expect(isObservable(k)).toBe(true);
			expect(isObservable(v)).toBe(true);
		})
	);
});

test("set entries returns observable objects", () => {
	const target = {};
	let ran = false;
	const m = map();
	m.set(target, target);

	Array.from(m.entries()).forEach(([k, v]) => {
		ran = true;
		expect(isObservable(k)).toBe(true);
		expect(isObservable(v)).toBe(true);
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

test("map can be initialized with observable values", () => {
	const o1 = observable({});
	const o2 = observable({});
	const o3 = {};

	const m = map(
		new Map([
			[o1, o1],
			[o2, o2],
			[o3, o3],
		])
	);
	expect(m.has(o1)).toBe(true);
	expect(m.has(source(o2))).not.toBe(true);
	expect(m.has(o1)).toBe(true);
	expect(m.has(o2)).toBe(true);
	m.set(o2, o2);
	expect(m.size).toBe(3);
	expect(m.has(observable(o3))).toBe(true);
	m.delete(observable(o3));
	expect(m.size).toBe(2);
	m.delete(source(o1));
	expect(m.size).toBe(2);
	m.delete(o1);
	expect(m.size).toBe(1);
	m.delete(o2);
	expect(m.size).toBe(0);
});

test("does not overwrite observable values", () => {
	const o1 = observable({});

	const m = map(new Map([[o1, o1]]));
	expect(source(m).get(o1)).toBe(o1);
	m.set(o1, o1);
	expect(source(m).get(o1)).toBe(o1);
});

test("instanceof Map", () => {
	const m = map();
	expect(m instanceof Map).toBe(true);
});

test("WeakMap is reactive", () => {
	const m = weakMap();

	const target = {};
	let count = 0;

	createEffect(() => {
		count++;
		m.has(target);
	});

	m.set(target, 1);
	expect(count).toBe(2);
	expect(m.get(target)).toBe(1);
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

test("does not trigger a change when same observable is set on map initialized with observable values", () => {
	const o1 = observable({ prop: 1 });
	const o2 = observable({ prop: 2 });

	const m = map(
		new Map([
			[source(o1), source(o1)],
			[source(o2), source(o2)],
		])
	);

	let count = 0;
	createEffect(() => {
		m.forEach(() => {});
		count++;
	});
	expect(count).toBe(1);
	expect(m.get(o1)).toBe(o1);
	m.set(o1, o1);
	expect(count).toBe(1);
	m.set(o1, source(o1));
	expect(count).toBe(1);
	m.set(o1, o2);
	expect(count).toBe(1);
});

test("[mobx-test] observe value", function () {
	const a = map();
	let hasX = false;
	let valueX = undefined;
	let valueY = undefined;

	createEffect(function () {
		hasX = a.has("x");
	});

	createEffect(function () {
		valueX = a.get("x");
	});

	createEffect(function () {
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

	createEffect(function () {
		ks = keys(x);
	});
	createEffect(function () {
		vs = iteratorToArray(x.values());
	});
	createEffect(function () {
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
	createEffect(function () {
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
	createEffect(() => {
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
	const d = createReaction(
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
	const d = createReaction(
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
	const d = createReaction(
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
	const d = createReaction(
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

	createEffect(() => {
		sizes.push(m.size);
	});

	m.set(1, 1);
	m.set(2, 2);
	expect(sizes).toEqual([0, 1, 2]);
});

test("[mobx-test] .forEach() subscribes for key changes", () => {
	const m = map();
	let effectInvocationCount = 0;

	createEffect(() => {
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

	createEffect(() => {
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

	createEffect(() => {
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

	createEffect(() => {
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

	createEffect(() => {
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

	createEffect(() => {
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

	createEffect(() => {
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

	createEffect(() => {
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

	createEffect(() => {
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
