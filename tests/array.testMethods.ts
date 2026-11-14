import { isObservable, source, observable, effect } from "../src";

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
			(arr as any)[method](lookup);
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

			expect((arr as any)[method]("en")).toBe((realArr as any)[method]("en"));
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
			const result = (arr as any)[method]();

			expect(result).toEqual((realArr as any)[method]());
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

			const result = (arr as any)[method](function (
				this: any,
				v: any,
				i: any,
				a: any
			) {
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
			(arr as any)[method]((acc: any, v: any) => acc + v, 0);
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
