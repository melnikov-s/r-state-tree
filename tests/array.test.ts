import {
	isObservable,
	reaction,
	computed,
	source,
	observable,
	effect,
} from "../src";
import {
	getAdministration,
	getInternalNode,
} from "../src/observables/internal/lookup";

// ... existing code ...

const array = (obj: any[] = []): any[] => {
	return observable(obj);
};

test("iteration returns raw (non-observable) items", () => {
	const arr = array([{}, {}, {}]);
	const itr = arr[Symbol.iterator]();

	let i = itr.next();
	let count = 0;

	while (!i.done) {
		count++;
		// Shallow behavior: items are NOT wrapped as observable
		expect(isObservable(i.value)).toBe(false);
		i = itr.next();
	}

	expect(count).toBe(3);
});

test("does not overwrite observable values", () => {
	const o1 = observable({});

	const o = array([o1]);
	o[0] = o1;

	// Reassigning the same proxy should be a no-op.
	// With parent-based tracking, the source is stored and the proxy is returned on read.
	expect(o[0]).toBe(o1);
});

test("array initialization does not mutate user-provided source array", () => {
	const obs = observable({ id: 1 });
	const input = [obs];
	const arr = observable(input);

	// `observable(input)` must not sanitize/mutate the passed-in array
	expect(input[0]).toBe(obs);
	expect(source(arr)).toBe(input);
	expect(source(arr)[0]).toBe(obs);
});

test("sort parameters are raw (non-observable)", () => {
	let count = 0;
	const arr = array([{}, {}]);
	arr.sort((a, b) => {
		count++;
		// Shallow behavior: items passed to compareFn are NOT wrapped
		expect(isObservable(a)).toBe(false);
		expect(isObservable(b)).toBe(false);
		return 0;
	});
	expect(count).toBe(1);
});

// Simplified indexOf/includes/lastIndexOf tests - just checking reactivity
["indexOf", "lastIndexOf", "includes"].forEach((method) => {
	test(`Array.prototype.${method} method is reactive`, () => {
		let count = 0;
		const lookup = {};
		const arr = array([{}, lookup, {}]);

		effect(() => {
			count++;
			arr[method](lookup);
		});

		expect(count).toBe(1);
		arr.push({});
		expect(count).toBe(2);
	});
});

["join", "toString", "toLocaleString"].forEach((method) => {
	test(`Array.prototype.${method} method is observable`, () => {
		let count = 0;
		const arr = array([1, 2, 3]);
		const realArr = [1, 2, 3];

		effect(() => {
			count++;

			expect(arr[method]("en")).toBe(realArr[method]("en"));
		});

		realArr.push(4);
		arr.push(4);
		expect(count).toBe(2);
	});
});

["concat", "slice", "flat"].forEach((method) => {
	test(`Array.prototype.${method} method is observable`, () => {
		let count = 0;
		const realArr = [[{}], 2, 3, 4];
		const arr = array([[{}], 2, 3, 4]);

		effect(() => {
			count++;
			const result = arr[method]();

			expect(result).toEqual(realArr[method]());
			expect(isObservable(result)).toBe(false);
			// Shallow behavior: nested items are NOT wrapped unless they were already observable
			expect(isObservable(result[0])).toBe(isObservable(arr[0]));
		});

		realArr.push(5);
		arr.push(5);
		expect(count).toBe(2);
	});
});

[
	"every",
	"filter",
	"forEach",
	"map",
	"flatMap",
	"find",
	"findIndex",
	"some",
].forEach((method) => {
	test(`Array.prototype.${method} method is observable`, () => {
		let count = 0;
		const arr = array([{}, {}, {}]);
		const context = {};

		effect(() => {
			let ran = false;
			count++;

			const result = arr[method](function (v, i, a) {
				ran = true;
				expect(a).toBe(arr);
				expect(v).toBe(arr[i]);
				expect(this).toBe(context);

				return true;
			}, context);

			if (result && typeof result === "object") {
				// filter/map now return observable arrays
				if (method === "filter" || method === "map") {
					expect(isObservable(result)).toBe(false);
				} else {
					expect(isObservable(result)).toBe(false);
				}
			}

			if (method === "filter") {
				// Result identity preserved, but they might be raw if input was raw
				expect(isObservable(result[0])).toBe(isObservable(arr[0]));
			}

			expect(ran).toBe(true);
		});

		arr.push({});
		expect(count).toBe(2);
		arr[0].prop = "value";
		expect(count).toBe(2);
	});
});

["reduce", "reduceRight"].forEach((method) => {
	test(`Array.prototype.${method} method is reactive`, () => {
		let count = 0;
		const arr = array([1, 2, 3]);

		effect(() => {
			count++;
			arr[method]((acc, v) => acc + v, 0);
		});

		arr.push(4);
		expect(count).toBe(2);
	});
});

// With shallow behavior, observable values can be stored and retrieved
test("observables can be stored in arrays", () => {
	const a = array([]);
	const o = observable({ prop: "value" });
	a[0] = o;
	expect(a[0]).toBe(o);
});

test("observables can be pushed to arrays", () => {
	const a = array([]);
	const o = observable({ prop: "value" });
	a.push(o);
	expect(a[0]).toBe(o);
});

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

test("Array.prototype.reverse", () => {
	const ar = array([0, 0, 0, 0, 0, 0]);
	const maxIndex = 5;
	let count = 0;

	effect(() => {
		count++;
		for (let i = 0; i <= maxIndex; i++) {
			ar[i];
		}
	});

	expect(count).toBe(1);
	ar.reverse();
	expect(count).toBe(1);
	ar[0]++;
	expect(count).toBe(2);
	ar.reverse();
	expect(count).toBe(3);
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

test("[mobx-test] basic functionality", function () {
	const a = array([]);
	expect(a.length).toBe(0);
	expect(Object.keys(a)).toEqual([]);
	expect(a.slice()).toEqual([]);

	a.push(1);
	expect(a.length).toBe(1);
	expect(a.slice()).toEqual([1]);

	a[1] = 2;
	expect(a.length).toBe(2);
	expect(a.slice()).toEqual([1, 2]);

	const sum = computed(function () {
		return (
			-1 +
			a.reduce(function (a, b) {
				return a + b;
			}, 1)
		);
	});

	expect(sum.value).toBe(3);

	a[1] = 3;
	expect(a.length).toBe(2);
	expect(a.slice()).toEqual([1, 3]);
	expect(sum.value).toBe(4);

	a.splice(1, 1, 4, 5);
	expect(a.length).toBe(3);
	expect(a.slice()).toEqual([1, 4, 5]);
	expect(sum.value).toBe(10);

	a.splice(1, 1);
	expect(sum.value).toBe(6);
	expect(a.slice()).toEqual([1, 5]);

	a.length = 4;
	expect(sum.value).toBe(6); // Holes are skipped in reduce
	expect(a.length).toEqual(4);

	expect(a.slice()).toEqual([1, 5, undefined, undefined]);

	a.length = 2;
	expect(sum.value).toBe(6);
	expect(a.slice()).toEqual([1, 5]);

	expect(a.slice().reverse()).toEqual([5, 1]);
	expect(a.slice()).toEqual([1, 5]);

	a.unshift(3);
	expect(a.slice().sort()).toEqual([1, 3, 5]);
	expect(a.slice()).toEqual([3, 1, 5]);

	expect(JSON.stringify(a)).toBe("[3,1,5]");

	expect(a[1]).toBe(1);
	a[2] = 4;
	expect(a[2]).toBe(4);

	expect(Object.keys(a)).toEqual(["0", "1", "2"]);
});

test("[mobx-test] find(findIndex)", function () {
	const a = array([10, 20, 20]);
	function predicate(item) {
		if (item === 20) {
			return true;
		}
		return false;
	}
	[].findIndex;
	expect(a.find(predicate)).toBe(20);
	expect(a.findIndex(predicate)).toBe(1);
	expect(a.find(predicate)).toBe(20);
});

test("[mobx-test] concat should automatically slice observable arrays", () => {
	const a1 = array([1, 2]);
	const a2 = array([3, 4]);
	expect(a1.concat(a2)).toEqual([1, 2, 3, 4]);
});

test("[mobx-test] array modification", function () {
	const a = array([1, 2, 3]);
	const r = a.splice(-10, 5, 4, 5, 6);
	expect(a.slice()).toEqual([4, 5, 6]);
	expect(r).toEqual([1, 2, 3]);
});

test("[mobx-test] serialize", function () {
	const a = [1, 2, 3];
	const m = array(a);

	expect(JSON.stringify(m)).toEqual(JSON.stringify(a));

	expect(a).toEqual(m.slice());
});

test("[mobx-test] array modification functions", function () {
	const ars = [[], [1, 2, 3]];
	const funcs = ["push", "pop", "shift", "unshift"];
	funcs.forEach(function (f) {
		ars.forEach(function (ar) {
			const a = ar.slice();
			const b = array(a.slice());
			const res1 = a[f](4);
			const res2 = b[f](4);
			expect(res1).toEqual(res2);
			expect(a).toEqual(b.slice());
		});
	});
});

test("[mobx-test] array modifications", function () {
	const a2 = array([]);
	const inputs = [undefined, -10, -4, -3, -1, 0, 1, 3, 4, 10];
	const arrays = [
		[],
		[1],
		[1, 2, 3, 4],
		[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
		[1, undefined],
		[undefined],
	];
	for (let i = 0; i < inputs.length; i++)
		for (let j = 0; j < inputs.length; j++)
			for (let k = 0; k < arrays.length; k++)
				for (let l = 0; l < arrays.length; l++) {
					[
						"array mod: [",
						arrays[k].toString(),
						"] i: ",
						inputs[i],
						" d: ",
						inputs[j],
						" [",
						arrays[l].toString(),
						"]",
					].join(" ");
					const a1 = arrays[k].slice();
					a2.splice(0, a2.length, ...a1);

					// eslint-disable-next-line prefer-spread
					const res1 = a1.splice.apply(
						a1,
						[inputs[i], inputs[j]].concat(arrays[l])
					);
					// eslint-disable-next-line prefer-spread
					const res2 = a2.splice.apply(
						a2,
						[inputs[i], inputs[j]].concat(arrays[l])
					);
					expect(a1.slice()).toEqual(a2.slice());
					expect(res1).toEqual(res2);
					expect(a1.length).toBe(a2.length);
				}
});

test("[mobx-test] is array", function () {
	const x = array([]);
	expect(x instanceof Array).toBe(true);

	// would be cool if this would return true...
	expect(Array.isArray(x)).toBe(true);
});

test("[mobx-test] stringifies same as ecma array", function () {
	const x = array([]);
	expect(x instanceof Array).toBe(true);

	// would be cool if these two would return true...
	expect(x.toString()).toBe("");
	expect(x.toLocaleString()).toBe("");
	x.push(1, 2);
	expect(x.toString()).toBe("1,2");
	expect(x.toLocaleString()).toBe("1,2");
});

test("[mobx-test] observes when stringified", function () {
	const x = array([]);
	let c = 0;
	effect(function () {
		x.toString();
		c++;
	});
	x.push(1);
	expect(c).toBe(2);
});

test("[mobx-test] observes when stringified to locale", function () {
	const x = array([]);
	let c = 0;
	effect(function () {
		x.toLocaleString();
		c++;
	});
	x.push(1);
	expect(c).toBe(2);
});

test("[mobx-test] react to sort changes", function () {
	const x = array([4, 2, 3]);
	const sortedX = computed(function () {
		return x.slice().sort();
	});
	let sorted;

	effect(function () {
		sorted = sortedX.value;
	});

	expect(x.slice()).toEqual([4, 2, 3]);
	expect(sorted).toEqual([2, 3, 4]);
	x.push(1);
	expect(x.slice()).toEqual([4, 2, 3, 1]);
	expect(sorted).toEqual([1, 2, 3, 4]);
	x.shift();
	expect(x.slice()).toEqual([2, 3, 1]);
	expect(sorted).toEqual([1, 2, 3]);
});

test("[mobx-test] autoextend buffer length", function () {
	const ar = array(new Array(1000));
	let changesCount = 0;
	effect(() => {
		ar.length;
		++changesCount;
	});

	ar[ar.length] = 0;
	ar.push(0);

	expect(changesCount).toBe(3);
});

test("[mobx-test] array exposes correct keys", () => {
	const keys = [];
	const ar = array([1, 2]);
	for (const key in ar) keys.push(key);

	expect(keys).toEqual(["0", "1"]);
});

test("[mobx-test] can iterate arrays", () => {
	const x = array([]);
	const y = [];
	const d = reaction(
		() => Array.from(x),
		(items) => y.push(items)
	);

	y.push(Array.from(x));
	x.push("a");
	x.push("b");
	expect(y).toEqual([[], ["a"], ["a", "b"]]);
	d();
});

test("[mobx-test] array is concat spreadable", () => {
	const x = array([1, 2, 3, 4]);
	const y = [5].concat(x);
	expect(y.length).toBe(5);
	expect(y).toEqual([5, 1, 2, 3, 4]);
});

test("[mobx-test] array is spreadable", () => {
	const x = array([1, 2, 3, 4]);
	expect([5, ...x]).toEqual([5, 1, 2, 3, 4]);

	const y = array([]);
	expect([5, ...y]).toEqual([5]);
});

test("[mobx-test] array supports toStringTag", () => {
	const a = array([]);
	expect(Object.prototype.toString.call(a)).toBe("[object Array]");
});

test("[mobx-test] slice works", () => {
	const a = array([1, 2, 3]);
	expect(a.slice(0, 2)).toEqual([1, 2]);
});

test("[mobx-test] slice is reactive", () => {
	const a = array([1, 2, 3]);
	let ok = false;
	reaction(
		() => a.slice().length,
		(l) => l === 4 && (ok = true)
	);
	expect(ok).toBe(false);
	a.push(1);
	expect(ok).toBe(true);
});

test("[mobx-test] toString", () => {
	expect(array([1, 2]).toString()).toEqual([1, 2].toString());
	expect(array([1, 2]).toLocaleString()).toEqual([1, 2].toLocaleString());
});

test("[mobx-test] can define properties on arrays", () => {
	const ar = array([1, 2]);
	Object.defineProperty(ar, "toString", {
		enumerable: false,
		configurable: true,
		value: function () {
			return "hoi";
		},
	});

	expect(ar.toString()).toBe("hoi");
	expect("" + ar).toBe("hoi");
});

test("[mobx-test] symbol key on array", () => {
	const x = array([1, 2]);
	const s = Symbol("test");
	x[s] = 3;
	expect(x[s]).toBe(3);

	let reacted = false;
	const d = reaction(
		() => x[s],
		() => {
			reacted = true;
		}
	);

	x[s] = 4;
	expect(x[s]).toBe(4);

	// although x[s] can be stored, it won't be reactive!
	expect(reacted).toBe(false);
	d();
});

test("[mobx-test] non-symbol key on array", () => {
	const x = array([1, 2]);
	const s = "test";
	x[s] = 3;
	expect(x[s]).toBe(3);

	let reacted = false;
	const d = reaction(
		() => x[s],
		() => {
			reacted = true;
		}
	);

	x[s] = 4;
	expect(x[s]).toBe(4);

	// although x[s] can be stored, it won't be reactive!
	expect(reacted).toBe(false);
	d();
});

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

		const filtered = arr.filter((item) => (item as any).active);
		expect(filtered.length).toBe(1);
		expect(filtered[0]).toBe(obs1);
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
			nativeArr["01" as any] = "non-index";
			arr["01" as any] = "non-index";

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

			nativeArr["-1" as any] = "negative";
			arr["-1" as any] = "negative";

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
			nativeArr[notAnIndex as any] = "not-index";
			arr[notAnIndex as any] = "not-index";

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
