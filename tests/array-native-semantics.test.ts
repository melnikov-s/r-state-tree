import { effect, observable, source } from "../src";

const fixtures: [string, () => any[]][] = [
	["empty", () => []],
	["dense", () => [3, 1, 2]],
	["undefined values", () => [undefined, 3, undefined, 1]],
	["holes", () => new Array(3)],
	[
		"interior hole",
		() => {
			const values = [1, 2, 3];
			delete values[1];
			return values;
		},
	],
	[
		"holes and undefined",
		() => {
			const values = [undefined, 3, undefined, 1, undefined];
			delete values[0];
			delete values[3];
			return values;
		},
	],
];

function expectSameArray(actual: any[], expected: any[]) {
	expect(actual).toStrictEqual(expected);
	expect(Object.keys(actual)).toStrictEqual(Object.keys(expected));
}

const coercions: unknown[] = [
	undefined,
	null,
	NaN,
	-Infinity,
	Infinity,
	-10,
	-1.5,
	-0.5,
	-0,
	0,
	0.5,
	1.5,
	10,
	"1.5",
	"-1.5",
	"invalid",
	false,
	true,
	{ valueOf: () => 1.5 },
	{ [Symbol.toPrimitive]: () => -1.5 },
];

describe.each(fixtures)("native array semantics: %s", (_name, makeArray) => {
	test("splice argument counts, coercion, and sparse removed arrays", () => {
		const argumentLists: any[][] = [[], ...coercions.map((start) => [start])];
		for (const start of coercions) {
			for (const count of coercions) {
				argumentLists.push([start, count], [start, count, "new", undefined]);
			}
		}
		for (const args of argumentLists) {
			const native = makeArray();
			const observed = observable(makeArray());
			const expected = Array.prototype.splice.apply(
				native,
				args as [number, number]
			);
			const actual = observed.splice.apply(observed, args as [number, number]);
			expectSameArray(actual, expected);
			expectSameArray(observed, native);
		}
	});

	test.each([undefined, (a: number, b: number) => a - b])(
		"sort preserves holes and places undefined before holes (%s)",
		(compare) => {
			const native = makeArray();
			const observed = observable(makeArray());
			expect(observed.sort(compare)).toBe(observed);
			native.sort(compare);
			expectSameArray(observed, native);
		}
	);

	test.each([null, false, 1, "compare", {}])(
		"sort rejects non-callable comparators even on empty arrays (%s)",
		(compare) => {
			const native = makeArray();
			const observed = observable(makeArray());
			expect(() => native.sort(compare as any)).toThrow(TypeError);
			expect(() => observed.sort(compare as any)).toThrow(TypeError);
			expectSameArray(observed, native);
		}
	);

	test.each([1n, Symbol("index")])(
		"splice rejects invalid numeric arguments (%s)",
		(value) => {
			for (const args of [
				[value, 1],
				[0, value],
			]) {
				const native = makeArray();
				const observed = observable(makeArray());
				expect(() => native.splice.apply(native, args as any)).toThrow(
					TypeError
				);
				expect(() => observed.splice.apply(observed, args as any)).toThrow(
					TypeError
				);
				expectSameArray(observed, native);
			}
		}
	);
});

test("sort never passes undefined to a comparator", () => {
	const values = [undefined, 3, undefined, 1];
	const compare = vi.fn(
		(a: number | undefined, b: number | undefined) => a! - b!
	);
	const arr = observable(values);
	arr.sort(compare);
	expect(compare).toHaveBeenCalled();
	for (const args of compare.mock.calls) {
		expect(args.every((value) => value !== undefined)).toBe(true);
	}
	expectSameArray(arr, [1, 3, undefined, undefined]);
});

test("default sort uses native string coercion, including Symbol rejection", () => {
	const symbol = Symbol("value");
	const native = [symbol, "a"];
	const observed = observable([symbol, "a"]);
	expect(() => native.sort()).toThrow(TypeError);
	expect(() => observed.sort()).toThrow(TypeError);
	expectSameArray(observed, native);
});

test("splice coerces start and delete count once, in order", () => {
	const run = (wrap: (values: number[]) => number[]) => {
		const calls: string[] = [];
		const values = wrap([1, 2, 3]);
		const start = {
			valueOf: () => {
				calls.push("start");
				return 0.5;
			},
		};
		const count = {
			valueOf: () => {
				calls.push("count");
				return 1.5;
			},
		};
		const removed = values.splice(start as any, count as any);
		return { values, removed, calls };
	};
	expect(run(observable)).toStrictEqual(run((values) => values));
});

test("fractional splice returns owned proxies and invalidates shifted indices", () => {
	const first = observable({ id: 1 });
	const second = { id: 2 };
	const arr = observable<{ id: number }[]>([]);
	arr.push(first, second);
	const seen: unknown[] = [];
	const dispose = effect(() => {
		seen.push(arr[0]);
	});
	try {
		const removed = arr.splice(0.5, 1.5);
		expect(removed[0]).toBe(first);
		expect(source(arr)[0]).toBe(second);
		expect(seen).toStrictEqual([first, second]);
	} finally {
		dispose();
	}
});
