import { effect, observable } from "../src";

const keys = [undefined, null, NaN, 0, -0, false, "", Symbol("key"), {}];

describe.each(keys)("native collection semantics for key %s", (key) => {
	test("Map presence, reads, updates, iteration, deletion and clear", () => {
		const native = new Map<unknown, number | undefined>([[key, 42]]);
		const observed = observable(new Map(native));
		const check = () => {
			expect(observed.size).toBe(native.size);
			expect(observed.has(key)).toBe(native.has(key));
			expect(observed.get(key)).toBe(native.get(key));
			expect([...observed]).toStrictEqual([...native]);
			expect([...observed.values()]).toStrictEqual([...native.values()]);
			const visited: unknown[] = [];
			observed.forEach((value, entryKey) => visited.push([entryKey, value]));
			expect(visited).toStrictEqual([...native]);
		};
		check();
		for (const value of [43, undefined, 43]) {
			expect(observed.set(key, value)).toBe(observed);
			native.set(key, value);
			check();
		}
		for (let i = 0; i < 2; i++) {
			expect(observed.delete(key)).toBe(native.delete(key));
			check();
		}
		observed.set(key, 42);
		native.set(key, 42);
		check();
		observed.clear();
		native.clear();
		check();
	});

	test("Set membership, duplicate additions, deletion and clear", () => {
		const native = new Set([key]);
		const observed = observable(new Set(native));
		const check = () => {
			expect(observed.size).toBe(native.size);
			expect(observed.has(key)).toBe(native.has(key));
			expect([...observed]).toStrictEqual([...native]);
		};
		check();
		expect(observed.add(key)).toBe(observed);
		native.add(key);
		check();
		for (let i = 0; i < 2; i++) {
			expect(observed.delete(key)).toBe(native.delete(key));
			check();
		}
		observed.add(key);
		native.add(key);
		check();
		observed.clear();
		native.clear();
		check();
	});
});

test("undefined Map key reads react to updates, deletion and clear", () => {
	const map = observable(new Map<undefined, number>());
	const snapshots: unknown[] = [];
	const dispose = effect(() => {
		snapshots.push([map.has(undefined), map.get(undefined), map.size]);
	});
	try {
		map.set(undefined, 42);
		map.set(undefined, 42);
		map.set(undefined, 43);
		map.delete(undefined);
		map.delete(undefined);
		map.set(undefined, 44);
		map.clear();
		expect(snapshots).toStrictEqual([
			[false, undefined, 0],
			[true, 42, 1],
			[true, 43, 1],
			[false, undefined, 0],
			[true, 44, 1],
			[false, undefined, 0],
		]);
	} finally {
		dispose();
	}
});

test("undefined Set membership reacts only to actual changes", () => {
	const set = observable(new Set<undefined>());
	const snapshots: unknown[] = [];
	const dispose = effect(() => {
		snapshots.push([set.has(undefined), set.size]);
	});
	try {
		set.add(undefined);
		set.add(undefined);
		set.delete(undefined);
		set.delete(undefined);
		set.add(undefined);
		set.clear();
		expect(snapshots).toStrictEqual([
			[false, 0],
			[true, 1],
			[false, 0],
			[true, 1],
			[false, 0],
		]);
	} finally {
		dispose();
	}
});
