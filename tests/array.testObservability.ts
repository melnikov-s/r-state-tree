import { isObservable, reaction, source, observable, effect } from "../src";
import { getInternalNode } from "../src/observables/internal/lookup";

const array = (obj: any[] = []): any[] => {
	return observable(obj);
};

test("can observe a single index", () => {
	const ar = array([0, 1]);
	let count = 0;

	effect(() => {
		count++;
		ar[0];
	});

	expect(count).toBe(1);
	ar[1]++;
	expect(count).toBe(1);
	ar.push(2);
	expect(count).toBe(1);
	ar.pop();
	expect(count).toBe(1);
	ar[0]++;
	expect(count).toBe(2);
	ar[0] = ar[0];
	expect(count).toBe(2);
	ar.unshift(42);
	expect(count).toBe(3);
	ar[0]++;
	expect(count).toBe(4);
	ar.shift();
	expect(count).toBe(5);
});

test("can observe multiple indices", () => {
	const ar = array([0, 1, 2, 3, 4, 5]);
	const maxIndex = 5;
	let count = 0;

	effect(() => {
		count++;
		for (let i = 0; i <= maxIndex; i++) {
			ar[i];
		}
	});

	expect(count).toBe(1);

	for (let i = 0; i < maxIndex; i++) {
		ar[i]++;
	}
	const newCount = maxIndex + 1;
	expect(count).toBe(newCount);
	ar.push(6);
	expect(count).toBe(newCount);
	ar.pop();
	expect(count).toBe(newCount);
	ar.pop();
	expect(count).toBe(newCount + 1);
	ar.reverse();
	expect(count).toBe(newCount + 2);
});

test("Array.length", () => {
	const ar = array([0, 0, 0, 0, 0, 0]);
	let count = 0;

	effect(() => {
		count++;
		ar.length;
	});

	expect(count).toBe(1);
	ar[0]++;
	expect(count).toBe(1);
	ar.pop();
	expect(count).toBe(2);
	ar.push(0);
	expect(count).toBe(3);
});

describe("Array Meta-Operations Observability", () => {
	describe("ownKeys tracking (Object.keys, for...in)", () => {
		test("effect(() => Object.keys(arr).length) reruns on push", () => {
			const arr = array([1, 2, 3]);
			let count = 0;
			let keysLength = 0;

			effect(() => {
				count++;
				keysLength = Object.keys(arr).length;
			});

			expect(count).toBe(1);
			expect(keysLength).toBe(3);

			arr.push(4);
			expect(count).toBe(2);
			expect(keysLength).toBe(4);
		});

		test("effect(() => Object.keys(arr).length) reruns on splice", () => {
			const arr = array([1, 2, 3, 4, 5]);
			let count = 0;
			let keysLength = 0;

			effect(() => {
				count++;
				keysLength = Object.keys(arr).length;
			});

			expect(count).toBe(1);
			expect(keysLength).toBe(5);

			// Remove 2 elements
			arr.splice(1, 2);
			expect(count).toBe(2);
			expect(keysLength).toBe(3);

			// Insert 3 elements
			arr.splice(1, 0, 10, 20, 30);
			expect(count).toBe(3);
			expect(keysLength).toBe(6);
		});

		test("for...in loop is reactive", () => {
			const arr = array([1, 2]);
			let count = 0;
			let keys: string[] = [];

			effect(() => {
				count++;
				keys = [];
				for (const key in arr) {
					keys.push(key);
				}
			});

			expect(count).toBe(1);
			expect(keys).toEqual(["0", "1"]);

			arr.push(3);
			expect(count).toBe(2);
			expect(keys).toEqual(["0", "1", "2"]);
		});
	});

	describe("has tracking (in operator)", () => {
		test('effect(() => ("0" in arr)) reruns when index 0 appears', () => {
			const arr = array([]);
			let count = 0;
			let hasIndex0 = false;

			effect(() => {
				count++;
				hasIndex0 = 0 in arr;
			});

			expect(count).toBe(1);
			expect(hasIndex0).toBe(false);

			arr.push("first");
			expect(count).toBe(2);
			expect(hasIndex0).toBe(true);
		});

		test('effect(() => ("0" in arr)) reruns when index 0 disappears via shift', () => {
			const arr = array([1, 2, 3]);
			let count = 0;
			let hasIndex0 = false;

			effect(() => {
				count++;
				hasIndex0 = 0 in arr;
			});

			expect(count).toBe(1);
			expect(hasIndex0).toBe(true);

			// Remove all elements
			arr.shift();
			arr.shift();
			arr.shift();

			// Each shift should trigger the effect
			expect(hasIndex0).toBe(false);
		});

		test('effect(() => ("0" in arr)) reruns when delete arr[0]', () => {
			const arr = array([1, 2, 3]);
			let count = 0;
			let hasIndex0 = false;

			effect(() => {
				count++;
				hasIndex0 = 0 in arr;
			});

			expect(count).toBe(1);
			expect(hasIndex0).toBe(true);

			delete arr[0];
			expect(count).toBe(2);
			expect(hasIndex0).toBe(false);
		});

		test('"length" in arr works without tracking as special property', () => {
			const arr = array([1, 2, 3]);
			expect("length" in arr).toBe(true);
		});
	});

	describe("deleteProperty updates", () => {
		test("delete arr[i] triggers effect on that index", () => {
			const arr = array([1, 2, 3]);
			let count = 0;
			let val: number | undefined;

			effect(() => {
				count++;
				val = arr[0];
			});

			expect(count).toBe(1);
			expect(val).toBe(1);

			delete arr[0];
			expect(count).toBe(2);
			expect(val).toBe(undefined);
		});

		test("delete arr[i] triggers Object.keys observers", () => {
			const arr = array([1, 2, 3]);
			let count = 0;
			let keys: string[] = [];

			effect(() => {
				count++;
				keys = Object.keys(arr);
			});

			expect(count).toBe(1);
			expect(keys).toEqual(["0", "1", "2"]);

			delete arr[1];
			expect(count).toBe(2);
			// After delete, index 1 becomes a hole, so Object.keys won't include it
			expect(keys).toEqual(["0", "2"]);
		});
	});

	describe("Glitch-free ownership tracking", () => {
		test("assigning observable sets ownership and triggers reaction", () => {
			const raw1 = { id: 1 };
			const raw2 = { id: 2 };
			const obs2 = observable(raw2);
			const arr = array([raw1]);

			const observed: boolean[] = [];

			effect(() => {
				observed.push(isObservable(arr[0]));
			});

			// Initial read should be non-observable (raw was assigned)
			expect(observed).toEqual([false]);

			// Assign a DIFFERENT observable (different underlying source)
			arr[0] = obs2;

			// Reaction should fire and see the new ownership (observable)
			expect(observed).toEqual([false, true]);
		});

		test("assigning source clears ownership before reaction runs", () => {
			const raw = { id: 1 };
			const obs = observable(raw);
			const arr = array([obs]);

			const observed: boolean[] = [];

			effect(() => {
				observed.push(isObservable(arr[0]));
			});

			// Initial read should be observable
			expect(observed).toEqual([true]);

			// Assign the raw source
			arr[0] = source(obs);

			// Reaction should see the new ownership (non-observable), not stale state
			expect(observed).toEqual([true, false]);
		});
	});

	describe("Derived container operations ownership propagation", () => {
		test("slice/concat/flat/filter should preserve proxy identities", () => {
			const raw = { id: 1 };
			const obs = observable(raw);
			const arr = array([obs, { id: 2 }]);

			expect(isObservable(arr[0])).toBe(true);
			expect(arr[0]).toBe(obs);
			expect(isObservable(arr[1])).toBe(false);

			const sliced = arr.slice();
			expect(isObservable(sliced)).toBe(false);
			expect(sliced[0]).toBe(obs);
			expect(isObservable(sliced[0])).toBe(true);
			expect(isObservable(sliced[1])).toBe(false);
			expect(sliced).not.toBe(source(arr));
			expect(sliced[0]).toBe(obs); // In a raw array, proxies remain as proxies
		});

		test("concat should preserve proxy identities from multiple arrays", () => {
			const obs1 = observable({ id: 1 });
			const obs2 = observable({ id: 2 });
			const arr1 = array([obs1]);
			const arr2 = array([obs2]);

			const combined = arr1.concat(arr2);
			expect(isObservable(combined)).toBe(false);
			expect(combined[0]).toBe(obs1);
			expect(combined[1]).toBe(obs2);
		});

		test("filter should preserve proxy identities", () => {
			const obs = observable({ id: 1, active: true });
			const arr = array([obs, { id: 2, active: false }]);

			const filtered = arr.filter((item: any) => item.id === 1);
			expect(isObservable(filtered)).toBe(false);
			expect(filtered.length).toBe(1);
			expect(filtered[0]).toBe(obs);
		});

		test("flat should preserve proxy identities", () => {
			const obs = observable({ id: 1 });
			const arr = array([[obs]]);

			const flattened = arr.flat();
			expect(isObservable(flattened)).toBe(false);
			expect(flattened[0]).toBe(obs);
		});

		test("pop/shift/splice should return removed items as proxies when owned", () => {
			const obs = observable({ id: 1 });
			const arr = array([obs, { id: 2 }]);

			const popped = arr.pop();
			expect(popped).toEqual({ id: 2 });
			expect(isObservable(popped)).toBe(false);

			const shifted = arr.shift();
			expect(shifted).toBe(obs);
			expect(isObservable(shifted)).toBe(true);

			const arr2 = array([obs]);
			const spliced = arr2.splice(0, 1);
			expect(spliced[0]).toBe(obs);
			expect(isObservable(spliced[0])).toBe(true);
		});

		test("sort should return the same observable proxy and use observed values", () => {
			const obs1 = observable({ id: 2 });
			const obs2 = observable({ id: 1 });
			const arr = array([obs1, obs2]);

			const observed = new Set<any>();

			const result = arr.sort((a, b) => {
				observed.add(a);
				observed.add(b);
				return a.id - b.id;
			});

			expect(result).toBe(arr);
			expect(isObservable(result)).toBe(true);

			// The comparator should have received proxies
			expect(observed.has(obs1)).toBe(true);
			expect(observed.has(obs2)).toBe(true);
			expect(observed.size).toBe(2);

			expect(arr[0]).toBe(obs2);
			expect(arr[1]).toBe(obs1);
		});
	});
});

describe("Structural mutation invalidation correctness", () => {
	test("unshift invalidates shifted index reads", () => {
		const arr = array([0, 1, 2]);
		let count = 0;
		let val: number | undefined;

		effect(() => {
			count++;
			val = arr[1];
		});

		// Initial state: arr[1] is 1
		expect(count).toBe(1);
		expect(val).toBe(1);

		// Unshift 42 -> [42, 0, 1, 2]
		// arr[1] acts as index 1, which is now 0 (shifted from index 0)
		arr.unshift(42);

		// Should rerun because index 1 changed from 1 to 0
		expect(count).toBe(2);
		expect(val).toBe(0);
	});

	test("shift invalidates shifted index reads", () => {
		const arr = array([0, 1, 2]);
		let count = 0;
		let val: number | undefined;

		effect(() => {
			count++;
			val = arr[1];
		});

		// Initial state: arr[1] is 1
		expect(count).toBe(1);
		expect(val).toBe(1);

		// Shift removes 0 -> [1, 2]
		// arr[1] is now 2 (shifted from index 2)
		arr.shift();

		expect(count).toBe(2);
		expect(val).toBe(2);
	});

	test("splice insert at front invalidates subsequent indices", () => {
		const arr = array([0, 1, 2, 3]);
		let count = 0;
		let val: number | undefined;

		effect(() => {
			count++;
			val = arr[2];
		});

		// Initial: arr[2] is 2
		expect(count).toBe(1);
		expect(val).toBe(2);

		// Splice at 0, insert "x" -> ["x", 0, 1, 2, 3]
		// arr[2] is now 1 (shifted right)
		arr.splice(0, 0, "x");

		expect(count).toBe(2);
		expect(val).toBe(1);
	});

	test("splice insert at middle invalidates subsequent indices", () => {
		const arr = array([0, 1, 2, 3]);
		let count = 0;
		let val: number | undefined;

		effect(() => {
			count++;
			val = arr[3];
		});

		// Initial: arr[3] is 3
		expect(count).toBe(1);
		expect(val).toBe(3);

		// Splice at 1, insert "x" -> [0, "x", 1, 2, 3]
		// arr[3] is now 2. Shift happened at index >= 1.
		arr.splice(1, 0, "x");

		expect(count).toBe(2);
		expect(val).toBe(2);
	});

	test("splice delete at front invalidates subsequent indices", () => {
		const arr = array([0, 1, 2, 3]);
		let count = 0;
		let val: number | undefined;

		effect(() => {
			count++;
			val = arr[1];
		});

		// Initial: arr[1] is 1
		expect(count).toBe(1);
		expect(val).toBe(1);

		// Splice delete 1 at 0 -> [1, 2, 3]
		// arr[1] is now 2
		arr.splice(0, 1);

		expect(count).toBe(2);
		expect(val).toBe(2);
	});
});

describe("SignalMap per-key cleanup", () => {
	test("per-key signal nodes are cleaned up when array becomes unobserved", () => {
		const arr = observable([1]);
		const dispose1 = effect(() => void arr[0]);
		const node1 = getInternalNode(arr, 0);
		dispose1();
		const dispose2 = effect(() => void arr[0]);
		const node2 = getInternalNode(arr, 0);
		expect(node2).not.toBe(node1); // Node was cleared and recreated
		dispose2();
	});
});
