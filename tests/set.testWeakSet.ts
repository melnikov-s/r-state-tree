import { effect, observable, source } from "../src";

const weakSet = <T extends object>(obj: WeakSet<T> = new WeakSet()) => {
	return observable(obj);
};

test("WeakSet is reactive", () => {
	const s = weakSet();

	const target = {};
	let count = 0;

	effect(() => {
		count++;
		s.has(target);
	});

	s.add(target);
	expect(count).toBe(2);
	expect(s.has(target)).toBe(true);
});

test("WeakSet with function value is reactive", () => {
	const s = weakSet();
	const obsFn = observable(() => {});
	let count = 0;

	effect(() => {
		count++;
		s.has(obsFn);
	});

	s.add(obsFn);
	expect(count).toBe(2);
	expect(s.has(obsFn)).toBe(true);
	expect(s.has(source(obsFn))).toBe(true);
});

test("WeakSet does not report to have Set methods", () => {
	const s = weakSet();
	expect("size" in s).toBe(false);
	expect((s as any).size).toBe(undefined);
	expect("forEach" in s).toBe(false);
	expect((s as any).forEach).toBe(undefined);
});

test("instanceof WeakSet", () => {
	const s = weakSet();
	expect(s instanceof WeakSet).toBe(true);
});

describe("WeakSet GC behavior (requires --expose-gc)", () => {
	const gc = (globalThis as { gc?: () => void }).gc;
	const describeGC = gc ? describe : describe.skip;

	describeGC("WeakSet does not retain values via tracking", () => {
		test("value can be garbage collected when no strong refs remain", async () => {
			const ws = weakSet<object>();
			let collected = false;
			const registry = new FinalizationRegistry(() => {
				collected = true;
			});

			(() => {
				const obj = { id: "ephemeral" };
				registry.register(obj, undefined);
				ws.add(obj);
			})();

			for (let i = 0; i < 10 && !collected; i++) {
				gc!();
				await new Promise((r) => setTimeout(r, 10));
			}

			expect(collected).toBe(true);
		});
	});
});
