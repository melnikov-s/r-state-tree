import {
	effect,
	reaction,
	observable,
	batch,
	source,
	reportChanged,
	isObservable,
} from "../src";
import { createComputed, createSignal } from "../src/observables";
import {
	getInternalNode,
	getAdministration,
} from "../src/observables/internal/lookup";

function object<T extends object>(obj: T = {} as T): Record<string, any> {
	return observable(obj);
}

test("observables can be stored and retrieved", () => {
	const target = { prop: undefined };
	const o = object(target);
	const oTarget = { prop: "value" };
	const c = observable(oTarget);

	o.prop = c;
	expect(o.prop).toBe(c);
});

test("does not overwrite observable values", () => {
	const o1 = observable({});

	const o = object({ o1 });
	o.o1 = o1;

	// If the user seeded the source object with a proxy, it must be preserved.
	expect(source(o).o1).toBe(o1);
});

test("dnyamic property keys are observable", () => {
	const o1 = observable({});
	let count = 0;
	effect(() => {
		count++;
		o1.value;
	});
	expect(count).toBe(1);

	o1.value = 1;
	expect(count).toBe(2);
});

// With shallow behavior, nested objects are NOT wrapped automatically
test("observable values can be assigned via Object.assign", () => {
	const target = { prop: undefined };
	const o = object(target);
	const oTarget = { prop: "value" };
	const c = observable(oTarget);

	Object.assign(o, { prop: c });
	expect(o.prop).toBe(c);
});

test("getters are observable but not auto-computed", () => {
	let count = 0;
	const o = observable({
		prop: 1,
		get comp() {
			count++;
			return this.prop * 2;
		},
	});

	// Effects should re-run when dependencies change
	let effectCount = 0;
	effect(() => {
		o.comp;
		effectCount++;
	});
	expect(effectCount).toBe(1);

	// Changing prop triggers effect re-run (getter is still observable)
	o.prop++;
	expect(effectCount).toBe(2);

	// Getter returns correct value
	expect(o.comp).toBe(4);

	// Key behavioral change: getter is NOT memoized
	// Each read increments count (unlike computed which would cache)
	const countBefore = count;
	o.comp;
	o.comp;
	expect(count).toBeGreaterThan(countBefore);
});

test("can only have one observable proxy per object", () => {
	const target = {};

	expect(object(target)).toBe(object(target));
});

test("target is updated when observable value updates", () => {
	const target = {} as any;
	const o = object(target);
	o.prop = "value";
	expect(target.prop).toBe("value");
});

test("observable value is updated when target is updated", () => {
	const target = {} as any;
	const o = object(target);
	o.prop = "value";
	expect(target.prop).toBe("value");
	delete o.prop;
	expect("prop" in target).toBe(false);
});

// REMOVED: "observable objects are deeply observed" test
// With shallow behavior, nested objects are NOT automatically wrapped as observable
// Container mutations are tracked but nested property changes are not

test("does not respond to no-op", () => {
	let count = 0;
	const x = object({});

	effect(() => {
		count++;
		return x.x;
	});

	x.x = 1;
	expect(count).toBe(2);
	x.x = 2;
	expect(count).toBe(3);
	x.x = 2;
	expect(count).toBe(3);
});

test("does not observe constructors indirectly", () => {
	const C = class {};
	const o = object({ v: C });
	expect(isObservable(new o.v())).toBe(false);
});

test("frozen objects are not observed", () => {
	const o = object({ toBeFrozen: {} });
	Object.freeze(source(o).toBeFrozen);
	expect(isObservable(o.toBeFrozen)).toBe(false);
});

test("action can turn into observable", () => {
	let count = 0;
	const o = object({ v() {} });

	effect(() => {
		count++;
		return o.v;
	});

	o.v = 1;
	expect(count).toBe(2);
	o.v = 2;
	expect(count).toBe(3);
});

test("observable can turn into action", () => {
	let count = 0;
	const o = object({ v: 0 });
	const o2 = object({ v: 0 });

	effect(() => {
		count++;
		return o.v + o2.v;
	});

	o.v = function () {
		o2.v++;
	};

	expect(count).toBe(2);
	o.v();
	expect(count).toBe(3);
});

test("action can turn into observable (source)", () => {
	let count = 0;
	const o = object({ v() {} });

	effect(() => {
		count++;
		return o.v;
	});

	source(o).v = 1;
	reportChanged(o);
	expect(count).toBe(2);
});

test("observable can turn into action (source)", () => {
	let count = 0;
	const o = object({ v: 0 });
	const o2 = object({ v: 0 });

	effect(() => {
		count++;
		return o.v + o2.v;
	});

	source(o).v = function () {
		o2.v++;
	};

	reportChanged(o);

	expect(count).toBe(2);
	o.v();
	expect(count).toBe(3);
});

test("[mobx-test] keys should be observable when extending", () => {
	const todos = object({});

	const todoTitles = [];
	reaction(
		() => Object.keys(todos).map((key) => `${key}: ${todos[key]}`),
		(titles) => todoTitles.push(titles.join(","))
	);

	batch(() => {
		Object.assign(todos, {
			lewis: "Read Lewis",
			chesterton: "Be mind blown by Chesterton",
		});
	});
	expect(todoTitles).toEqual([
		"lewis: Read Lewis,chesterton: Be mind blown by Chesterton",
	]);

	Object.assign(todos, { lewis: "Read Lewis twice" });
	Object.assign(todos, { coffee: "Grab coffee" });
	expect(todoTitles).toEqual([
		"lewis: Read Lewis,chesterton: Be mind blown by Chesterton",
		"lewis: Read Lewis twice,chesterton: Be mind blown by Chesterton",
		"lewis: Read Lewis twice,chesterton: Be mind blown by Chesterton,coffee: Grab coffee",
	]);
});

test("[mobx-test] object - set, remove, values are reactive", () => {
	const todos = object({});
	const snapshots = [];

	reaction(
		() => Object.values(todos),
		(values) => snapshots.push(values)
	);

	expect("x" in todos).toBe(false);
	expect(todos.x).toBe(undefined);
	todos.x = 3;
	expect("x" in todos).toBe(true);
	expect(todos.x).toBe(3);
	delete todos.y;
	todos.z = 4;
	todos.x = 5;
	delete todos.z;

	expect(snapshots).toEqual([[3], [3, 4], [5, 4], [5]]);
});

test("[mobx-test] object - set, remove, entries are reactive", () => {
	const todos = object({});
	const snapshots = [];

	reaction(
		() => Object.entries(todos),
		(entries) => snapshots.push(entries)
	);

	expect("x" in todos).toBe(false);
	expect(todos.x).toBe(undefined);
	todos.x = 3;
	expect("x" in todos).toBe(true);
	expect(todos.x).toBe(3);
	delete todos.y;
	todos.z = 4;
	todos.x = 5;
	delete todos.z;

	expect(snapshots).toEqual([
		[["x", 3]],
		[
			["x", 3],
			["z", 4],
		],
		[
			["x", 5],
			["z", 4],
		],
		[["x", 5]],
	]);
});

test("[mobx-test] object - set, remove, keys are reactive", () => {
	const todos = object({ a: 3 });
	const snapshots = [];

	reaction(
		() => Object.keys(todos),
		(keys) => snapshots.push(keys)
	);

	todos.x = 3;
	delete todos.y;
	todos.z = 4;
	todos.x = 5;
	delete todos.z;
	delete todos.a;

	expect(snapshots).toEqual([["a", "x"], ["a", "x", "z"], ["a", "x"], ["x"]]);
});

test("[mobx-test] has and get are reactive", async () => {
	const todos = object({});
	let count = 0;

	reaction(
		() => {
			return "x" in todos;
		},
		(b) => b && count++
	);

	reaction(
		() => {
			return todos.y === 3;
		},
		(b) => b && count++
	);

	expect(count).toBe(0);

	Object.assign(todos, { x: false, y: 3 });

	expect(count).toBe(2);
});

test("[mobx-test] getter props are considered part of collections", () => {
	const x = object({
		get y() {
			return 3;
		},
	});
	expect(x.y).toBe(3);
	expect("y" in x).toBe(true); // `in` also checks proto type, so should return true!
	expect(Object.keys(x)).toEqual(["y"]);
	expect(Object.values(x)).toEqual([3]);
	expect(Object.entries(x)).toEqual([["y", 3]]);
});

test("[mobx-test] delete and undelete should work", () => {
	const x = object({});

	const events = [];
	effect(() => {
		events.push("a" in x);
	});

	x.a = 1;
	x.a++;
	delete x.a;
	x.a = 5;
	delete x.a;
	x.a = 5;
	expect(events).toEqual([false, true, false, true, false, true]);
});

test("[mobx-test] should react to key removal (unless reconfiguring to empty) - 1", () => {
	const events = [];
	const x = object({
		y: 1,
		z: 1,
	});

	reaction(
		() => Object.keys(x),
		(keys) => events.push(keys.join(","))
	);

	events.push(Object.keys(x).join(","));
	expect(events).toEqual(["y,z"]);
	delete x.y;
	expect(events).toEqual(["y,z", "z"]);
	// should not trigger another time..
	delete x.y;
	expect(events).toEqual(["y,z", "z"]);
});

test("[mobx-test] should react to key removal (unless reconfiguring to empty) - 2", () => {
	const events = [];
	const x = object({
		y: 1,
		z: 1,
	});

	reaction(
		() => x.z,
		(v) => events.push(v)
	);

	delete x.z;
	expect(events).toEqual([undefined]);
});

test("[mobx-test] should react to key removal (unless reconfiguring to empty) - 2", () => {
	const events = [];
	const x = object({
		y: 1,
		z: undefined,
	});

	reaction(
		() => x.z,
		(v) => events.push(v)
	);

	delete x.z;
	expect(events).toEqual([]);
});

test("[mobx-test] should react to future key additions - 1", () => {
	const events = [];
	const x = object({});

	reaction(
		() => Object.keys(x),
		(keys) => events.push(keys.join(","))
	);

	x.y = undefined;
	expect(events).toEqual(["y"]);
});

test("[mobx-test] should react to future key additions - 2", () => {
	const events = [];
	const x = object({});

	reaction(
		() => {
			return x.z;
		},
		(v) => {
			events.push(v);
		}
	);

	x.z = undefined;
	expect(Object.keys(x)).toEqual(["z"]);
	x.y = 3;
	expect(events).toEqual([]);
	delete x.y;
	expect(events).toEqual([]);
	x.z = 4;
	expect(events).toEqual([4]);
});

test("[mobx-test] correct keys are reported", () => {
	const x = object({
		x: 1,
		get y() {
			return 2;
		},
		a: 4,
		get b() {
			return 5;
		},
	});
	x.z = 3;
	x.y;
	x.b; // make sure it is read

	expect(Object.keys(x)).toEqual(["x", "y", "a", "b", "z"]);
	expect(Object.values(x)).toEqual([1, 2, 4, 5, 3]);
	expect(Object.entries(x)).toEqual([
		["x", 1],
		["y", 2],
		["a", 4],
		["b", 5],
		["z", 3],
	]);

	expect(Object.getOwnPropertyNames(x)).toEqual(["x", "y", "a", "b", "z"]);
	expect(Object.keys(x)).toEqual(["x", "y", "a", "b", "z"]);

	delete x.x;
	expect(Object.keys(x)).toEqual(["y", "a", "b", "z"]);
	expect(Object.getOwnPropertyNames(x)).toEqual(["y", "a", "b", "z"]);
	expect(Object.keys(x)).toEqual(["y", "a", "b", "z"]);
});

test("[mobx-test] in operator", () => {
	const x = object({
		x: 1,
		get y() {
			return 2;
		},
		a: 4,
		get b() {
			return 5;
		},
	});
	x.z = 3;
	expect("x" in x).toBeTruthy();
	expect("y" in x).toBeTruthy();
	expect("a" in x).toBeTruthy();
	expect("b" in x).toBeTruthy();
	expect("z" in x).toBeTruthy();
	expect("c" in x).toBeFalsy();
	expect("c" in x).toBeFalsy(); // not accidentally create
	delete x.x;
	expect("x" in x).toBeFalsy();
});

test("[mobx-test] for-in operator", () => {
	const x = object({
		x: 1,
		get y() {
			return 2;
		},
		a: 4,
		get b() {
			return 5;
		},
	});
	x.z = 3;

	function computeKeys() {
		const res = [];
		for (const key in x) res.push(key);
		return res;
	}

	expect(computeKeys()).toEqual(["x", "y", "a", "b", "z"]);
	delete x.x;
	expect(computeKeys()).toEqual(["y", "a", "b", "z"]);
});

test("[mobx-test] type coercion doesn't break", () => {
	const x = object({});
	expect("" + x).toBe("[object Object]");
	expect(42 * (x as any)).toBeNaN();
});

test("[mobx-test] adding a different key doesn't trigger a pending key", () => {
	const x = object({});
	let counter = 0;

	effect(() => {
		x.x;
		counter++;
	});
	expect(counter).toBe(1);

	x.y = 3;
	expect(counter).toBe(1);

	x.x = 3;
	expect(counter).toBe(2);
});

test("[mobx-test] deleting / recreate prop", () => {
	const value = object({
		foo: undefined, // if foo is something like 'abc', it works.
	});

	const events = [];

	effect(() => {
		events.push(value.foo);
	});
	delete value.foo;
	value.foo = "def";
	expect(events).toEqual([undefined, undefined, "def"]);
});

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

describe("Proxy trap invariants", () => {
	test("Non-extensible object set should fail", () => {
		const o = observable({} as any);
		Object.preventExtensions(source(o));

		// Assignment should return false or throw in strict mode
		// Vitest tests run in strict mode (ESM), so this should throw
		expect(() => {
			o.x = 1;
		}).toThrow(TypeError);

		expect(Reflect.set(o, "y", 2)).toBe(false);
		expect("y" in o).toBe(false);
	});

	test("Sealed object delete should fail", () => {
		const o = observable({ x: 1 } as any);
		Object.seal(source(o));

		// Deletion should return false or throw
		expect(() => {
			delete o.x;
		}).toThrow(TypeError);

		expect(Reflect.deleteProperty(o, "x")).toBe(false);
		expect("x" in o).toBe(true);
	});

	test("Non-writable property set should fail", () => {
		const target = {};
		Object.defineProperty(target, "x", {
			value: 1,
			writable: false,
			configurable: true,
		});
		const o = observable(target as any);

		expect(() => {
			o.x = 2;
		}).toThrow(TypeError);

		expect(o.x).toBe(1);
	});

	test("Change notifications only happen if mutation succeeds", () => {
		const o = observable({ x: 1 } as any);
		Object.preventExtensions(source(o));

		let count = 0;
		effect(() => {
			o.y;
			count++;
		});

		expect(count).toBe(1);

		// This should fail to set 'y'
		try {
			o.y = 2;
		} catch (e) {}

		// Should NOT increment because 'y' was never successfully added
		expect(count).toBe(1);
	});
});

describe("Setter-only accessors on plain objects", () => {
	test("reading a setter-only accessor returns undefined and does not throw", () => {
		const obj = {};
		let setterValue: any;
		Object.defineProperty(obj, "prop", {
			set(v) {
				setterValue = v;
			},
			configurable: true,
			enumerable: true,
		});

		const o = observable(obj) as any;
		expect(() => o.prop).not.toThrow();
		expect(o.prop).toBe(undefined);
	});

	test("writing to a setter-only accessor invokes the setter and does not throw", () => {
		const obj = {};
		let setterValue: any;
		Object.defineProperty(obj, "prop", {
			set(v) {
				setterValue = v;
			},
			configurable: true,
			enumerable: true,
		});

		const o = observable(obj) as any;
		expect(() => {
			o.prop = "value";
		}).not.toThrow();
		expect(setterValue).toBe("value");
	});
});

describe("Proxy Correctness", () => {
	describe("Receiver Semantics", () => {
		test("should correctly handle receiver in prototype chains (get)", () => {
			const proto = object({ x: 1 });
			const child = Object.create(proto);

			expect(child.x).toBe(1);
			expect(Reflect.get(proto, "x", child)).toBe(1);
		});

		test("should correctly handle receiver in prototype chains (set)", () => {
			const proto = object({ x: 1 });
			const child = Object.create(proto);

			// Should define own property on child, not mutate proto
			child.x = 2;
			expect(child.x).toBe(2);
			expect(proto.x).toBe(1);
			expect(Object.hasOwnProperty.call(child, "x")).toBe(true);
		});

		test("should trigger reactivity on proto when child reads inherited property", () => {
			const proto = object({ x: 1 });
			const child = Object.create(proto);
			const spy = vi.fn();

			reaction(() => {
				spy(child.x);
			});

			expect(spy).toHaveBeenCalledWith(1);
			proto.x = 2;
			expect(spy).toHaveBeenCalledWith(2);
		});
	});

	describe("defineProperty Reactivity", () => {
		test("should trigger reactivity when Object.defineProperty is used", () => {
			const obj = object({ x: 1 });
			const spy = vi.fn();

			reaction(() => {
				spy(Object.keys(obj));
			});

			expect(spy).toHaveBeenLastCalledWith(["x"]);

			// Add a new property via defineProperty
			Object.defineProperty(obj, "y", {
				value: 2,
				enumerable: true,
				configurable: true,
				writable: true,
			});

			expect(obj.y).toBe(2);
			expect(spy).toHaveBeenLastCalledWith(["x", "y"]);
		});

		test("should track value changes made via defineProperty", () => {
			const obj = object({ x: 1 });
			const spy = vi.fn();

			reaction(() => {
				spy(obj.x);
			});

			expect(spy).toHaveBeenLastCalledWith(1);

			Object.defineProperty(obj, "x", { value: 100 });

			expect(obj.x).toBe(100);
			expect(spy).toHaveBeenLastCalledWith(100);
		});
	});

	describe("Proxy Invariants", () => {
		test("should respect non-configurable non-writable data properties", () => {
			const target: any = {};
			Object.defineProperty(target, "fixed", {
				value: { nested: 1 },
				writable: false,
				configurable: false,
			});

			const proxy = object(target);

			// Invariant: If a property is non-configurable and non-writable,
			// the proxy MUST return the exact same value as the target.
			// It cannot return a proxy wrapper.
			expect(proxy.fixed).toBe(target.fixed);
			expect(proxy.fixed).toEqual({ nested: 1 });
		});
	});

	describe("Object.prototype Keys", () => {
		test("should be reactive if they are own properties", () => {
			const obj = object({ toString: "custom" });
			const spy = vi.fn();

			reaction(() => {
				spy(obj.toString);
			});

			expect(spy).toHaveBeenLastCalledWith("custom");

			obj.toString = "updated";
			expect(spy).toHaveBeenLastCalledWith("updated");
		});

		test("should handle hasOwnProperty masking", () => {
			const obj = object({
				hasOwnProperty: () => "fake",
			});

			expect(obj.hasOwnProperty("anything")).toBe("fake");

			// Should properly track it
			const spy = vi.fn();
			reaction(() => spy((obj as any).hasOwnProperty("x")));
			expect(spy).toHaveBeenCalledWith("fake");

			obj.hasOwnProperty = () => "updated";
			expect(spy).toHaveBeenCalledWith("updated");
		});
	});

	describe("Prototype getter receiver semantics", () => {
		test("prototype getters use correct receiver", () => {
			const proto = object({
				get x() {
					return (this as any).y;
				},
			});
			const child = Object.create(proto) as any;
			child.y = 2;
			expect(child.x).toBe(2);
		});

		test("Reflect.get uses correct receiver", () => {
			const proto = object({
				get x() {
					return (this as any).y;
				},
			});
			const child = { y: 2 };
			expect(Reflect.get(proto, "x", child)).toBe(2);
		});
	});
});

describe("SignalMap per-key cleanup", () => {
	test("per-key signal nodes are cleaned up when object becomes unobserved", () => {
		const obj = observable({ x: 1 });
		const dispose1 = effect(() => void obj.x);
		const node1 = getInternalNode(obj, "x");
		dispose1();
		const dispose2 = effect(() => void obj.x);
		const node2 = getInternalNode(obj, "x");
		expect(node2).not.toBe(node1); // Node was cleared and recreated
		dispose2();
	});
});

describe("Administration.reportObserved bounded atoms", () => {
	test("reportObserved() does not allocate unbounded atoms", () => {
		const obj = observable({ x: 1 });
		const adm = getAdministration(obj) as any;

		// Call reportObserved many times
		for (let i = 0; i < 100; i++) {
			adm.reportObserved();
		}

		// Should have at most 1 cached atom, not 100
		expect(adm.forceObservedAtom).toBeDefined();
		// The old array should not exist
		expect(adm.forceObservedAtoms).toBeUndefined();

		// Trigger mutation to flush
		obj.x++;
		expect(adm.forceObservedAtom).toBeUndefined();
	});
});

describe("Regression Tests", () => {
	test("plain object getter is NOT auto-computed (no memoization)", () => {
		let runs = 0;
		const o = observable({
			x: 1,
			get g() {
				runs++;
				return this.x * 2;
			},
		}) as any;
		// Not memoized: repeated reads re-run getter
		expect(o.g).toBe(2);
		expect(o.g).toBe(2);
		expect(runs).toBe(2);
	});
});
