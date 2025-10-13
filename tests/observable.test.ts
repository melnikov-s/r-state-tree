import {
	observable,
	createEffect,
	source,
	reportObserved,
	reportChanged,
} from "../src";

test("reportObserved returns observable", () => {
	const o = observable({});
	expect(reportObserved(o)).toBe(o);
});

test("reportObserved on object", () => {
	const o = observable({ value: 1, newV: { value: 1 } });
	let count = 0;
	createEffect(() => {
		reportObserved(o);
		count++;
	});

	o.newV;

	o.value = o.value;
	expect(count).toBe(1);
	o.value++;
	expect(count).toBe(2);
});

test("reportObserved on array", () => {
	const o = observable([1, 2, 3]);
	let count = 0;
	createEffect(() => {
		reportObserved(o);
		count++;
	});

	o[0] = o[0];
	expect(count).toBe(1);
	o.push(4);
	expect(count).toBe(2);
	o.reverse();
	expect(count).toBe(3);
	o.fill(0, 1, 3);
	expect(count).toBe(4);
});

test("reportObserved on map", () => {
	const o = observable(new Map([[1, 1]]));
	let count = 0;
	createEffect(() => {
		reportObserved(o);
		count++;
	});

	o.set(1, 1);
	expect(count).toBe(1);
	o.set(2, 1);
	expect(count).toBe(2);
});

test("reportObserved on set", () => {
	const o = observable(new Set([1, 2, 3]));
	let count = 0;
	createEffect(() => {
		reportObserved(o);
		count++;
	});

	o.add(1);
	expect(count).toBe(1);
	o.add(4);
	expect(count).toBe(2);
	o.delete(2);
	expect(count).toBe(3);
});

test("reportObserved on object (deep)", () => {
	const ob = observable({ value: 1 });
	const o = observable({
		value: {
			innerValue: 1,
			get double() {
				return ob.value * 2;
			},
			undef: undefined,
		},
	});
	let count = 0;
	createEffect(() => {
		reportObserved(o, { deep: true });
		count++;
	});

	o.value.innerValue = o.value.innerValue;
	expect(count).toBe(1);
	o.value.innerValue++;
	expect(count).toBe(2);
	ob.value = 2;
	expect(count).toBe(2);
	const value = o.value;
	delete o.value;
	expect(count).toBe(3);
	value.innerValue++;
	expect(count).toBe(3);
});

test("reportObserved on object (not deep)", () => {
	const o = observable({
		value: {
			innerValue: 1,
		},
	});
	let count = 0;
	createEffect(() => {
		reportObserved(o);
		count++;
	});

	o.value.innerValue++;
	expect(count).toBe(1);
	o.value = { innerValue: 2 };
	expect(count).toBe(2);
});

test("reportObserved on object (deep + circular ref)", () => {
	const ref = { value: 1, ref: null };
	const o = observable({
		value: {
			ref,
			innerValue: 1,
		},
	});
	observable(ref).ref = o.value;

	let count = 0;
	createEffect(() => {
		reportObserved(o, { deep: true });
		count++;
	});

	o.value.innerValue = o.value.innerValue;
	expect(count).toBe(1);
	o.value.innerValue++;
	expect(count).toBe(2);
});

test("reportObserved on map (deep)", () => {
	const refA = observable({ value: 1 });
	const refB = observable({ value: 1 });
	const o = observable(
		new Map([
			[1, source(refA)],
			[2, source(refB)],
		])
	);
	let count = 0;
	createEffect(() => {
		reportObserved(o, { deep: true });
		count++;
	});

	refA.value++;
	expect(count).toBe(2);
	refB.value++;
	expect(count).toBe(3);
	o.delete(2);
	expect(count).toBe(4);
	refB.value++;
	expect(count).toBe(4);
});

test("reportObserved on set (deep)", () => {
	const refA = observable({ value: 1 });
	const refB = observable({ value: 1 });
	const o = observable(new Set([refA, refB].map(source)));
	let count = 0;
	createEffect(() => {
		reportObserved(o, { deep: true });
		count++;
	});

	refA.value++;
	expect(count).toBe(2);
	refB.value++;
	expect(count).toBe(3);
	o.delete(refA);
	expect(count).toBe(4);
	refA.value++;
	expect(count).toBe(4);
});

test("reportObserved on array (deep)", () => {
	const refA = observable({ value: 1 });
	const refB = observable({ value: 1 });
	const o = observable([refA, refB].map(source));
	let count = 0;
	createEffect(() => {
		reportObserved(o, { deep: true });
		count++;
	});

	refA.value++;
	expect(count).toBe(2);
	refB.value++;
	expect(count).toBe(3);
	o.pop();
	expect(count).toBe(4);
	refB.value++;
	expect(count).toBe(4);
});

test("reportChanged on object", () => {
	const o = observable({ value: 1 });
	let count = 0;
	createEffect(() => {
		o.value;
		count++;
	});

	reportChanged(o);
	expect(count).toBe(2);
});

test("reportChanged on array", () => {
	const o = observable([1, 2, 3]);
	let count = 0;
	createEffect(() => {
		o.length;
		count++;
	});

	reportChanged(o);
	expect(count).toBe(2);
});

test("reportChanged on map", () => {
	const o = observable(new Map());
	let count = 0;
	createEffect(() => {
		o.has(1);
		count++;
	});

	reportChanged(o);
	expect(count).toBe(2);
});

test("reportChanged on set", () => {
	const o = observable(new Set());
	let count = 0;
	createEffect(() => {
		o.has(1);
		count++;
	});

	reportChanged(o);
	expect(count).toBe(2);
});
