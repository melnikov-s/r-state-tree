import { effect, observable, isObservable } from "../src";

const map = <K = any, V = any>(obj: Map<K, V> = new Map()): Map<K, V> => {
	return observable(obj) as Map<K, V>;
};

const weakMap = <K extends object = any, V = any>(
	obj: WeakMap<K, V> = new WeakMap()
): WeakMap<K, V> => {
	return observable(obj) as WeakMap<K, V>;
};

const keys = (map: Map<any, any>): any[] => {
	return Array.from(map.keys());
};

test("WeakMap is reactive", () => {
	const m = weakMap();

	const target = {};
	let count = 0;

	effect(() => {
		count++;
		m.has(target);
	});

	m.set(target, 1);
	expect(count).toBe(2);
	expect(m.get(target)).toBe(1);
});

test("WeakMap with function key is reactive", () => {
	const m = weakMap();
	const fnKey = () => {};
	const obsVal = observable({ a: 1 });
	let count = 0;

	effect(() => {
		count++;
		m.get(fnKey);
	});

	m.set(fnKey, obsVal);
	expect(count).toBe(2);
	// Should return the proxy because it was explicitly assigned an observable
	expect(isObservable(m.get(fnKey))).toBe(true);
	expect(m.get(fnKey)).toBe(obsVal);
});

test("instanceof WeakMap", () => {
	const m = weakMap();
	expect(m instanceof WeakMap).toBe(true);
});

test("WeakMap does not report to have Map methods", () => {
	const m = weakMap();
	expect("size" in m).toBe(false);
	expect((m as any).size).toBe(undefined);
	expect("forEach" in m).toBe(false);
	expect((m as any).forEach).toBe(undefined);
});

describe("WeakMap GC behavior (requires --expose-gc)", () => {
	const gc = (globalThis as { gc?: () => void }).gc;
	const describeGC = gc ? describe : describe.skip;

	describeGC("WeakMap does not retain keys via tracking", () => {
		test("key can be garbage collected when no strong refs remain", async () => {
			const wm = weakMap<object, unknown>();
			const obs = observable({ value: 42 });
			let collected = false;
			const registry = new FinalizationRegistry(() => {
				collected = true;
			});

			(() => {
				const key = { id: "ephemeral" };
				registry.register(key, undefined);
				wm.set(key, obs);
			})();

			for (let i = 0; i < 10 && !collected; i++) {
				gc!();
				await new Promise((r) => setTimeout(r, 10));
			}

			expect(collected).toBe(true);
		});
	});
});
