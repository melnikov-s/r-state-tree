import {
	effect,
	isObservable,
	observable,
	source,
	computed,
	mount,
	createStore,
	Store,
} from "../src";
import { createComputed } from "../src/observables";

const set = <T>(obj: Set<T> = new Set()) => {
	return observable(obj);
};

const weakSet = <T extends object>(obj: WeakSet<T> = new WeakSet()) => {
	return observable(obj);
};

const keys = <T>(set: Set<T>): T[] => {
	return Array.from(set.keys());
};

test("only reacts to accessed values", () => {
	let count = 0;

	const s = set();
	effect(() => {
		s.has(1);
		count++;
	});

	s.add(2);
	expect(count).toBe(1);
	s.delete(1);
	expect(count).toBe(1);
	s.add(1);
	expect(count).toBe(2);
	s.delete(2);
	expect(count).toBe(2);
	s.delete(1);
	expect(count).toBe(3);
});

test("set.forEach is reactive", () => {
	let c = 0;
	const s = set();

	effect(() => {
		s.forEach(() => {});
		c++;
	});

	s.add(1);
	s.add(2);
	expect(c).toBe(3);
});

test("set forEach returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const s = set();
	s.add(target);

	s.forEach((t) => {
		ran = true;
		// Shallow behavior: items are NOT wrapped
		expect(isObservable(t)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("set keys returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const s = set();
	s.add(target);

	Array.from(s.keys()).forEach((t) => {
		ran = true;
		// Shallow behavior: items are NOT wrapped
		expect(isObservable(t)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("set values returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const s = set();
	s.add(target);

	Array.from(s.values()).forEach((t) => {
		ran = true;
		// Shallow behavior: items are NOT wrapped
		expect(isObservable(t)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("set entries returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const s = set();
	s.add(target);

	Array.from(s.entries()).forEach(([k, v]) => {
		ran = true;
		// Shallow behavior: items are NOT wrapped
		expect(isObservable(k)).toBe(false);
		expect(isObservable(v)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("set equality for observed and target objects", () => {
	let target = {};
	let s = set();
	s.add(target);
	let o = observable(target);
	expect(s.has(o)).toBe(true);

	s = set();
	target = {};
	o = observable(target);
	s.add(o);
	expect(s.has(target)).toBe(true);
	s.add(target);
	expect(s.size).toBe(1);

	s.delete(target);
	expect(s.size).toBe(0);
});

test("set can store and find observable values", () => {
	const o1 = observable({});
	const o2 = observable({});
	const plain = {};

	const s = set(new Set([o1, o2, plain]));
	expect(s.has(o1)).toBe(true);
	expect(s.has(o2)).toBe(true);
	expect(s.has(plain)).toBe(true);
	expect(s.size).toBe(3);

	s.delete(o1);
	expect(s.size).toBe(2);
	s.delete(o2);
	expect(s.size).toBe(1);
	s.delete(plain);
	expect(s.size).toBe(0);
});

test("instanceof Set", () => {
	const s = set();
	expect(s instanceof Set).toBe(true);
});

test("does not trigger a change when same observable is set on set initialized with observable values", () => {
	const o1 = observable({ prop: 1 });
	const o2 = observable({ prop: 2 });

	const s = set(new Set([o1, o2].map(source)));

	let count = 0;
	effect(() => {
		s.forEach(() => {});
		count++;
	});
	expect(count).toBe(1);
	s.add(o1);
	expect(s.size).toBe(2);
	expect(count).toBe(1);
	s.add(source(o1));
	expect(s.size).toBe(2);
	expect(count).toBe(1);
	s.delete(o2);
	expect(s.size).toBe(1);
	expect(count).toBe(2);
});

test("WeakSet is reactive", () => {
	const s = weakSet();

	const target = {};
	let count = 0;

	effect(() => {
		count++;
		s.has(target);
	});

	s.add(target);
	expect(count).toBe(2);
	expect(s.has(target)).toBe(true);
});

test("WeakSet with function value is reactive", () => {
	const s = weakSet();
	const obsFn = observable(() => {});
	let count = 0;

	effect(() => {
		count++;
		s.has(obsFn);
	});

	s.add(obsFn);
	expect(count).toBe(2);
	expect(s.has(obsFn)).toBe(true);
	expect(s.has(source(obsFn))).toBe(true);
});

test("WeakSet does not report to have Set methods", () => {
	const s = weakSet();
	expect("size" in s).toBe(false);
	expect((s as any).size).toBe(undefined);
	expect("forEach" in s).toBe(false);
	expect((s as any).forEach).toBe(undefined);
});

test("instanceof WeakSet", () => {
	const s = weakSet();
	expect(s instanceof WeakSet).toBe(true);
});

test("[mobx-test] observe value", function () {
	const s = set();
	let hasX = false;
	let hasY = false;

	effect(function () {
		hasX = s.has("x");
	});
	effect(function () {
		hasY = s.has("y");
	});

	expect(hasX).toBe(false);

	s.add("x");
	expect(hasX).toBe(true);

	s.delete("x");
	expect(hasX).toBe(false);
	expect(hasY).toBe(false);
});

test("[mobx-test] observe collections", function () {
	const x = set();
	let ks, values, entries;

	effect(function () {
		ks = keys(x);
	});
	effect(function () {
		values = Array.from(x.values());
	});
	effect(function () {
		entries = Array.from(x.entries());
	});

	x.add("a");
	expect(ks).toEqual(["a"]);
	expect(values).toEqual(["a"]);
	expect(entries).toEqual([["a", "a"]]);

	x.forEach((value) => {
		expect(x.has(value)).toBe(true);
	});

	// should not retrigger:
	ks = null;
	values = null;
	entries = null;
	x.add("a");
	expect(ks).toEqual(null);
	expect(values).toEqual(null);
	expect(entries).toEqual(null);

	x.add("b");
	expect(ks).toEqual(["a", "b"]);
	expect(values).toEqual(["a", "b"]);
	expect(entries).toEqual([
		["a", "a"],
		["b", "b"],
	]);

	x.delete("a");
	expect(ks).toEqual(["b"]);
	expect(values).toEqual(["b"]);
	expect(entries).toEqual([["b", "b"]]);
});

test("[mobx-test] cleanup", function () {
	const s = set(new Set(["a"]));

	let hasA;

	effect(function () {
		hasA = s.has("a");
	});

	expect(hasA).toBe(true);
	expect(s.delete("a")).toBe(true);
	expect(s.delete("not-existing")).toBe(false);
	expect(hasA).toBe(false);
});

test("[mobx-test] set should support iterable ", () => {
	const a = set(new Set([1, 2]));

	function leech(iter: IterableIterator<any>) {
		const values = [];
		let v;
		do {
			v = iter.next();
			if (!v.done) values.push(v.value);
		} while (!v.done);
		return values;
	}

	expect(leech(a.entries())).toEqual([
		[1, 1],
		[2, 2],
	]);

	expect(leech(a.keys())).toEqual([1, 2]);
	expect(leech(a.values())).toEqual([1, 2]);
});

test("[mobx-test] set.clear should not be tracked", () => {
	const x = set(new Set([1]));
	let c = 0;
	effect(() => {
		c++;
		x.clear();
	});

	expect(c).toBe(1);
	x.add(2);
	expect(c).toBe(1);
});

test("[mobx-test] toStringTag", () => {
	const x = set();
	expect(x[Symbol.toStringTag]).toBe("Set");
	expect(Object.prototype.toString.call(x)).toBe("[object Set]");
});

describe("Detailed Set behavior", () => {
	test("Add proxy ⇒ iter yields proxy", () => {
		const raw = { id: 1 };
		const obs = observable(raw);
		const s = set();
		s.add(obs);

		// Iteration yields proxy
		for (const v of s) {
			expect(v).toBe(obs);
			expect(isObservable(v)).toBe(true);
		}

		expect(Array.from(s.values())[0]).toBe(obs);
		expect(source(s).has(raw)).toBe(true);
	});

	test("Add raw ⇒ iter yields raw", () => {
		const raw = { id: 1 };
		const obs = observable(raw);
		const s = set();
		s.add(source(obs));

		for (const v of s) {
			expect(v).toBe(raw);
			expect(isObservable(v)).toBe(false);
		}
	});

	test("Promotion behavior", () => {
		const raw = { id: 1 };
		const obs = observable(raw);
		const s = set();

		s.add(raw);
		expect(Array.from(s)[0]).toBe(raw);
		expect(isObservable(Array.from(s)[0])).toBe(false);

		// Promote to observable
		s.add(obs);
		expect(s.size).toBe(1);
		expect(Array.from(s)[0]).toBe(obs);
		expect(isObservable(Array.from(s)[0])).toBe(true);
	});

	test("Observable wins - adding raw after observable does not downgrade", () => {
		const raw = { id: 1 };
		const obs = observable(raw);
		const s = set();

		// First add observable
		s.add(obs);
		expect(Array.from(s)[0]).toBe(obs);
		expect(isObservable(Array.from(s)[0])).toBe(true);

		// Adding raw should NOT downgrade - observable wins
		s.add(raw);
		expect(s.size).toBe(1);
		expect(Array.from(s)[0]).toBe(obs); // Still observable, not downgraded
		expect(isObservable(Array.from(s)[0])).toBe(true);
	});

	test("Delete works with proxy+raw", () => {
		const obs = observable({ id: 1 });
		const s = set();

		s.add(obs);
		expect(s.size).toBe(1);
		s.delete(source(obs));
		expect(s.size).toBe(0);

		s.add(obs);
		expect(s.size).toBe(1);
		s.delete(obs);
		expect(s.size).toBe(0);
	});

	test("structuredClone(source(set)) safety", () => {
		const s = set();
		s.add(observable({ id: 1 }));
		s.add({ id: 2 });

		expect(() => structuredClone(source(s))).not.toThrow();
	});

	test("Initialization does not sanitize user-provided proxies", () => {
		const obs = observable({ id: 1 });
		const backing = new Set<any>([obs]);
		const s = observable(backing);

		expect(source(s)).toBe(backing);
		expect(source(s).has(obs)).toBe(true);
		expect(isObservable(Array.from(source(s).values())[0])).toBe(true);

		// Observable lookups must work with both proxy and raw values.
		expect(s.has(obs)).toBe(true);
		expect(s.has(source(obs))).toBe(true);

		// If a user explicitly seeds proxies into the source, structuredClone may throw.
		expect(() => structuredClone(source(s))).toThrow();
	});

	test("WeakSet basic functional behavior", () => {
		const ws = weakSet();
		const obj = {};
		ws.add(obj);
		expect(ws.has(obj)).toBe(true);

		const obs = observable({ id: 1 });
		ws.add(obs);
		expect(ws.has(obs)).toBe(true);
		expect(ws.has(source(obs))).toBe(true);
	});

	test("WeakSet source purity (value stored unwrapped)", () => {
		const ws = weakSet<object>();
		const raw = { id: 1 };
		const obs = observable(raw);

		ws.add(obs);

		expect(ws.has(obs)).toBe(true);
		expect(ws.has(source(obs))).toBe(true);

		expect(source(ws).has(raw)).toBe(true);
		expect(source(ws).has(obs)).toBe(false);
	});

	test("WeakSet membership checks work with proxy and source", () => {
		const ws = weakSet<object>();
		const raw = { id: 1 };
		const obs = observable(raw);

		ws.add(obs);

		expect(ws.has(obs)).toBe(true);
		expect(ws.has(source(obs))).toBe(true);
		expect(source(ws).has(source(obs))).toBe(true);
		expect(source(ws).has(obs)).toBe(false);
	});

	test("WeakSet delete works with proxy and source", () => {
		const ws = weakSet<object>();
		const raw = { id: 1 };
		const obs = observable(raw);

		ws.add(obs);
		expect(ws.has(obs)).toBe(true);

		ws.delete(source(obs));
		expect(ws.has(obs)).toBe(false);
		expect(ws.has(source(obs))).toBe(false);

		ws.add(obs);
		expect(ws.has(obs)).toBe(true);
		ws.delete(obs);
		expect(ws.has(obs)).toBe(false);
	});
});

describe("WeakSet GC behavior (requires --expose-gc)", () => {
	const gc = (globalThis as { gc?: () => void }).gc;
	const describeGC = gc ? describe : describe.skip;

	describeGC("WeakSet does not retain values via tracking", () => {
		test("value can be garbage collected when no strong refs remain", async () => {
			const ws = weakSet<object>();
			let collected = false;
			const registry = new FinalizationRegistry(() => {
				collected = true;
			});

			(() => {
				const obj = { id: "ephemeral" };
				registry.register(obj, undefined);
				ws.add(obj);
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
		const s = set<number>();
		let count = 0;
		let hasOne = false;

		effect(() => {
			hasOne = s.has(1);
			count++;
		});

		expect(count).toBe(1);
		expect(hasOne).toBe(false);

		s.add(1);
		expect(count).toBe(2);
		expect(hasOne).toBe(true);

		s.delete(1);
		expect(count).toBe(3);
		expect(hasOne).toBe(false);
	});

	test("has() triggers effect only for watched keys after first run", () => {
		const s = set<number>();
		let count = 0;

		// Effect watches value 1
		effect(() => {
			s.has(1);
			count++;
		});

		expect(count).toBe(1);

		// First run subscribes to the per-key atom for 1
		// Subsequent changes to other values should not trigger
		s.add(2);
		expect(count).toBe(1); // 2 doesn't trigger effect

		s.add(1);
		expect(count).toBe(2); // 1 triggers effect
	});

	test("Set#add chaining", () => {
		const s = set<number>();
		expect(s.add(1)).toBe(s);
		expect(s.add(1).add(2)).toBe(s);
		expect(s.has(1)).toBe(true);
		expect(s.has(2)).toBe(true);
	});
});

test("iterator reflects mutations during iteration (Set)", () => {
	const s = set(new Set(["a"]));
	const iterator = s.values();
	s.add("b");
	expect(iterator.next().value).toBe("a");
	expect(iterator.next().value).toBe("b");
	expect(iterator.next().done).toBe(true);
});

test("iterator reflect deletions during iteration (Set)", () => {
	const s = set(new Set(["a", "b"]));
	const iterator = s.values();
	expect(iterator.next().value).toBe("a");
	s.delete("b");
	expect(iterator.next().done).toBe(true);
});

describe("Uninstrumented collection methods (Branding check safety)", () => {
	test("Set.prototype.union (or other new methods) should not throw incompatible receiver", () => {
		const s1 = set(new Set([1, 2]));
		const s2 = new Set([2, 3]);

		if (typeof (Set.prototype as any).union === "function") {
			expect(() => {
				(s1 as any).union(s2);
			}).not.toThrow();
		} else {
			const originalMethod = (Set.prototype as any).someNonExistentMethod;
			(Set.prototype as any).someNonExistentMethod = function () {
				if (!(this instanceof Set)) {
					throw new TypeError(
						"Method Set.prototype.someNonExistentMethod called on incompatible receiver"
					);
				}
				return this;
			};

			try {
				expect(() => {
					(s1 as any).someNonExistentMethod();
				}).not.toThrow();
			} finally {
				delete (Set.prototype as any).someNonExistentMethod;
			}
		}
	});

	test("Fluent uninstrumented methods should return the proxy", () => {
		const s = set(new Set([1]));

		(Set.prototype as any).fluentMethod = function () {
			return this;
		};

		try {
			const result = (s as any).fluentMethod();
			expect(result).toBe(s);
		} finally {
			delete (Set.prototype as any).fluentMethod;
		}
	});

	test("New Set methods should be reactive and return observables", () => {
		if (typeof (Set.prototype as any).union !== "function") return;

		const s1 = set(new Set([1]));
		const s2 = set(new Set([2]));
		let count = 0;
		let union;

		effect(() => {
			union = (s1 as any).union(s2);
			count++;
		});

		expect(count).toBe(1);
		expect(isObservable(union)).toBe(false);
		expect(Array.from(union as any)).toEqual([1, 2]);

		s1.add(3);
		expect(count).toBe(2);
		expect(new Set(Array.from(union as any))).toEqual(new Set([1, 2, 3]));

		s2.add(4);
		expect(count).toBe(3);
		expect(new Set(Array.from(union as any))).toEqual(new Set([1, 2, 3, 4]));
	});

	test("Intersection should be reactive and return observables", () => {
		if (typeof (Set.prototype as any).intersection !== "function") return;

		const s1 = set(new Set([1, 2]));
		const s2 = set(new Set([2, 3]));
		let count = 0;
		let intersection;

		effect(() => {
			intersection = (s1 as any).intersection(s2);
			count++;
		});

		expect(count).toBe(1);
		expect(new Set(Array.from(intersection as any))).toEqual(new Set([2]));

		s1.add(3);
		expect(count).toBe(2);
		expect(new Set(Array.from(intersection as any))).toEqual(new Set([2, 3]));

		s2.delete(2);
		expect(count).toBe(3);
		expect(new Set(Array.from(intersection as any))).toEqual(new Set([3]));
	});

	test("Difference should be reactive and return observables", () => {
		if (typeof (Set.prototype as any).difference !== "function") return;

		const s1 = set(new Set([1, 2, 3]));
		const s2 = set(new Set([2, 4]));
		let count = 0;
		let diff;

		effect(() => {
			diff = (s1 as any).difference(s2);
			count++;
		});

		expect(count).toBe(1);
		expect(new Set(Array.from(diff as any))).toEqual(new Set([1, 3]));

		s1.add(5);
		expect(count).toBe(2);
		expect(new Set(Array.from(diff as any))).toEqual(new Set([1, 3, 5]));

		s2.add(1);
		expect(count).toBe(3);
		expect(new Set(Array.from(diff as any))).toEqual(new Set([3, 5]));
	});

	test("Boolean ES Set methods (isSubsetOf, etc) should be reactive", () => {
		if (typeof (Set.prototype as any).isSubsetOf !== "function") return;

		const s1 = set(new Set([1, 2]));
		const s2 = set(new Set([1, 2, 3]));
		let count = 0;
		let isSubset = false;

		effect(() => {
			isSubset = (s1 as any).isSubsetOf(s2);
			count++;
		});

		expect(count).toBe(1);
		expect(isSubset).toBe(true);

		s1.add(4);
		expect(count).toBe(2);
		expect(isSubset).toBe(false);

		s2.add(4);
		expect(count).toBe(3);
		expect(isSubset).toBe(true);
	});

	test("isDisjointFrom should be reactive", () => {
		if (typeof (Set.prototype as any).isDisjointFrom !== "function") return;

		const s1 = set(new Set([1]));
		const s2 = set(new Set([2]));
		let count = 0;
		let disjoint = false;

		effect(() => {
			disjoint = (s1 as any).isDisjointFrom(s2);
			count++;
		});

		expect(count).toBe(1);
		expect(disjoint).toBe(true);

		s2.add(1);
		expect(count).toBe(2);
		expect(disjoint).toBe(false);

		s1.delete(1);
		expect(count).toBe(3);
		expect(disjoint).toBe(true);
	});
});

describe("Ownership Propagation", () => {
	it("union() returns Set with observed elements", () => {
		const raw = { id: 1 };
		const obs = observable(raw);
		const s1 = observable(new Set());
		s1.add(obs);

		const s2 = observable(new Set());
		// @ts-ignore
		const union = s1.union(s2);

		const items = Array.from(union);
		expect(items[0]).toBe(obs);
		expect(isObservable(union)).toBe(false);
		expect(union.has(obs)).toBe(true);
	});

	it("intersection() returns Set with observed elements", () => {
		const obs = observable({ id: 1 });
		const s1 = observable(new Set([obs]));
		const s2 = observable(new Set([obs]));

		// @ts-ignore
		const intersection = s1.intersection(s2);
		expect(Array.from(intersection)[0]).toBe(obs);
	});

	it("difference() returns Set with observed elements", () => {
		const obs1 = observable({ id: 1 });
		const obs2 = observable({ id: 2 });
		const s1 = observable(new Set([obs1, obs2]));
		const s2 = observable(new Set([obs2]));

		// @ts-ignore
		const difference = s1.difference(s2);
		expect(difference.size).toBe(1);
		expect(Array.from(difference)[0]).toBe(obs1);
	});

	it("symmetricDifference() returns Set with observed elements", () => {
		const obs1 = observable({ id: 1 });
		const obs2 = observable({ id: 2 });
		const s1 = observable(new Set([obs1]));
		const s2 = observable(new Set([obs2]));

		// @ts-ignore
		const symDiff = s1.symmetricDifference(s2);
		expect(symDiff.size).toBe(2);
		const items = Array.from(symDiff);
		expect(items).toContain(obs1);
		expect(items).toContain(obs2);
	});
});

describe("Computed Reactivity Bugs", () => {
	test("computed re-subscribe sees updates that happened while unwatched (Set case)", () => {
		const s = observable(new Set<number>());
		const c = computed(() => s.has(123));

		const seen: boolean[] = [];
		const dispose1 = effect(() => {
			seen.push(c.value);
		});
		expect(seen[0]).toBe(false);
		dispose1();

		s.add(123);

		const seen2: boolean[] = [];
		const dispose2 = effect(() => {
			seen2.push(c.value);
		});
		expect(seen2[0]).toBe(true);
		dispose2();
	});

	test("same bug via Store @computed getter (Set case)", () => {
		class S extends Store {
			s = observable(new Set<number>());

			@computed
			get hasValue() {
				return this.s.has(123);
			}
		}

		const store = mount(createStore(S as any)) as any;
		const seen: boolean[] = [];
		const dispose1 = effect(() => {
			seen.push(store.hasValue);
		});
		expect(seen[0]).toBe(false);
		dispose1();

		store.s.add(123);

		const seen2: boolean[] = [];
		const dispose2 = effect(() => {
			seen2.push(store.hasValue);
		});
		expect(seen2[0]).toBe(true);
		dispose2();
	});

	test("clear() drops cache silently (does not notify subscribers)", () => {
		const s = observable({ v: 1 });
		const cc = createComputed(() => s.v);

		let runs = 0;
		effect(() => {
			cc.get();
			runs++;
		});

		expect(runs).toBe(1);

		// clear() should not trigger the effect
		cc.clear();
		expect(runs).toBe(1);

		s.v = 2;
		expect(runs).toBe(2);
	});
});
