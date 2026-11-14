import { isObservable, source, observable } from "../src";

const array = (obj: any[] = []): any[] => {
	return observable(obj);
};

describe("Parent Ownership (Strict Shallow)", () => {
	test("same source in two arrays should have independent observability", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		// Array A gets the observable
		const arrayA = array([]);
		arrayA[0] = obs;

		// Array B gets the raw source
		const arrayB = array([]);
		arrayB[0] = source(obs); // Assign the raw source, not the proxy

		// Array A should return the observable proxy
		expect(isObservable(arrayA[0])).toBe(true);
		expect(arrayA[0]).toBe(obs);

		// Array B should return the raw object (NOT the observable)
		expect(isObservable(arrayB[0])).toBe(false);
		expect(arrayB[0]).toBe(raw);
	});

	test("pushing observable vs source gives different results", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		const arrayA = array([]);
		arrayA.push(obs);

		const arrayB = array([]);
		arrayB.push(source(obs));

		expect(isObservable(arrayA[0])).toBe(true);
		expect(isObservable(arrayB[0])).toBe(false);
	});

	test("observable assignment is tracked per-index", () => {
		const raw1 = { value: 1 };
		const raw2 = { value: 2 };
		const obs1 = observable(raw1);

		const arr = array([]);
		arr[0] = obs1; // Observable at index 0
		arr[1] = raw2; // Raw at index 1

		expect(isObservable(arr[0])).toBe(true);
		expect(isObservable(arr[1])).toBe(false);
	});

	test("source in array allows structuredClone", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		const arr = array([]);
		arr.push(source(obs)); // Push the raw source

		// Should NOT throw - it's a plain object
		expect(() => structuredClone(arr[0])).not.toThrow();
	});

	test("observable at one index doesn't affect other indices with same source (throws in dev)", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		const arr = array([]);
		arr[0] = obs; // Observable at index 0

		// With parent-based tracking, assigning both observable and raw of same source throws
		expect(() => {
			arr[1] = source(obs); // Raw at index 1 (same underlying object)
		}).toThrow(/Cannot assign the same object as both observable and raw/);
	});
});

describe("Detailed ArrayAdministration behavior", () => {
	describe("Basic ownership + purity", () => {
		test("Index set/get round-trip", () => {
			const arr = array([]);
			const raw = { id: 1 };
			const obs = observable(raw);

			arr[0] = obs;
			expect(arr[0]).toBe(obs);
			expect(source(arr)[0]).toBe(raw);
			expect(isObservable(source(arr)[0])).toBe(false);
		});

		test("Per-array independence", () => {
			const raw = { id: 1 };
			const obs = observable(raw);
			const a = array([]);
			const b = array([]);

			a[0] = obs;
			b[0] = source(obs);

			expect(isObservable(a[0])).toBe(true);
			expect(isObservable(b[0])).toBe(false);
		});

		test("Same raw at different indices (throws in dev)", () => {
			const raw = { id: 1 };
			const obs = observable(raw);
			const arr = array([]);

			arr[0] = obs;

			// With parent-based tracking, assigning both observable and raw of same source throws
			expect(() => {
				arr[1] = source(obs);
			}).toThrow(/Cannot assign the same object as both observable and raw/);
		});

		test("Reassignment clears", () => {
			const obs = observable({ id: 1 });
			const arr = array([obs]);

			expect(isObservable(arr[0])).toBe(true);
			arr[0] = source(obs);
			expect(isObservable(arr[0])).toBe(false);
		});

		test("delete arr[i] clears tracking", () => {
			const obs = observable({ id: 1 });
			const arr = array([obs]);

			expect(isObservable(arr[0])).toBe(true);
			delete arr[0];
			arr[0] = source(obs);
			expect(isObservable(arr[0])).toBe(false);
		});

		test("length truncation clears", () => {
			const obs = observable({ id: 1 });
			const arr = array([obs, obs, obs]);

			expect(isObservable(arr[2])).toBe(true);
			arr.length = 2;
			arr.length = 3;
			arr[2] = source(obs);
			expect(isObservable(arr[2])).toBe(false);
		});
	});
});

describe("Ownership Propagation", () => {
	it("slice() returns elements with same identities (proxies if owned)", () => {
		const raw = { name: "item" };
		const obs = observable(raw);
		const arr = observable([obs]);

		expect(arr[0]).toBe(obs);

		const sliced = arr.slice();
		expect(sliced[0]).toBe(obs); // Should be the same proxy
		expect(isObservable(sliced)).toBe(false);
		expect(sliced[0]).toBe(obs); // Element identity preserved
	});

	it("concat() returns elements with same identities", () => {
		const obs1 = observable({ id: 1 });
		const obs2 = observable({ id: 2 });
		const arr1 = observable([obs1]);
		const arr2 = observable([obs2]);

		const combined = arr1.concat(arr2);
		expect(isObservable(combined)).toBe(false);
		expect(combined[0]).toBe(obs1);
		expect(combined[1]).toBe(obs2);
	});

	it("flat() returns elements with same identities", () => {
		const obs = observable({ id: 1 });
		const arr = observable([[obs]]);

		const flattened = arr.flat();
		expect(flattened[0]).toBe(obs);
	});

	it("filter() returns elements with same identities", () => {
		const obs1 = observable({ id: 1, active: true });
		const obs2 = observable({ id: 2, active: false });
		const arr = observable([obs1, obs2]);

		const filtered = arr.filter((item) => item.active);
		expect(filtered.length).toBe(1);
		expect(filtered[0]).toBe(obs1);
	});

	it("find() and filter() return observed identities even when the source stores raw values", () => {
		const obs = observable({ id: 1, active: true });
		const arr = array([]);

		arr.push(obs);

		expect(source(arr)[0]).not.toBe(obs);
		expect(arr[0]).toBe(obs);

		const found = arr.find((item) => item.id === 1);
		const filtered = arr.filter((item) => item.id === 1);

		expect(found).toBe(obs);
		expect(isObservable(filtered)).toBe(false);
		expect(filtered).toHaveLength(1);
		expect(filtered[0]).toBe(obs);
	});

	it("reduce() and reduceRight() callbacks receive observed identities even when the source stores raw values", () => {
		const obs1 = observable({ id: 1 });
		const obs2 = observable({ id: 2 });
		const arr = array([]);

		arr.push(obs1, obs2);

		expect(source(arr)[0]).not.toBe(obs1);
		expect(source(arr)[1]).not.toBe(obs2);
		expect(arr[0]).toBe(obs1);
		expect(arr[1]).toBe(obs2);

		const reduced = arr.reduce((items: unknown[], item, index, self) => {
			expect(item).toBe(arr[index]);
			expect(self).toBe(arr);
			items.push(item);
			return items;
		}, [] as unknown[]);

		const reducedRight = arr.reduceRight(
			(items: unknown[], item, index, self) => {
				expect(item).toBe(arr[index]);
				expect(self).toBe(arr);
				items.push(item);
				return items;
			},
			[] as unknown[]
		);

		expect(reduced).toStrictEqual([obs1, obs2]);
		expect(reducedRight).toStrictEqual([obs2, obs1]);
	});

	it("pop() returns removed item using same identity", () => {
		const obs = observable({ id: 1 });
		const arr = observable([obs]);

		const popped = arr.pop();
		expect(popped).toBe(obs);
	});

	it("shift() returns removed item using same identity", () => {
		const obs = observable({ id: 1 });
		const arr = observable([obs]);

		const shifted = arr.shift();
		expect(shifted).toBe(obs);
	});

	it("splice() returns removed items using same identity", () => {
		const obs1 = observable({ id: 1 });
		const obs2 = observable({ id: 2 });
		const arr = observable([obs1, obs2]);

		const removed = arr.splice(0, 1);
		expect(removed[0]).toBe(obs1);
		expect(arr[0]).toBe(obs2);
	});
});

describe("Detailed ArrayAdministration behavior", () => {
	describe("Basic ownership + purity", () => {
		test("Out-of-bounds assignment behavior", () => {
			const arr = array([1, 2]);
			const obs = observable({ id: 100 });
			// Library now supports out-of-bounds assignment (sparse arrays)
			arr[100] = obs;
			expect(arr.length).toBe(101);
			expect(arr[100]).toBe(obs);
			expect(99 in arr).toBe(false);
		});

		test('String index parity: arr["0"] behaves like arr[0]', () => {
			const arr = array([]);
			const raw = { id: 1 };
			const obs = observable(raw);

			(arr as unknown as Record<string, unknown>)["0"] = obs;

			expect(arr[0]).toBe(obs);
			expect(isObservable(arr[0])).toBe(true);
			expect(source(arr)[0]).toBe(raw);
			expect(isObservable(source(arr)[0])).toBe(false);
		});
	});

	describe("Iteration must match reads", () => {
		test("for..of / Array.from(arr)", () => {
			const obs1 = observable({ id: 1 });
			const raw2 = { id: 2 };
			const arr = array([obs1, raw2]);

			const items = Array.from(arr);
			expect(items[0]).toBe(obs1);
			expect(isObservable(items[0])).toBe(true);
			expect(items[1]).toBe(raw2);
			expect(isObservable(items[1])).toBe(false);

			const itemsOf = [];
			for (const item of arr) itemsOf.push(item);
			expect(itemsOf[0]).toBe(obs1);
			expect(itemsOf[1]).toBe(raw2);
		});

		test("arr.values()", () => {
			const obs1 = observable({ id: 1 });
			const arr = array([obs1]);
			const values = Array.from(arr.values());
			expect(values[0]).toBe(obs1);
			expect(isObservable(values[0])).toBe(true);
		});

		test("arr.entries()", () => {
			const obs1 = observable({ id: 1 });
			const arr = array([obs1]);
			const entries = Array.from(arr.entries());
			expect(entries[0][1]).toBe(obs1);
			expect(isObservable(entries[0][1])).toBe(true);
		});

		test("arr.forEach / arr.map / arr.some / arr.every", () => {
			const obs1 = observable({ id: 1 });
			const raw2 = { id: 2 };
			const arr = array([obs1, raw2]);

			arr.forEach((v, i) => {
				expect(v).toBe(arr[i]);
				expect(isObservable(v)).toBe(i === 0);
			});

			const mapped = arr.map((v, i) => {
				expect(v).toBe(arr[i]);
				return v;
			});
			expect(isObservable(mapped[0])).toBe(true);
			expect(isObservable(mapped[1])).toBe(false);

			arr.some((v, i) => {
				expect(v).toBe(arr[i]);
				return false;
			});

			arr.every((v, i) => {
				expect(v).toBe(arr[i]);
				return true;
			});
		});

		test("arr.reduce / arr.reduceRight", () => {
			const obs1 = observable({ id: 1 });
			const raw2 = { id: 2 };
			const arr = array([obs1, raw2]);

			const reduced = arr.reduce((items: unknown[], v, i, self) => {
				expect(v).toBe(arr[i]);
				expect(self).toBe(arr);
				items.push(v);
				return items;
			}, [] as unknown[]);

			const reducedRight = arr.reduceRight((items: unknown[], v, i, self) => {
				expect(v).toBe(arr[i]);
				expect(self).toBe(arr);
				items.push(v);
				return items;
			}, [] as unknown[]);

			expect(reduced).toStrictEqual([arr[0], arr[1]]);
			expect(reducedRight).toStrictEqual([arr[1], arr[0]]);
		});
	});

	describe("Tracking must follow items through mutators", () => {
		test("splice insert/delete shifts tracking", () => {
			const o1 = observable({ id: 1 });
			const o2 = observable({ id: 2 });
			const o3 = observable({ id: 3 });
			const arr = array([o1, o2, o3]);

			// Delete o2
			arr.splice(1, 1);
			expect(arr[0]).toBe(o1);
			expect(arr[1]).toBe(o3);
			expect(isObservable(arr[1])).toBe(true);

			// Insert NEW
			const o4 = observable({ id: 4 });
			arr.splice(1, 0, o4);
			expect(arr[1]).toBe(o4);
			expect(arr[2]).toBe(o3);
			expect(isObservable(arr[2])).toBe(true);
		});

		test("shift / unshift", () => {
			const o1 = observable({ id: 1 });
			const o2 = observable({ id: 2 });
			const arr = array([o1, o2]);

			arr.shift();
			expect(arr[0]).toBe(o2);
			expect(isObservable(arr[0])).toBe(true);

			const o3 = observable({ id: 3 });
			arr.unshift(o3);
			expect(arr[0]).toBe(o3);
			expect(arr[1]).toBe(o2);
			expect(isObservable(arr[1])).toBe(true);
		});

		test("reverse preserves tracking by permutation", () => {
			const o1 = observable({ id: 1 });
			const r2 = { id: 2 };
			const o3 = observable({ id: 3 });
			const arr = array([o1, r2, o3]);

			arr.reverse();
			expect(arr[0]).toBe(o3);
			expect(isObservable(arr[0])).toBe(true);
			expect(arr[1]).toBe(r2);
			expect(isObservable(arr[1])).toBe(false);
			expect(arr[2]).toBe(o1);
			expect(isObservable(arr[2])).toBe(true);
		});

		test("sort preserves tracking by permutation", () => {
			const o1 = observable({ id: 3 });
			const r2 = { id: 1 };
			const o3 = observable({ id: 2 });
			const arr = array([o1, r2, o3]);

			// Sort by id
			arr.sort((a, b) => a.id - b.id);

			expect(arr[0].id).toBe(1);
			expect(isObservable(arr[0])).toBe(false);
			expect(arr[1].id).toBe(2);
			expect(isObservable(arr[1])).toBe(true);
			expect(arr[1]).toBe(o3);
			expect(arr[2].id).toBe(3);
			expect(isObservable(arr[2])).toBe(true);
			expect(arr[2]).toBe(o1);
		});

		test("copyWithin propagates tracking correctly", () => {
			const o1 = observable({ id: 1 });
			const r2 = { id: 2 };
			const arr = array([o1, r2, 3, 4]);

			// Copy [o1, r2] to indices [2, 3]
			arr.copyWithin(2, 0, 2);
			expect(arr[2]).toBe(o1);
			expect(isObservable(arr[2])).toBe(true);
			expect(arr[3]).toBe(r2);
			expect(isObservable(arr[3])).toBe(false);

			// Overlap case
			const arr2 = array([o1, r2, 3]);
			arr2.copyWithin(1, 0, 2); // [o1, o1, r2]
			expect(arr2[1]).toBe(o1);
			expect(isObservable(arr2[1])).toBe(true);
			expect(arr2[2]).toBe(r2);
			expect(isObservable(arr2[2])).toBe(false);
		});

		test("fill sets/clears tracking across the filled range", () => {
			const arr = array([1, 2, 3, 4]);
			const obs = observable({ id: 10 });

			arr.fill(obs, 1, 3);
			expect(arr[1]).toBe(obs);
			expect(isObservable(arr[1])).toBe(true);
			expect(arr[2]).toBe(obs);
			expect(isObservable(arr[2])).toBe(true);
			expect(source(arr)[1]).toStrictEqual(source(obs));

			// Fill with raw
			const raw = { id: 20 };
			arr.fill(raw, 0, 2);
			expect(arr[0]).toStrictEqual(raw);
			expect(isObservable(arr[0])).toBe(false);
			expect(arr[1]).toStrictEqual(raw);
			expect(isObservable(arr[1])).toBe(false);
			expect(isObservable(arr[2])).toBe(true); // Still obs from before
		});

		test("fill does not break structuredClone(source(arr))", () => {
			const arr = array([1, 2, 3, 4]);
			const obs = observable({ id: 10 });

			arr.fill(obs, 1, 3);

			expect(() => structuredClone(source(arr))).not.toThrow();
			expect(isObservable(source(arr)[1])).toBe(false);
			expect(isObservable(source(arr)[2])).toBe(false);
		});
	});
});

describe("Source purity: user-provided proxies preserved (no sanitization)", () => {
	test("User-provided proxy is preserved in source", () => {
		const obs = observable({ id: 1 });
		const arr = observable([obs]);

		expect(arr[0]).toBe(obs);
		expect(source(arr)[0]).toBe(obs);
		expect(isObservable(source(arr)[0])).toBe(true);
	});

	test("structuredClone(source(arr)) may throw when user provided proxies", () => {
		const obs = observable({ id: 1 });
		const arr = observable([obs]);

		expect(() => structuredClone(source(arr))).toThrow();
	});

	test("Library writes remain proxy-free even when initial source contained proxies", () => {
		const obs = observable({ id: 1 });
		const arr = observable([obs]);
		const raw2 = { id: 2 };
		const obs2 = observable(raw2);

		arr.push(obs2);

		expect(arr[1]).toBe(obs2);
		expect(source(arr)[1]).toBe(raw2);
		expect(isObservable(source(arr)[1])).toBe(false);
	});

	test("Mutators do not auto-unwrap pre-existing proxies (reverse)", () => {
		const obs = observable({ id: 1 });
		const arr = observable([obs, { id: 2 }]);

		arr.reverse();

		expect(source(arr)[1]).toBe(obs);
		expect(isObservable(source(arr)[1])).toBe(true);
	});

	test("Mutators do not auto-unwrap pre-existing proxies (sort)", () => {
		const obs = observable({ id: 1 });
		const arr = observable([obs, { id: 2 }]);

		arr.sort((a, b) => a.id - b.id);

		expect(source(arr)[0]).toBe(obs);
		expect(isObservable(source(arr)[0])).toBe(true);
	});

	test("Mutators do not auto-unwrap pre-existing proxies (copyWithin)", () => {
		const obs = observable({ id: 1 });
		const arr = observable([obs, { id: 2 }, { id: 3 }]);

		arr.copyWithin(1, 0, 1);

		expect(source(arr)[1]).toBe(obs);
		expect(isObservable(source(arr)[1])).toBe(true);
	});

	test("Mutators do not auto-unwrap pre-existing proxies (fill)", () => {
		const obs = observable({ id: 1 });
		const arr = observable([obs, { id: 2 }, { id: 3 }]);

		arr.fill({ id: 4 }, 1, 2);

		expect(source(arr)[0]).toBe(obs);
		expect(isObservable(source(arr)[0])).toBe(true);
	});
});
