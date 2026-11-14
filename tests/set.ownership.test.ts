import { isObservable, observable, source } from "../src";

const set = <T>(obj: Set<T> = new Set()) => {
	return observable(obj);
};

const weakSet = <T extends object>(obj: WeakSet<T> = new WeakSet()) => {
	return observable(obj);
};

describe("Detailed Set behavior", () => {
	test("Add proxy ⇒ iter yields proxy", () => {
		const raw = { id: 1 };
		const obs = observable(raw);
		const s = set();
		s.add(obs);

		// Iteration yields proxy
		for (const v of s) {
			expect(v).toBe(obs);
			expect(isObservable(v)).toBe(true);
		}

		expect(Array.from(s.values())[0]).toBe(obs);
		expect(source(s).has(raw)).toBe(true);
	});

	test("Add raw ⇒ iter yields raw", () => {
		const raw = { id: 1 };
		const obs = observable(raw);
		const s = set();
		s.add(source(obs));

		for (const v of s) {
			expect(v).toBe(raw);
			expect(isObservable(v)).toBe(false);
		}
	});

	test("Promotion behavior", () => {
		const raw = { id: 1 };
		const obs = observable(raw);
		const s = set();

		s.add(raw);
		expect(Array.from(s)[0]).toBe(raw);
		expect(isObservable(Array.from(s)[0])).toBe(false);

		// Promote to observable
		s.add(obs);
		expect(s.size).toBe(1);
		expect(Array.from(s)[0]).toBe(obs);
		expect(isObservable(Array.from(s)[0])).toBe(true);
	});

	test("Observable wins - adding raw after observable does not downgrade", () => {
		const raw = { id: 1 };
		const obs = observable(raw);
		const s = set();

		// First add observable
		s.add(obs);
		expect(Array.from(s)[0]).toBe(obs);
		expect(isObservable(Array.from(s)[0])).toBe(true);

		// Adding raw should NOT downgrade - observable wins
		s.add(raw);
		expect(s.size).toBe(1);
		expect(Array.from(s)[0]).toBe(obs); // Still observable, not downgraded
		expect(isObservable(Array.from(s)[0])).toBe(true);
	});

	test("Delete works with proxy+raw", () => {
		const obs = observable({ id: 1 });
		const s = set();

		s.add(obs);
		expect(s.size).toBe(1);
		s.delete(source(obs));
		expect(s.size).toBe(0);

		s.add(obs);
		expect(s.size).toBe(1);
		s.delete(obs);
		expect(s.size).toBe(0);
	});

	test("structuredClone(source(set)) safety", () => {
		const s = set();
		s.add(observable({ id: 1 }));
		s.add({ id: 2 });

		expect(() => structuredClone(source(s))).not.toThrow();
	});

	test("Initialization does not sanitize user-provided proxies", () => {
		const obs = observable({ id: 1 });
		const backing = new Set<any>([obs]);
		const s = observable(backing);

		expect(source(s)).toBe(backing);
		expect(source(s).has(obs)).toBe(true);
		expect(isObservable(Array.from(source(s).values())[0])).toBe(true);

		// Observable lookups must work with both proxy and raw values.
		expect(s.has(obs)).toBe(true);
		expect(s.has(source(obs))).toBe(true);

		// If a user explicitly seeds proxies into the source, structuredClone may throw.
		expect(() => structuredClone(source(s))).toThrow();
	});

	test("WeakSet basic functional behavior", () => {
		const ws = weakSet();
		const obj = {};
		ws.add(obj);
		expect(ws.has(obj)).toBe(true);

		const obs = observable({ id: 1 });
		ws.add(obs);
		expect(ws.has(obs)).toBe(true);
		expect(ws.has(source(obs))).toBe(true);
	});

	test("WeakSet source purity (value stored unwrapped)", () => {
		const ws = weakSet<object>();
		const raw = { id: 1 };
		const obs = observable(raw);

		ws.add(obs);

		expect(ws.has(obs)).toBe(true);
		expect(ws.has(source(obs))).toBe(true);

		expect(source(ws).has(raw)).toBe(true);
		expect(source(ws).has(obs)).toBe(false);
	});

	test("WeakSet membership checks work with proxy and source", () => {
		const ws = weakSet<object>();
		const raw = { id: 1 };
		const obs = observable(raw);

		ws.add(obs);

		expect(ws.has(obs)).toBe(true);
		expect(ws.has(source(obs))).toBe(true);
		expect(source(ws).has(source(obs))).toBe(true);
		expect(source(ws).has(obs)).toBe(false);
	});

	test("WeakSet delete works with proxy and source", () => {
		const ws = weakSet<object>();
		const raw = { id: 1 };
		const obs = observable(raw);

		ws.add(obs);
		expect(ws.has(obs)).toBe(true);

		ws.delete(source(obs));
		expect(ws.has(obs)).toBe(false);
		expect(ws.has(source(obs))).toBe(false);

		ws.add(obs);
		expect(ws.has(obs)).toBe(true);
		ws.delete(obs);
		expect(ws.has(obs)).toBe(false);
	});
});

describe("Ownership Propagation", () => {
	it("union() returns Set with observed elements", () => {
		const raw = { id: 1 };
		const obs = observable(raw);
		const s1 = observable(new Set());
		s1.add(obs);

		const s2 = observable(new Set());
		// @ts-ignore
		const union = s1.union(s2);

		const items = Array.from(union);
		expect(items[0]).toBe(obs);
		expect(isObservable(union)).toBe(false);
		expect(union.has(obs)).toBe(true);
	});

	it("intersection() returns Set with observed elements", () => {
		const obs = observable({ id: 1 });
		const s1 = observable(new Set([obs]));
		const s2 = observable(new Set([obs]));

		// @ts-ignore
		const intersection = s1.intersection(s2);
		expect(Array.from(intersection)[0]).toBe(obs);
	});

	it("difference() returns Set with observed elements", () => {
		const obs1 = observable({ id: 1 });
		const obs2 = observable({ id: 2 });
		const s1 = observable(new Set([obs1, obs2]));
		const s2 = observable(new Set([obs2]));

		// @ts-ignore
		const difference = s1.difference(s2);
		expect(difference.size).toBe(1);
		expect(Array.from(difference)[0]).toBe(obs1);
	});

	it("symmetricDifference() returns Set with observed elements", () => {
		const obs1 = observable({ id: 1 });
		const obs2 = observable({ id: 2 });
		const s1 = observable(new Set([obs1]));
		const s2 = observable(new Set([obs2]));

		// @ts-ignore
		const symDiff = s1.symmetricDifference(s2);
		expect(symDiff.size).toBe(2);
		const items = Array.from(symDiff);
		expect(items).toContain(obs1);
		expect(items).toContain(obs2);
	});
});
