import { computed as preactComputed } from "@preact/signals-core";
import { batch, computed, effect, observable, signal, untracked } from "../src";
import { getAdministration } from "../src/observables/internal/lookup";
import {
	AtomMap,
	MAX_INACTIVE_NODES,
	SignalMap,
} from "../src/observables/internal/NodeMap";
import { createCachedSignal } from "../src/observables/internal/CachedNode";

function churn(nodes: { reportObserved(key: number): void }) {
	for (let key = 0; key <= MAX_INACTIVE_NODES; key++) {
		nodes.reportObserved(key);
	}
}

describe("bounded per-key caches", () => {
	test.each([false, true])(
		"100,000 Map misses stay bounded (container observed: %s)",
		(observed) => {
			const map = observable(new Map<number, number>());
			const dispose = observed ? effect(() => void map.size) : () => {};
			try {
				for (let key = 0; key < 100_000; key++) map.has(key);
				const adm = getAdministration(map);
				expect([...adm.hasMap.keys()]).toHaveLength(MAX_INACTIVE_NODES);
				expect(map.size).toBe(0);
			} finally {
				dispose();
			}
		}
	);

	test("Map get misses and Set has misses stay bounded", () => {
		const map = observable(new Map<number, number>());
		const set = observable(new Set<number>());
		for (let key = 0; key < 100_000; key++) {
			map.get(key);
			set.has(key);
		}
		expect([...getAdministration(map).hasMap.keys()]).toHaveLength(
			MAX_INACTIVE_NODES
		);
		expect([...getAdministration(set).hasMap.keys()]).toHaveLength(
			MAX_INACTIVE_NODES
		);
	});

	test("Map read/delete churn bounds both presence and value caches", () => {
		const map = observable(new Map<number, number>());
		for (let key = 0; key < 10_000; key++) {
			map.set(key, key);
			map.get(key);
			map.delete(key);
		}
		const adm = getAdministration(map);
		expect([...adm.hasMap.keys()]).toHaveLength(MAX_INACTIVE_NODES);
		expect([...adm.valuesMap.keys()]).toHaveLength(MAX_INACTIVE_NODES);
		expect(map.size).toBe(0);
	});

	test("inactive entries use LRU rather than creation order", () => {
		const nodes = new AtomMap<number>();
		for (let key = 0; key < MAX_INACTIVE_NODES; key++) {
			nodes.reportObserved(key);
		}
		const hot = nodes.get(0);
		nodes.reportObserved(0);
		nodes.reportObserved(MAX_INACTIVE_NODES);
		expect(nodes.get(0)).toBe(hot);
		expect(nodes.get(1)).toBeUndefined();
	});

	test("active nodes are pinned even beyond the inactive limit", () => {
		const nodes = new SignalMap<number, number>();
		let runs = 0;
		const dispose = effect(() => {
			runs++;
			for (let key = 0; key <= MAX_INACTIVE_NODES; key++) {
				nodes.reportObserved(key, key);
			}
		});
		try {
			for (let key = 1_000; key < 2_000; key++) {
				nodes.reportObserved(key, key);
			}
			expect([...nodes.keys()]).toHaveLength(2 * MAX_INACTIVE_NODES + 1);
			expect(runs).toBe(1);
			nodes.reportChanged(0, -1);
			expect(runs).toBe(2);
		} finally {
			dispose();
		}
		expect([...nodes.keys()]).toHaveLength(MAX_INACTIVE_NODES);
	});

	test("dropping old dependencies during a long-lived effect releases nodes", () => {
		const map = observable(new Map<number, number>());
		const key = signal(0);
		const dispose = effect(() => void map.has(key.value));
		try {
			for (let index = 1; index < 10_000; index++) key.value = index;
			expect([...getAdministration(map).hasMap.keys()]).toEqual([9_999]);
		} finally {
			dispose();
		}
		expect([...getAdministration(map).hasMap.keys()]).toHaveLength(0);
	});

	test("untracked reads do not pin entries", () => {
		const nodes = new AtomMap<number>();
		const dispose = effect(() => untracked(() => churn(nodes)));
		try {
			expect([...nodes.keys()]).toHaveLength(MAX_INACTIVE_NODES);
		} finally {
			dispose();
		}
	});

	test("object keys retain weak-key identity independently of primitive churn", () => {
		const nodes = new AtomMap<object | number>();
		const key = {};
		const node = nodes.getOrCreate(key);
		for (let index = 0; index < 1_000; index++) nodes.reportObserved(index);
		expect(nodes.getOrCreate(key)).toBe(node);
		expect([...nodes.keys()]).toHaveLength(MAX_INACTIVE_NODES);
	});
});

describe("computed dependencies across eviction", () => {
	test("unobserved Map presence and missing-value computeds refresh after eviction", () => {
		const map = observable(new Map<number, number>());
		let runs = 0;
		const has = computed(() => {
			runs++;
			return map.has(-1);
		});
		const get = computed(() => map.get(-1));
		expect(has.value).toBe(false);
		expect(has.value).toBe(false);
		expect(runs).toBe(1);
		expect(get.value).toBeUndefined();
		for (let key = 0; key <= MAX_INACTIVE_NODES; key++) map.has(key);
		map.set(-1, 42);
		expect(has.value).toBe(true);
		expect(get.value).toBe(42);
		map.delete(-1);
		expect(has.value).toBe(false);
		expect(get.value).toBeUndefined();
	});

	test("unobserved value computed refreshes when only its value node was evicted", () => {
		const map = observable(new Map<number, number>([[-1, 1]]));
		const value = computed(() => map.get(-1));
		expect(value.value).toBe(1);
		for (let key = 0; key <= MAX_INACTIVE_NODES; key++) {
			map.set(key, key);
			map.get(key);
			// Keep the presence dependency hot, evict only its value dependency.
			map.has(-1);
		}
		const adm = getAdministration(map);
		expect(adm.hasMap.get(-1)).toBeDefined();
		expect(adm.valuesMap.get(-1)).toBeUndefined();
		map.set(-1, 2);
		expect(value.value).toBe(2);
		map.clear();
		expect(value.value).toBeUndefined();
	});

	test("unobserved Set presence refreshes after eviction and deletion", () => {
		const set = observable(new Set<number>([-1]));
		const has = computed(() => set.has(-1));
		expect(has.value).toBe(true);
		for (let key = 0; key <= MAX_INACTIVE_NODES; key++) set.has(key);
		set.delete(-1);
		expect(has.value).toBe(false);
		set.add(-1);
		expect(has.value).toBe(true);
	});

	test("computeds with more dependencies than the limit can become observed", () => {
		const map = observable(new Map<number, number>());
		const count = MAX_INACTIVE_NODES + 10;
		const sum = computed(() => {
			let total = 0;
			for (let key = 0; key < count; key++) total += map.get(key) ?? 0;
			return total;
		});
		expect(sum.value).toBe(0);
		const seen: number[] = [];
		const dispose = effect(() => {
			seen.push(sum.value);
		});
		try {
			map.set(0, 1);
			map.set(count - 1, 2);
			expect(seen).toEqual([0, 1, 3]);
		} finally {
			dispose();
		}
		map.set(0, 4);
		expect(sum.value).toBe(6);
	});

	test("hot unobserved computeds remain cached", () => {
		const map = observable(new Map<number, number>([[-1, 1]]));
		let runs = 0;
		const value = computed(() => {
			runs++;
			return map.get(-1);
		});
		expect(value.value).toBe(1);
		for (let key = 0; key < MAX_INACTIVE_NODES - 1; key++) map.has(key);
		expect(value.value).toBe(1);
		expect(value.value).toBe(1);
		expect(runs).toBe(1);
	});

	test("active subscriptions keep per-key notification precision", () => {
		const map = observable(new Map<number, number>([[-1, 1]]));
		let runs = 0;
		const dispose = effect(() => {
			map.get(-1);
			runs++;
		});
		try {
			for (let key = 0; key <= MAX_INACTIVE_NODES; key++) {
				map.set(key, key);
				map.get(key);
			}
			expect(runs).toBe(1);
			map.set(-1, 2);
			expect(runs).toBe(2);
		} finally {
			dispose();
		}
	});

	test("a separate lazy computed survives another reader's unsubscribe", () => {
		const map = observable(new Map([["key", 1]]));
		const lazy = computed(() => map.get("key"));
		expect(lazy.value).toBe(1);
		const dispose = effect(() => void map.get("key"));
		dispose();
		map.set("key", 2);
		expect(lazy.value).toBe(2);
	});

	test("raw Preact computeds and exposed node signals track eviction revisions", () => {
		const nodes = new SignalMap<number, number>();
		const value = preactComputed(() => nodes.getOrCreate(-1, 1).node!.value);
		expect(value.value).toBe(1);
		churn(nodes);
		expect(nodes.get(-1)).toBeUndefined();
		nodes.getOrCreate(-1, 2);
		expect(value.value).toBe(2);
	});

	test("value signals preserve net-zero batch notification suppression", () => {
		const map = observable(new Map([["key", 1]]));
		let runs = 0;
		const dispose = effect(() => {
			map.get("key");
			runs++;
		});
		try {
			batch(() => {
				map.set("key", 2);
				map.set("key", 1);
			});
			expect(runs).toBe(1);
		} finally {
			dispose();
		}
	});

	test("exposed signal subscriptions pin entries and preserve value APIs", () => {
		const nodes = new SignalMap<number, number>();
		const node = nodes.getOrCreate(-1, 1).node!;
		const seen: unknown[] = [];
		const dispose = node.subscribe((value) => seen.push(value));
		try {
			churn(nodes);
			expect(nodes.get(-1)?.node).toBe(node);
			nodes.reportChanged(-1, 2);
			nodes.reportChanged(-1, 2);
			expect(node.peek()).toBe(2);
			expect(node.toJSON()).toBe(2);
			expect(node.toString()).toBe("2");
			expect(seen).toEqual([1, 2]);
		} finally {
			dispose();
		}
		expect(nodes.get(-1)).toBeUndefined();
	});

	test("eviction invalidation does not fabricate a signal value", () => {
		const entry = createCachedSignal(42);
		let runs = 0;
		const value = preactComputed(() => {
			runs++;
			return entry.node!.value;
		});
		expect(value.value).toBe(42);
		entry.invalidate();
		expect(entry.node!.peek()).toBe(42);
		expect(value.value).toBe(42);
		expect(runs).toBe(2);
		entry.node!.value = 43;
		expect(value.value).toBe(43);
	});
});
