import {
	isObservable,
	createReaction,
	createComputed,
	source,
	observable,
	createEffect,
} from "../src";

const array = (obj: any[] = []): any[] => {
	return observable(obj);
};

test("iteration returns observable results", () => {
	const arr = array([{}, {}, {}]);
	const itr = arr[Symbol.iterator]();

	let i = itr.next();
	let count = 0;

	while (!i.done) {
		count++;
		expect(isObservable(i.value)).toBe(true);
		i = itr.next();
	}

	expect(count).toBe(3);
});

test("does not overwrite observable values", () => {
	const o1 = observable({});

	const o = array([o1]);
	o[0] = o1;

	expect(source(o)[0]).toBe(o1);
});

test("sort parameters are observable", () => {
	let count = 0;
	const arr = array([{}, {}]);
	arr.sort((a, b) => {
		count++;
		expect(isObservable(a)).toBe(true);
		expect(isObservable(b)).toBe(true);
		return 0;
	});
	expect(count).toBe(1);
});

["indexOf", "lastIndexOf", "includes"].forEach((method) => {
	test(`Array.prototype.${method} method is observable`, () => {
		let count = 0;
		const negativeValue = method === "includes" ? false : -1;
		const lookup = {};
		const observedLookup = observable(lookup);
		const frozen = {};
		Object.freeze(frozen);
		const arrA = array([{}, lookup, {}, {}, lookup, frozen]);
		const arrB = array([{}, lookup, frozen]);
		const arrC = array([observedLookup]);

		createEffect(() => {
			count++;
			expect(arrA[method](lookup)).not.toBe(negativeValue);
			expect(arrA[method](observedLookup)).not.toBe(negativeValue);
			expect(arrB[method](lookup)).not.toBe(negativeValue);
			expect(arrB[method](observedLookup)).not.toBe(negativeValue);
			expect(arrA[method](frozen)).not.toBe(negativeValue);
			expect(arrB[method](frozen)).not.toBe(negativeValue);
			expect(arrC[method](lookup)).toBe(negativeValue);
			expect(arrC[method](observedLookup)).not.toBe(negativeValue);
		});
		expect(count).toBe(1);
		arrA.push({});
		expect(count).toBe(2);
		arrB.push({});
		expect(count).toBe(3);
	});
});

["join", "toString", "toLocaleString"].forEach((method) => {
	test(`Array.prototype.${method} method is observable`, () => {
		let count = 0;
		const arr = array([1, 2, 3]);
		const realArr = [1, 2, 3];

		createEffect(() => {
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

		createEffect(() => {
			count++;
			const result = arr[method]();

			expect(result).toEqual(realArr[method]());
			expect(isObservable(result)).toBe(true);
			expect(isObservable(result[0])).toBe(true);
			expect(isObservable(source(result)[0])).toBe(false);
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

		createEffect(() => {
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
				expect(isObservable(result)).toBe(
					method === "find" || method === "filter" ? true : false
				);
			}

			if (method === "filter") {
				expect(isObservable(result[0])).toBe(true);
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
	test(`Array.prototype.${method} method is observable`, () => {
		let count = 0;
		const arr = array([{}, {}, {}]);

		createEffect(() => {
			let ran = false;
			count++;

			const res = arr[method](function (acc, v, i, a) {
				ran = true;
				expect(a).toBe(arr);
				expect(v).toBe(arr[i]);
				expect(isObservable(acc)).toBe(false);

				return acc;
			}, {});

			expect(isObservable(res)).toBe(false);

			expect(ran).toBe(true);
		});

		arr.push({});
		expect(count).toBe(2);
		arr[0].prop = "value";
		expect(count).toBe(2);
	});
});

test("observable values do not get stored on the original target", () => {
	const target = [];
	const a = array(target);
	const oTarget = { prop: "value" };
	const o = observable(oTarget);
	a[0] = o;
	expect(a[0]).toBe(o);
	expect(target[0]).not.toBe(o);
	expect(target[0]).toEqual(a[0]);
	expect(target[0]).toBe(oTarget);
});

test("observable values do not get stored on the original target (push)", () => {
	const target = [];
	const a = array(target);
	const oTarget = { prop: "value" };
	const o = observable(oTarget);
	a.push(o);
	expect(a[0]).toBe(o);
	expect(target[0]).not.toBe(o);
	expect(target[0]).toEqual(a[0]);
	expect(target[0]).toBe(oTarget);
});

test("can observe a single index", () => {
	const ar = array([0, 1]);
	let count = 0;

	createEffect(() => {
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

	createEffect(() => {
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

	createEffect(() => {
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

	createEffect(() => {
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

	const sum = createComputed(function () {
		return (
			-1 +
			a.reduce(function (a, b) {
				return a + b;
			}, 1)
		);
	});

	expect(sum.get()).toBe(3);

	a[1] = 3;
	expect(a.length).toBe(2);
	expect(a.slice()).toEqual([1, 3]);
	expect(sum.get()).toBe(4);

	a.splice(1, 1, 4, 5);
	expect(a.length).toBe(3);
	expect(a.slice()).toEqual([1, 4, 5]);
	expect(sum.get()).toBe(10);

	a.splice(1, 1);
	expect(sum.get()).toBe(6);
	expect(a.slice()).toEqual([1, 5]);

	a.length = 4;
	expect(isNaN(sum.get())).toBe(true);
	expect(a.length).toEqual(4);

	expect(a.slice()).toEqual([1, 5, undefined, undefined]);

	a.length = 2;
	expect(sum.get()).toBe(6);
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
	createEffect(function () {
		x.toString();
		c++;
	});
	x.push(1);
	expect(c).toBe(2);
});

test("[mobx-test] observes when stringified to locale", function () {
	const x = array([]);
	let c = 0;
	createEffect(function () {
		x.toLocaleString();
		c++;
	});
	x.push(1);
	expect(c).toBe(2);
});

test("[mobx-test] react to sort changes", function () {
	const x = array([4, 2, 3]);
	const sortedX = createComputed(function () {
		return x.slice().sort();
	});
	let sorted;

	createEffect(function () {
		sorted = sortedX.get();
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
	createEffect(() => {
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
	const d = createReaction(
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
	createReaction(
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
	const d = createReaction(
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
	const d = createReaction(
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
