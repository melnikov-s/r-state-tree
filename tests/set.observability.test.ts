import {
	effect,
	observable,
	computed,
	mount,
	createStore,
	Store,
} from "../src";
import { createComputed } from "../src/observables";

const set = <T>(obj: Set<T> = new Set()) => {
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
