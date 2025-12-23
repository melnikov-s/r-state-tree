import {
	observable,
	effect,
	source,
	reportObserved,
	reportChanged,
	isObservable,
} from "../src";
import { vi } from "vitest";

test("reportObserved returns observable", () => {
	const o = observable({});
	expect(reportObserved(o)).toBe(o);
});

// reportObserved on plain object - shallow behavior means nested values are not tracked
test("reportObserved on object (shallow)", () => {
	const o = observable({ value: 1 });
	let count = 0;
	effect(() => {
		reportObserved(o);
		count++;
	});

	o.value = o.value;
	expect(count).toBe(1);
	o.value++;
	expect(count).toBe(2);
});

test("reportObserved on array", () => {
	const o = observable([1, 2, 3]);
	let count = 0;
	effect(() => {
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
	effect(() => {
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
	effect(() => {
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

// REMOVED: Deep reportObserved tests - no longer supported with shallow-only behavior
// Tests removed:
// - reportObserved on object (deep)
// - reportObserved on object (not deep)
// - reportObserved on object (deep + circular ref)
// - reportObserved on map (deep)
// - reportObserved on set (deep)
// - reportObserved on array (deep)

test("reportChanged on object", () => {
	const o = observable({ value: 1 });
	let count = 0;
	effect(() => {
		o.value;
		count++;
	});

	reportChanged(o);
	expect(count).toBe(2);
});

test("reportChanged on array", () => {
	const o = observable([1, 2, 3]);
	let count = 0;
	effect(() => {
		o.length;
		count++;
	});

	reportChanged(o);
	expect(count).toBe(2);
});

test("reportChanged on map", () => {
	const o = observable(new Map());
	let count = 0;
	effect(() => {
		o.has(1);
		count++;
	});

	reportChanged(o);
	expect(count).toBe(2);
});

test("reportChanged on set", () => {
	const o = observable(new Set());
	let count = 0;
	effect(() => {
		o.has(1);
		count++;
	});

	reportChanged(o);
	expect(count).toBe(2);
});

describe("Functions are not observable containers", () => {
	test("observable(fn) returns fn unchanged and emits a dev-only warning", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fn = () => 42;

		const result = observable(fn);

		expect(result).toBe(fn); // Function returned unchanged
		expect(isObservable(result)).toBe(false); // Functions are never observable
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("functions are not observable containers")
		);

		warnSpy.mockRestore();
	});

	test("isObservable returns false for functions", () => {
		const fn = () => {};
		expect(isObservable(fn)).toBe(false);
		expect(isObservable(observable(fn))).toBe(false);
	});
});

describe("Cross-cutting invariants", () => {
	test("Stable identity", () => {
		const raw = { value: 1 };
		const p1 = observable(raw);
		const p2 = observable(raw);
		expect(p1).toBe(p2); // observable(raw) twice returns the same proxy

		const p3 = observable(p1);
		expect(p3).toBe(p1); // observable(observable(raw)) returns the same proxy

		expect(source(p1)).toBe(raw); // source(observable(raw)) === raw
	});

	test("Assignment round‑trip identity", () => {
		const obj = observable({ a: null as any, b: null as any });
		const raw = { value: 1 };
		const obs = observable(raw);

		// Assign a proxy
		obj.a = obs;
		expect(obj.a).toBe(obs); // reading back returns the exact same proxy instance

		// Assign a raw value
		obj.b = raw;
		expect(obj.b).toBe(raw); // reading back returns the exact same raw instance
		expect(isObservable(obj.b)).toBe(false);
	});

	test("Source purity (no proxies stored)", () => {
		const obj = observable({ child: null as any });
		const arr = observable([] as any[]);
		const map = observable(new Map());
		const set = observable(new Set());

		const item = observable({ id: 1 });

		obj.child = item;
		arr.push(item);
		map.set("key", item);
		set.add(item);

		// Assert isObservable(...) === false for values inside source(container)
		expect(isObservable(source(obj).child)).toBe(false);
		expect(isObservable(source(arr)[0])).toBe(false);
		expect(isObservable(source(map).get("key"))).toBe(false);
		// Sets might be special depending on implementation but generally:
		expect(isObservable(Array.from(source(set).values())[0])).toBe(false);

		// Keys for maps/sets
		const keyItem = observable({ key: 1 });
		map.set(keyItem, "value");
		set.add(keyItem);

		expect(
			isObservable(Array.from(source(map).keys()).find((k) => k.key === 1))
		).toBe(false);
		expect(
			isObservable(Array.from(source(set).values()).find((v) => v.key === 1))
		).toBe(false);
	});

	test("Per‑container ownership", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		const containerA = observable({ item: null as any });
		const containerB = observable({ item: null as any });

		containerA.item = obs;
		containerB.item = raw;

		expect(isObservable(containerA.item)).toBe(true);
		expect(containerA.item).toBe(obs);

		expect(isObservable(containerB.item)).toBe(false);
		expect(containerB.item).toBe(raw);
	});

	test("Reactivity Leakage / Crosstalk: assigning proxy to one container doesn't affect raw in another", () => {
		const raw = { id: 1 };

		const store1 = observable({ item: null as any });
		const store2 = observable({ item: null as any });

		// 1. Assign observable wrapper to store1
		store1.item = observable(raw);

		// 2. Assign RAW object to store2
		store2.item = raw;

		expect(isObservable(store1.item)).toBe(true);
		expect(source(store1.item)).toBe(raw);

		expect(isObservable(store2.item)).toBe(false);
		expect(store2.item).toBe(raw);
	});

	test("structuredClone safety", () => {
		const obj = observable({ a: 1 });
		const arr = observable([1, 2]);
		const map = observable(new Map([["k", "v"]]));
		const set = observable(new Set([1, 2]));

		// Mutations
		obj.a = 2;
		arr.push(3);
		map.set("k2", "v2");
		set.add(3);

		expect(() => structuredClone(source(obj))).not.toThrow();
		expect(() => structuredClone(source(arr))).not.toThrow();
		expect(() => structuredClone(source(map))).not.toThrow();
		expect(() => structuredClone(source(set))).not.toThrow();
	});

	describe("Date observability", () => {
		test("date methods return values", () => {
			const now = new Date().getMonth();
			const d = observable(new Date());

			expect(d.getMonth()).toBe(now);
		});

		test("date methods are reactive", () => {
			const d = observable(new Date());

			let count = 0;

			effect(() => {
				d.getDate();
				count++;
			});

			d.setFullYear(d.getFullYear() + 1);
			expect(count).toBe(2);
		});

		test("date toString returns epoch", () => {
			const now = Date.now();
			const rd = new Date(now);

			const d = observable(new Date(now));

			expect(d.valueOf()).toEqual(rd.valueOf());
			expect(+d).toEqual(+rd);
		});

		test("date mutations invalidate reportObserved observers", () => {
			const d = observable(new Date(0));
			let count = 0;

			effect(() => {
				reportObserved(d);
				count++;
			});

			expect(count).toBe(1);
			d.setTime(1000);
			expect(count).toBe(2);
		});
	});
});

describe("Frozen internal-slot types", () => {
	test("frozen Map is still observable and reactive", () => {
		const m = Object.freeze(new Map([["a", 1]]));
		const obs = observable(m);

		expect(isObservable(obs)).toBe(true);

		let count = 0;
		effect(() => {
			obs.get("a");
			count++;
		});

		expect(count).toBe(1);
		obs.set("a", 2);
		expect(count).toBe(2);
	});

	test("frozen Set is still observable and reactive", () => {
		const s = Object.freeze(new Set([1, 2, 3]));
		const obs = observable(s);

		expect(isObservable(obs)).toBe(true);

		let count = 0;
		effect(() => {
			obs.size; // Observe size which changes on add
			count++;
		});

		expect(count).toBe(1);
		obs.add(4);
		expect(count).toBe(2);
	});

	test("frozen Date is still observable and reactive", () => {
		const d = Object.freeze(new Date(0));
		const obs = observable(d);

		expect(isObservable(obs)).toBe(true);

		let count = 0;
		effect(() => {
			obs.getTime();
			count++;
		});

		expect(count).toBe(1);
		obs.setTime(1000);
		expect(count).toBe(2);
	});
});
