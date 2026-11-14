import { observable, source, isObservable } from "../src";

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

const values = (map: Map<any, any>): any[] => {
	return keys(map).map((key) => map.get(key));
};

describe("Parent Ownership (Strict Shallow)", () => {
	test("same source in two maps should have independent observability", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		// Map A gets the observable as value
		const mapA = map<string, any>();
		mapA.set("key", obs);

		// Map B gets the raw source as value
		const mapB = map<string, any>();
		mapB.set("key", source(obs));

		// Map A should return the observable proxy
		expect(isObservable(mapA.get("key"))).toBe(true);
		expect(mapA.get("key")).toBe(obs);

		// Map B should return the raw object (NOT the observable)
		expect(isObservable(mapB.get("key"))).toBe(false);
		expect(mapB.get("key")).toBe(raw);
	});

	test("observable assignment is tracked per-key", () => {
		const raw1 = { value: 1 };
		const raw2 = { value: 2 };
		const obs1 = observable(raw1);

		const m = map<string, any>();
		m.set("a", obs1); // Observable at key "a"
		m.set("b", raw2); // Raw at key "b"

		expect(isObservable(m.get("a"))).toBe(true);
		expect(isObservable(m.get("b"))).toBe(false);
	});

	test("source in map allows structuredClone", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		const m = map<string, any>();
		m.set("key", source(obs)); // Set the raw source

		// Should NOT throw - it's a plain object
		expect(() => structuredClone(m.get("key"))).not.toThrow();
	});

	test("source map contains raw values not proxies", () => {
		const raw = { value: 1 };
		const obs = observable(raw);

		const m = map<string, any>();
		m.set("key", obs);

		// The source map should contain the raw value
		const sourceMap = source(m);
		expect(isObservable(sourceMap.get("key"))).toBe(false);
	});
});

describe("Detailed Map behavior", () => {
	describe("Basic ownership + purity", () => {
		test("Value stores raw in source", () => {
			const m = map<string, any>();
			const raw = { id: 1 };
			const obs = observable(raw);
			m.set("k", obs);

			expect(m.get("k")).toBe(obs);
			expect(source(m).get("k")).toBe(raw);
			expect(isObservable(source(m).get("k"))).toBe(false);
		});

		test("Per-map independence", () => {
			const raw = { id: 1 };
			const obs = observable(raw);
			const mA = map();
			const mB = map();

			mA.set("k", obs);
			mB.set("k", source(obs));

			expect(isObservable(mA.get("k"))).toBe(true);
			expect(isObservable(mB.get("k"))).toBe(false);
		});

		test("Same raw under two keys", () => {
			const raw = { id: 1 };
			const obs = observable(raw);
			const m = map();

			m.set("a", obs);
			m.set("b", source(obs));

			expect(isObservable(m.get("a"))).toBe(true);
			expect(isObservable(m.get("b"))).toBe(false);
		});

		test("Reassignment clears", () => {
			const obs = observable({ id: 1 });
			const m = map();
			m.set("k", obs);

			expect(isObservable(m.get("k"))).toBe(true);
			m.set("k", source(obs));
			expect(isObservable(m.get("k"))).toBe(false);
		});

		test("delete clears tracking", () => {
			const obs = observable({ id: 1 });
			const m = map();
			m.set("k", obs);

			expect(isObservable(m.get("k"))).toBe(true);
			m.delete("k");
			m.set("k", source(obs));
			expect(isObservable(m.get("k"))).toBe(false);
		});

		test("clear clears all tracking", () => {
			const obs = observable({ id: 1 });
			const m = map();
			m.set("a", obs);
			m.clear();
			m.set("a", source(obs));
			expect(isObservable(m.get("a"))).toBe(false);
		});
	});

	describe("Iteration must match get", () => {
		test("for..of m / m.entries()", () => {
			const obs1 = observable({ id: 1 });
			const raw2 = { id: 2 };
			const m = map(
				new Map([
					["a", obs1],
					["b", raw2],
				])
			);

			for (const [k, v] of m) {
				expect(v).toBe(m.get(k));
				expect(isObservable(v)).toBe(k === "a");
			}

			for (const [k, v] of m.entries()) {
				expect(v).toBe(m.get(k));
			}
		});

		test("m.values()", () => {
			const obs1 = observable({ id: 1 });
			const m = map(new Map([["a", obs1]]));
			const vals = Array.from(m.values());
			expect(vals[0]).toBe(obs1);
		});

		test("m.forEach", () => {
			const obs1 = observable({ id: 1 });
			const m = map(new Map([["a", obs1]]));
			m.forEach((v, k) => {
				expect(v).toBe(m.get(k));
				expect(isObservable(v)).toBe(true);
			});
		});
	});

	describe("Observable keys", () => {
		test("Observable object key stored as raw key", () => {
			const rawKey = { id: "key" };
			const keyObs = observable(rawKey);
			const m = map();
			m.set(keyObs, 1);

			expect(source(m).has(rawKey)).toBe(true);
			expect(source(m).has(keyObs)).toBe(false);
			expect(m.get(keyObs)).toBe(1);
			expect(m.get(rawKey)).toBe(1);
		});

		test("Normalization on initialization", () => {
			const rawKey = { id: "key" };
			const keyObs = observable(rawKey);
			const rawVal = { id: "val" };
			const valObs = observable(rawVal);

			const m = map(new Map([[keyObs, valObs]]));
			// Must not sanitize / rewrite user-provided proxy keys/values.
			expect(source(m).has(keyObs)).toBe(true);
			expect(source(m).has(rawKey)).toBe(false);
			expect(source(m).get(keyObs)).toBe(valObs);

			// But observable lookups must work with both raw and proxy keys.
			expect(m.get(keyObs)).toBe(valObs);
			expect(m.get(rawKey)).toBe(valObs);

			// If a user explicitly seeds proxies into the source, structuredClone may throw.
			expect(() => structuredClone(source(m))).toThrow();
		});
	});

	test("Symbol key behavior", () => {
		const m = map<PropertyKey, unknown>();
		const sym = Symbol("k");
		const raw = { id: 1 };
		const obs = observable(raw);

		m.set(sym, obs);

		expect(m.get(sym)).toBe(obs);
		expect(isObservable(m.get(sym))).toBe(true);
		expect(source(m).get(sym)).toBe(raw);
		expect(isObservable(source(m).get(sym))).toBe(false);

		m.delete(sym);
		m.set(sym, raw);
		expect(m.get(sym)).toBe(raw);
		expect(isObservable(m.get(sym))).toBe(false);
	});

	describe("undefined values correctness", () => {
		test("Presence vs absence", () => {
			const m = map();
			m.set("k", undefined);
			expect(m.has("k")).toBe(true);
			expect(m.get("k")).toBe(undefined);
			expect(m.has("missing")).toBe(false);

			const obs = observable({ id: 1 });
			m.set("k", obs);
			expect(isObservable(m.get("k"))).toBe(true);
			m.set("k", undefined);
			// After setting to undefined, it should no longer be tracked as observable
			expect(isObservable(m.get("k"))).toBe(false);
		});
	});

	test("WeakMap basic functional behavior", () => {
		const wm = weakMap();
		const key = {};
		const obs = observable({ id: 1 });
		wm.set(key, obs);

		expect(wm.get(key)).toBe(obs);
		expect(isObservable(wm.get(key))).toBe(true);
	});

	test("WeakMap source purity (value stored unwrapped)", () => {
		const wm = weakMap<object, unknown>();
		const key = {};
		const raw = { id: 1 };
		const obs = observable(raw);

		wm.set(key, obs);

		expect(wm.get(key)).toBe(obs);
		expect(isObservable(wm.get(key))).toBe(true);

		expect(source(wm).get(key)).toBe(raw);
		expect(isObservable(source(wm).get(key))).toBe(false);
	});

	test("WeakMap ownership tracks per-key correctly", () => {
		const wm = weakMap<object, unknown>();
		const key1 = { id: "key1" };
		const key2 = { id: "key2" };
		const raw = { value: 42 };
		const obs = observable(raw);

		wm.set(key1, obs);
		wm.set(key2, source(obs));

		expect(wm.get(key1)).toBe(obs);
		expect(isObservable(wm.get(key1))).toBe(true);

		expect(wm.get(key2)).toBe(raw);
		expect(isObservable(wm.get(key2))).toBe(false);

		expect(source(wm).get(key1)).toBe(raw);
		expect(source(wm).get(key2)).toBe(raw);

		expect(() => structuredClone(source(wm).get(key1))).not.toThrow();
	});

	test("WeakMap delete clears ownership tracking", () => {
		const wm = weakMap<object, unknown>();
		const key = { id: "key" };
		const raw = { value: 42 };
		const obs = observable(raw);

		wm.set(key, obs);
		expect(isObservable(wm.get(key))).toBe(true);

		wm.delete(key);
		wm.set(key, source(obs));
		expect(isObservable(wm.get(key))).toBe(false);
	});

	test("WeakMap reassignment changes ownership", () => {
		const wm = weakMap<object, unknown>();
		const key = { id: "key" };
		const raw = { value: 42 };
		const obs = observable(raw);

		wm.set(key, obs);
		expect(isObservable(wm.get(key))).toBe(true);

		wm.set(key, source(obs));
		expect(isObservable(wm.get(key))).toBe(false);

		wm.set(key, obs);
		expect(isObservable(wm.get(key))).toBe(true);
	});
});
