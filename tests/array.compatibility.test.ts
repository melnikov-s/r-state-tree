import { reaction, computed, observable, effect } from "../src";

const array = (obj: any[] = []): any[] => {
	return observable(obj);
};

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
			a.reduce(function (a: any, b: any) {
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
	function predicate(item: any) {
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
			const res1 = (a as any)[f](4);
			const res2 = (b as any)[f](4);
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

					const res1 = (a1.splice as any).apply(
						a1,
						[inputs[i] as any, inputs[j] as any].concat(arrays[l])
					);
					const res2 = (a2.splice as any).apply(
						a2,
						[inputs[i] as any, inputs[j] as any].concat(arrays[l])
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
	(x as any)[s] = 3;
	expect((x as any)[s]).toBe(3);

	let reacted = false;
	const d = reaction(
		() => (x as any)[s],
		() => {
			reacted = true;
		}
	);

	(x as any)[s] = 4;
	expect((x as any)[s]).toBe(4);

	// although x[s] can be stored, it won't be reactive!
	expect(reacted).toBe(false);
	d();
});

test("[mobx-test] non-symbol key on array", () => {
	const x = array([1, 2]);
	const s = "test";
	(x as any)[s] = 3;
	expect((x as any)[s]).toBe(3);

	let reacted = false;
	const d = reaction(
		() => (x as any)[s],
		() => {
			reacted = true;
		}
	);

	(x as any)[s] = 4;
	expect((x as any)[s]).toBe(4);

	// although x[s] can be stored, it won't be reactive!
	expect(reacted).toBe(false);
	d();
});
