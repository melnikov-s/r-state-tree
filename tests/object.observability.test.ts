import { effect, reaction, observable, batch } from "../src";
import {
	getInternalNode,
	getAdministration,
} from "../src/observables/internal/lookup";

function object<T extends object>(obj: T = {} as T): Record<string, any> {
	return observable(obj);
}

test("[mobx-test] keys should be observable when extending", () => {
	const todos = object({});

	const todoTitles: any[] = [];
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
	const snapshots: any[] = [];

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
	const snapshots: any[] = [];

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
	const snapshots: any[] = [];

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

	const events: any[] = [];
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
	const events: any[] = [];
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
	const events: any[] = [];
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
	const events: any[] = [];
	const x = object({});

	reaction(
		() => Object.keys(x),
		(keys) => events.push(keys.join(","))
	);

	x.y = undefined;
	expect(events).toEqual(["y"]);
});

test("[mobx-test] should react to future key additions - 2", () => {
	const events: any[] = [];
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

	const events: any[] = [];

	effect(() => {
		events.push(value.foo);
	});
	delete value.foo;
	value.foo = "def";
	expect(events).toEqual([undefined, undefined, "def"]);
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
