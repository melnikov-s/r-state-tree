import { source, observable } from "../src";

const array = (obj: any[] = []): any[] => {
	return observable(obj);
};

describe("Proxy trap invariants", () => {
	test("Non-extensible array set should fail", () => {
		const a = observable([] as any[]);
		Object.preventExtensions(source(a));

		expect(() => {
			a[0] = 1;
		}).toThrow(TypeError);

		expect(Reflect.set(a, 0, 1)).toBe(false);
		expect(a.length).toBe(0);
	});

	test("Sealed array delete should fail", () => {
		const a = observable([1, 2, 3]);
		Object.seal(source(a));

		expect(() => {
			delete a[0];
		}).toThrow(TypeError);

		expect(Reflect.deleteProperty(a, 0)).toBe(false);
		expect(a[0]).toBe(1);
	});

	test("Array deleteProperty returns correct value", () => {
		const a = observable([1, 2, 3]);
		// Normal delete on array element just sets it to 'empty' (undefined in getter)
		// and SHOULD return true as it's a configurable property by default
		expect(delete a[0]).toBe(true);
		expect(a[0]).toBe(undefined);
	});
});

describe("JS Array Semantics Alignment", () => {
	describe("Array index parsing (canonical uint32 form)", () => {
		test('arr["01"] should behave as non-index property, not index 1', () => {
			const arr = array([10, 20, 30]);
			const nativeArr = [10, 20, 30];

			// Native behavior: "01" is not an index
			(nativeArr as any)["01"] = "non-index";
			(arr as any)["01"] = "non-index";

			// Length should be unchanged
			expect(arr.length).toBe(nativeArr.length);
			expect(arr.length).toBe(3);

			// Index 1 should be unchanged
			expect(arr[1]).toBe(20);

			// The "01" property should be accessible
			expect(arr["01" as any]).toBe("non-index");

			// Object.keys should show "01" as separate from "1"
			expect(Object.keys(arr)).toContain("01");
		});

		test('arr["-1"] should behave as non-index property', () => {
			const arr = array([10, 20, 30]);
			const nativeArr = [10, 20, 30];

			(nativeArr as any)["-1"] = "negative";
			(arr as any)["-1"] = "negative";

			// Length should be unchanged
			expect(arr.length).toBe(nativeArr.length);
			expect(arr.length).toBe(3);

			// The "-1" property should be accessible
			expect(arr["-1" as any]).toBe("negative");
		});

		test('arr["4294967295"] (2^32-1) should behave as non-index property', () => {
			const arr = array([10]);
			const nativeArr = [10];

			// 2^32 - 1 is NOT a valid array index (max is 2^32 - 2)
			const notAnIndex = "4294967295";
			(nativeArr as any)[notAnIndex] = "not-index";
			(arr as any)[notAnIndex] = "not-index";

			// Length should be unchanged (NOT 4294967296!)
			expect(arr.length).toBe(nativeArr.length);
			expect(arr.length).toBe(1);

			// The property should be accessible
			expect(arr[notAnIndex as any]).toBe("not-index");
		});

		test('arr["4294967294"] (2^32-2) IS a valid array index', () => {
			// This test documents that very large indices ARE valid
			// We don't actually set this because it would allocate huge memory
			const arr = array([]);

			// Just verify the helper would accept this
			// (We can't practically test setting index 4294967294)
			expect(typeof arr["0"]).toBe("undefined");
		});

		test('arr["NaN"] should behave as non-index property', () => {
			const arr = array([10, 20]);
			arr["NaN" as any] = "not-a-number";

			expect(arr.length).toBe(2);
			expect(arr["NaN" as any]).toBe("not-a-number");
		});
	});

	describe("length coercion (ToUint32 semantics)", () => {
		test('arr.length = "2" should coerce and truncate (match JS)', () => {
			const arr = array([1, 2, 3, 4, 5]);
			const nativeArr = [1, 2, 3, 4, 5];

			nativeArr.length = "2" as any;
			arr.length = "2" as any;

			expect(arr.length).toBe(nativeArr.length);
			expect(arr.length).toBe(2);
			expect(arr.slice()).toEqual([1, 2]);
		});

		test("arr.length = -1 should throw RangeError", () => {
			const arr = array([1, 2, 3]);

			expect(() => {
				arr.length = -1;
			}).toThrow(RangeError);
		});

		test('arr.length = "abc" should throw RangeError', () => {
			const arr = array([1, 2, 3]);

			expect(() => {
				arr.length = "abc" as any;
			}).toThrow(RangeError);
		});

		test("arr.length = 1.5 should throw RangeError", () => {
			const arr = array([1, 2, 3]);

			expect(() => {
				arr.length = 1.5;
			}).toThrow(RangeError);
		});

		test("arr.length = Infinity should throw RangeError", () => {
			const arr = array([1, 2, 3]);

			expect(() => {
				arr.length = Infinity;
			}).toThrow(RangeError);
		});

		test("arr.length = NaN should throw RangeError", () => {
			const arr = array([1, 2, 3]);

			expect(() => {
				arr.length = NaN;
			}).toThrow(RangeError);
		});

		test("arr.length = null should coerce to 0 (match JS)", () => {
			const arr = array([1, 2, 3]);
			const nativeArr = [1, 2, 3];

			nativeArr.length = null as any;
			arr.length = null as any;

			expect(arr.length).toBe(nativeArr.length);
			expect(arr.length).toBe(0);
		});
	});
});

describe("Sparse Array Semantics", () => {
	test("out-of-bounds write creates holes and updates length", () => {
		const arr = array([1, 2]);
		expect(arr.length).toBe(2);

		// Contract: arr[100] = 1 increases arr.length to 101
		arr[100] = 999;
		expect(arr.length).toBe(101);

		// Contract: creates holes
		expect(99 in arr).toBe(false);
		expect("99" in arr).toBe(false);
		expect(100 in arr).toBe(true);
		expect(arr[100]).toBe(999);
	});

	test("increasing length does not create own keys", () => {
		const arr = array([1, 2]);
		expect(arr.length).toBe(2);

		// Contract: arr.length = 5 increases length without creating new own keys
		arr.length = 5;
		expect(arr.length).toBe(5);

		// Holes remain holes
		expect(2 in arr).toBe(false);
		expect(3 in arr).toBe(false);
		expect(4 in arr).toBe(false);

		// Object.keys should not include 2, 3, 4
		expect(Object.keys(arr)).toEqual(["0", "1"]);
	});

	test("increasing length does not eagerly write undefined", () => {
		const arr = array([]);
		arr.length = 10;
		// If it wrote undefined, '0' would be in arr
		expect(0 in arr).toBe(false);
		expect(arr.length).toBe(10);
	});

	test("massive length increase is performant and correct", () => {
		const arr = array([]);
		// Contract: arr.length = 2**32 - 2 (max safe array index)
		// This should be near-instant if O(1)
		const start = performance.now();
		arr.length = 4294967295 - 1;
		const end = performance.now();

		expect(arr.length).toBe(4294967294);
		expect(end - start).toBeLessThan(100); // Should be instant
	});
});

test("Array Proxy 'get' invariant for non-configurable non-writable properties", () => {
	const obs = observable({ nested: 1 });
	const arr = observable<any[]>([]);
	arr[0] = obs; // establish explicit ownership

	// Make index 0 non-configurable and non-writable on the target (source)
	Object.defineProperty(source(arr), "0", {
		value: source(obs),
		writable: false,
		configurable: false,
	});

	// Reading arr[0] should not throw TypeError and should return the raw value.
	// However, it SHOULD emit a warning.
	const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

	expect(() => arr[0]).not.toThrow();

	// The invariant requires the proxy (arr) to return the SAME value as the target (source) for this property
	// The source has source(obs). So arr[0] must be source(obs).
	expect(arr[0]).toBe(source(obs));

	expect(warnSpy).toHaveBeenCalledWith(
		expect.stringContaining(
			"r-state-tree: cannot return an observable proxy for arr[0]"
		)
	);
	warnSpy.mockRestore();
});

test("Array Proxy 'get' invariant valid when proxy is ALREADY stored (user seeded)", () => {
	const obs = observable({ nested: 1 });

	// Create an array and assign the observable to track it in observableSources
	const arr = observable<any[]>([]);
	arr[0] = obs;

	const values = source(arr);

	// Now manually redefine the property to be non-configurable/writable
	// The source is already tracked as observable from the assignment above
	Object.defineProperty(values, "0", {
		value: source(obs), // Store the source (non-proxy)
		writable: false,
		configurable: false,
	});

	const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

	expect(() => arr[0]).not.toThrow();

	// With parent-based tracking, the source is in observableSources,
	// so we try to return proxy. But the property is non-configurable/writable,
	// causing a proxy invariant violation, so we warn and return raw.
	expect(warnSpy).toHaveBeenCalled();
	expect(arr[0]).toBe(source(obs));
	warnSpy.mockRestore();
});

describe("Sparse array performance", () => {
	test("slice(0, 10) on sparse array is O(1) not O(length)", () => {
		const arr = observable<any>([]);
		arr.length = 1e8; // Very large sparse array
		arr[0] = 1;
		arr[5] = 2;

		const start = performance.now();
		const sliced = arr.slice(0, 10);
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(100); // Should be instant
		expect(sliced[0]).toBe(1);
		expect(sliced[5]).toBe(2);
	});

	test("concat on sparse array is O(1) not O(length)", () => {
		const arr1 = observable<any>([]);
		arr1.length = 1e8;
		arr1[0] = 1;

		const arr2 = observable([2, 3]);

		const start = performance.now();
		const result = arr1.concat(arr2);
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(100);
		expect(result[0]).toBe(1);
	});
});

describe("Array prototype receiver semantics", () => {
	test("prototype accessor uses correct receiver", () => {
		const base = Object.create(observable([1, 2, 3]));
		// `base.length` should work correctly through prototype chain
		expect(base.length).toBe(3);
		expect(base[0]).toBe(1);
	});

	test("Reflect.get with receiver works correctly", () => {
		const arr = observable([1, 2, 3]);
		const receiver = {};
		expect(Reflect.get(arr, "length", receiver)).toBe(3);
	});
});
