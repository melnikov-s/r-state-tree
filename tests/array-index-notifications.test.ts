import { batch, effect, observable } from "../src";
import { getAdministration } from "../src/observables/internal/lookup";

test("an indexed write looks up one signal without scanning tracked indices", () => {
	const size = 10_000;
	const items = observable(Array.from({ length: size }, (_, index) => index));
	const seen: [number, number][] = [];
	const disposers = Array.from({ length: size }, (_, index) =>
		effect(() => {
			seen.push([index, items[index]]);
		})
	);
	const nodes = getAdministration(items).valuesMap;
	const keys = nodes.keys.bind(nodes);
	let scanned = 0;
	const scan = vi.spyOn(nodes, "keys").mockImplementation(function* () {
		for (const key of keys()) {
			scanned++;
			yield key;
		}
	});
	const lookup = vi.spyOn(nodes, "get");

	try {
		expect(Array.from(keys())).toHaveLength(size);
		seen.length = 0;

		items[17] = -1;

		expect(seen).toEqual([[17, -1]]);
		expect(lookup.mock.calls).toEqual([[17]]);
		expect(scanned).toBe(0);
	} finally {
		scan.mockRestore();
		lookup.mockRestore();
		disposers.forEach((dispose) => dispose());
	}
});

test("replacing an existing value invalidates its readers and whole-array readers only", () => {
	const items = observable([1, 2]);
	const index = vi.fn(() => items[1]);
	const anotherIndex = vi.fn(() => items[0]);
	const length = vi.fn(() => items.length);
	const keys = vi.fn(() => Object.keys(items));
	const joined = vi.fn(() => items.join());
	const disposers = [index, anotherIndex, length, keys, joined].map((read) =>
		effect(() => void read())
	);

	try {
		items[1] = 3;
		items[1] = 3;

		expect(index.mock.results.map(({ value }) => value)).toEqual([2, 3]);
		expect(joined.mock.results.map(({ value }) => value)).toEqual([
			"1,2",
			"1,3",
		]);
		expect(anotherIndex).toHaveBeenCalledTimes(1);
		expect(length).toHaveBeenCalledTimes(1);
		expect(keys).toHaveBeenCalledTimes(1);
	} finally {
		disposers.forEach((dispose) => dispose());
	}
});

test("indexed changes and mutators publish complete array state per batch", () => {
	const native = [1, 2];
	const items = observable([1, 2]);
	const read = (array: number[]) => ({
		length: array.length,
		keys: Object.keys(array),
		index: array[4],
		hasIndex: 4 in array,
		joined: array.join(),
	});
	const seen: ReturnType<typeof read>[] = [];
	const expected = [read(native)];
	const dispose = effect(() => {
		seen.push(read(items));
	});
	const mutate = (fn: (array: number[]) => unknown) => {
		const expectedResult = fn(native);
		expected.push(read(native));
		expect(fn(items)).toStrictEqual(expectedResult);
		expect(seen).toStrictEqual(expected);
	};

	try {
		mutate((array) => (array[4] = 5));
		mutate((array) => delete array[4]);
		mutate((array) =>
			Reflect.defineProperty(array, "4", {
				value: 9,
				configurable: true,
				enumerable: true,
				writable: true,
			})
		);
		// A borrowed native mutator uses separate traps for deleting and shrinking.
		mutate((array) => batch(() => Array.prototype.pop.call(array)));
		mutate((array) => array.splice(1, 1, 3));
		mutate((array) => array.splice(0, 0, 8));
	} finally {
		dispose();
	}
});

test("a wide sparse truncation checks only tracked indices, not the array length", () => {
	const lastIndex = 2 ** 32 - 2;
	const items = observable<number[]>([]);
	items[lastIndex] = 1;
	const seen: (number | undefined)[] = [];
	const dispose = effect(() => {
		seen.push(items[lastIndex]);
	});
	const nodes = getAdministration(items).valuesMap;
	const get = nodes.get.bind(nodes);
	const lookup = vi.spyOn(nodes, "get").mockImplementation((key) => {
		if (key !== lastIndex) throw new Error("Looked up an untracked index");
		return get(key);
	});

	try {
		expect(items.length).toBe(2 ** 32 - 1);
		items.length = 0;
		expect(items.length).toBe(0);
		expect(seen).toEqual([1, undefined]);
		expect(lookup.mock.calls).toEqual([[lastIndex]]);
	} finally {
		lookup.mockRestore();
		dispose();
	}
});
