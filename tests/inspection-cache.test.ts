import {
	Store,
	child,
	computed,
	createContext,
	createStore,
	toSnapshot,
	mount,
	snapshot,
} from "../src/index";
import { createInspector } from "../devtools/src/devtools";
import { getStoreAdm } from "../src/store/StoreAdministration";
import type { ReadonlySignal } from "@preact/signals-core";
import { computed as nativeComputed, Signal } from "@preact/signals-core";
import { effect, signal } from "../src/observables";
import { withRetainedChildren } from "../src/observables/internal/retainedRead";

function setup<T extends Store>(Type: new (...args: any[]) => T) {
	const root = mount(createStore(Type));
	const inspector = createInspector();
	const { rootId } = inspector.registerRoot("root", root);
	return {
		root,
		inspect: (path: string[] = []): any =>
			inspector.query({
				op: "inspect",
				rootId,
				path,
				depth: 4,
				evaluateComputeds: true,
			}),
		dispose() {
			inspector.dispose();
			root[Symbol.dispose]();
		},
	};
}

function field(value: any, name: string): any {
	return value.fields.find((entry: any) => entry.name === name).value;
}

function nativeComputedFixture() {
	let factories = 0;
	let runs = 0;
	class Leaf extends Store {
		value = 42;
	}
	class Root extends Store {
		static types = { lazy: child, current: computed };
		get lazy() {
			factories++;
			return createStore(Leaf);
		}
		get current() {
			return wrapped.value;
		}
	}
	const root = mount(createStore(Root));
	const native = nativeComputed(() => {
		runs++;
		return root.lazy.value;
	});
	const wrapped = computed(() => native.value);
	const inspector = createInspector();
	const { rootId } = inspector.registerRoot("root", root);
	return {
		root,
		native,
		inspect: (options: { path?: string[]; evaluateComputeds?: boolean } = {}) =>
			inspector.query({ op: "inspect", rootId, ...options }),
		counts: () => ({ factories, runs }),
		dispose() {
			inspector.dispose();
			root[Symbol.dispose]();
		},
	};
}

test.each([{}, { evaluateComputeds: false }])(
	"structure-only inspection preserves normal reads through a native computed (%j)",
	(options) => {
		const f = nativeComputedFixture();
		try {
			const result = f.inspect(options);
			const duringInspection = f.counts();
			// On the old default, native Signals caches the retained-child error.
			expect(f.root.current).toBe(42);
			expect(f.native.value).toBe(42);
			expect(duringInspection).toEqual({ factories: 0, runs: 0 });
			expect(field(result, "lazy")).toMatchObject({ kind: "uninitialized" });
			expect(field(result, "current")).toMatchObject({ kind: "deferred" });
			expect(f.counts()).toEqual({ factories: 1, runs: 1 });
		} finally {
			f.dispose();
		}
	}
);

test("selecting a computed path does not implicitly opt into evaluation", () => {
	const f = nativeComputedFixture();
	try {
		expect(() => f.inspect({ path: ["current"] })).toThrow(
			"Computed selection not evaluated"
		);
		expect(f.counts()).toEqual({ factories: 0, runs: 0 });
		expect(f.root.current).toBe(42);
	} finally {
		f.dispose();
	}
});

test("opt-in inspection through a native computed does not initialize a lazy child", () => {
	const f = nativeComputedFixture();
	try {
		const result = f.inspect({ evaluateComputeds: true });
		expect(field(result, "current")).toMatchObject({ kind: "error" });
		expect(f.counts()).toEqual({ factories: 0, runs: 1 });
	} finally {
		f.dispose();
	}
});

const signalReaders: [string, (memo: ReadonlySignal<number>) => number][] = [
	["value", (memo) => memo.value],
	["peek", (memo) => memo.peek()],
	["valueOf", (memo) => memo.valueOf()],
	["toString", (memo) => Number(memo.toString())],
	["toJSON", (memo) => memo.toJSON()],
	["numeric coercion", (memo) => Number(memo)],
	["string coercion", (memo) => Number(String(memo))],
	["JSON serialization", (memo) => Number(JSON.stringify(memo))],
];

describe.each(signalReaders)("public computed %s", (_name, read) => {
	test.each([
		[false, false],
		[false, true],
		[true, false],
		[true, true],
	])(
		"cold inspection does not poison ordinary reads (Context: %s, initialize first: %s)",
		(viaContext, initializeFirst) => {
			const Context = createContext<number>();
			let factories = 0;
			let memo: ReadonlySignal<number>;
			class Leaf extends Store {
				value = 42;
			}
			class Root extends Store {
				static types = { lazy: child, current: computed };
				get lazy() {
					factories++;
					return createStore(Leaf);
				}
				[Context.provide]() {
					return this.lazy.value;
				}
				get current() {
					return read(memo);
				}
			}
			const f = setup(Root);
			memo = computed(() =>
				viaContext ? Context.consume(f.root)! : f.root.lazy.value
			);
			try {
				expect(field(f.inspect(), "current")).toMatchObject({ kind: "error" });
				expect(
					getStoreAdm(f.root).peekInspectionChild("lazy").initialized
				).toBe(false);
				expect(factories).toBe(0);
				if (initializeFirst) expect(f.root.lazy.value).toBe(42);
				expect(f.root.current).toBe(42);
				expect(memo.value).toBe(42);
				expect(f.root.lazy.value).toBe(42);
				expect(Context.consume(f.root)).toBe(42);
				expect(factories).toBe(1);
				f.root.lazy.value = 43;
				expect(memo.value).toBe(43);
				expect(read(memo)).toBe(43);
				// peek intentionally does not track the enclosing declared computed.
				expect(f.root.current).toBe(_name === "peek" ? 42 : 43);
			} finally {
				f.dispose();
			}
		}
	);

	test.each([false, true])(
		"warm inspection bypasses the application cache without reconciling children (Context: %s)",
		(viaContext) => {
			const Context = createContext<number>();
			let factories = 0,
				computations = 0;
			let memo: ReadonlySignal<number>;
			class Leaf extends Store {
				value = 42;
			}
			class Root extends Store {
				static types = { lazy: child, current: computed };
				get lazy() {
					factories++;
					return createStore(Leaf);
				}
				[Context.provide]() {
					return this.lazy.value;
				}
				get current() {
					return read(memo);
				}
			}
			const f = setup(Root);
			memo = computed(() => {
				computations++;
				return viaContext ? Context.consume(f.root)! : f.root.lazy.value;
			});
			const seen: number[] = [];
			const stop = memo.subscribe((value) => {
				seen.push(value);
			});
			try {
				expect(memo.value).toBe(42);
				const before = computations;
				expect(field(f.inspect(), "current")).toBe(42);
				expect(computations).toBe(before + 1);
				expect(factories).toBe(1);
				expect(memo.value).toBe(42);
				expect(computations).toBe(before + 1);
				expect(seen).toEqual([42]);
				f.root.lazy.value = 43;
				expect(seen).toEqual([42, 43]);
				expect(memo.peek()).toBe(43);
				expect(read(memo)).toBe(43);
			} finally {
				stop();
				f.dispose();
			}
		}
	);
});

test("public computed preserves native signal identity, cached object identity, read-only API and peek tracking", () => {
	const input = signal(1);
	let runs = 0;
	const memo: ReadonlySignal<{ value: number }> = computed(() => {
		runs++;
		return { value: input.value };
	});
	expect(memo).toBeInstanceOf(Signal);
	expect(memo.brand).toBe(input.brand);
	const cached = memo.value;
	expect(memo.peek()).toBe(cached);
	expect(memo.valueOf()).toBe(cached);
	expect(memo.toJSON()).toBe(cached);
	expect(runs).toBe(1);
	const inspected = withRetainedChildren(() => memo.value);
	expect(inspected).toEqual(cached);
	expect(inspected).not.toBe(cached);
	expect(memo.value).toBe(cached);
	expect(runs).toBe(2);
	expect(Reflect.set(memo, "value", { value: 99 })).toBe(false);
	const tracked: number[] = [],
		peeked: number[] = [];
	const stopTracked = effect(() => {
		tracked.push(memo.value.value);
	});
	const stopPeeked = effect(() => {
		peeked.push(memo.peek().value);
	});
	try {
		input.value = 2;
		expect(tracked).toEqual([1, 2]);
		expect(peeked).toEqual([1]);
		expect(memo.value).not.toBe(cached);
		expect(memo.value.value).toBe(2);
	} finally {
		stopTracked();
		stopPeeked();
	}
});

test.each([false, true])(
	"dirty prewarmed public computed cannot initialize a newly selected lazy child during inspection (Context: %s)",
	(viaContext) => {
		const Context = createContext<number>();
		let factories = 0;
		let memo: ReadonlySignal<number>;
		class Leaf extends Store {
			value = 42;
		}
		class Root extends Store {
			static types = { lazy: child, current: computed };
			useLazy = false;
			get lazy() {
				factories++;
				return createStore(Leaf);
			}
			[Context.provide]() {
				return this.lazy.value;
			}
			get current() {
				return memo.value;
			}
		}
		const f = setup(Root);
		memo = computed(() =>
			f.root.useLazy
				? viaContext
					? Context.consume(f.root)!
					: f.root.lazy.value
				: 0
		);
		try {
			expect(memo.value).toBe(0);
			f.root.useLazy = true;
			expect(field(f.inspect(), "current")).toMatchObject({ kind: "error" });
			expect(factories).toBe(0);
			expect(getStoreAdm(f.root).peekInspectionChild("lazy").initialized).toBe(
				false
			);
			expect(f.root.current).toBe(42);
			expect(memo.value).toBe(42);
			f.root.lazy.value = 43;
			expect(memo.value).toBe(43);
			expect(f.root.current).toBe(43);
		} finally {
			f.dispose();
		}
	}
);

test("restricted public computed cycles restore the read guard and do not poison normal caches", () => {
	let cycle = true;
	const memo: ReadonlySignal<number> = computed(() =>
		cycle ? memo.value : 42
	);
	expect(() => withRetainedChildren(() => memo.value)).toThrow(
		"Cycle detected"
	);
	cycle = false;
	expect(withRetainedChildren(() => memo.peek())).toBe(42);
	expect(memo.value).toBe(42);
});

test.each([false, true])(
	"restricted Context failure does not poison ordinary consume or explicit initialization (initialize first: %s)",
	(initializeFirst) => {
		const Context = createContext<number>();
		let factories = 0,
			mounts = 0,
			stops = 0;
		class Leaf extends Store {
			value = 42;
			constructor(props: any) {
				super(props);
				this.effect(() => {
					mounts++;
					return () => {
						stops++;
					};
				});
			}
		}
		class Root extends Store {
			static types = { lazy: child, current: computed };
			get lazy() {
				factories++;
				return createStore(Leaf);
			}
			[Context.provide]() {
				return this.lazy.value;
			}
			get current() {
				return Context.consume(this);
			}
		}
		const f = setup(Root);
		try {
			const result = f.inspect();
			expect(field(result, "current")).toMatchObject({ kind: "error" });
			expect(field(result, "lazy")).toMatchObject({ kind: "uninitialized" });
			expect(getStoreAdm(f.root).peekInspectionChild("lazy").initialized).toBe(
				false
			);
			expect(factories).toBe(0);
			expect(mounts).toBe(0);
			const inspectionCacheSize = (getStoreAdm(f.root) as any).contextCache
				.size;
			if (initializeFirst) expect(f.root.lazy.value).toBe(42);
			expect(Context.consume(f.root)).toBe(42);
			expect(f.root.current).toBe(42);
			expect(f.root.lazy.value).toBe(42);
			expect(factories).toBe(1);
			expect(mounts).toBe(1);
			expect(inspectionCacheSize).toBe(0);
			expect(field(f.inspect(), "current")).toBe(42);
			f.root.lazy.value = 43;
			expect(f.root.current).toBe(43);
		} finally {
			f.dispose();
		}
		expect(stops).toBe(1);
	}
);

test.each([false, true])(
	"successful inherited Context inspection bypasses cold and prewarmed caches without replacing application identity (warm: %s)",
	(warm) => {
		const Context = createContext<{ value: number }>();
		let providers = 0,
			factories = 0;
		class Consumer extends Store {
			static types = { current: computed };
			get current() {
				return Context.consume(this)!;
			}
		}
		class Leaf extends Store {
			value = 42;
		}
		class Root extends Store {
			static types = { lazy: child, consumer: child };
			get lazy() {
				factories++;
				return createStore(Leaf);
			}
			get consumer() {
				return createStore(Consumer);
			}
			[Context.provide]() {
				providers++;
				return { value: this.lazy.value };
			}
		}
		const f = setup(Root);
		try {
			const leaf = f.root.lazy;
			const consumer = f.root.consumer;
			const cached = warm ? Context.consume(consumer) : undefined;
			const before = providers;
			expect(field(field(f.inspect(["consumer"]), "current"), "value")).toBe(
				42
			);
			expect(providers).toBe(before + 1);
			expect(factories).toBe(1);
			const current = Context.consume(consumer);
			if (warm) expect(current).toBe(cached);
			else expect(providers).toBe(before + 2);
			expect(consumer.current).toBe(current);
			const seen: number[] = [];
			consumer.effect(() => {
				seen.push(consumer.current.value);
			});
			leaf.value = 43;
			expect(seen).toEqual([42, 43]);
			expect(consumer.current).not.toBe(current);
			expect(consumer.current.value).toBe(43);
			expect(getStoreAdm(consumer).parent).toBe(getStoreAdm(f.root));
			expect(f.root.lazy).toBe(leaf);
		} finally {
			f.dispose();
		}
	}
);

test("Context defaults and missing providers remain safe in restricted and ordinary reads", () => {
	const Default = createContext(7);
	const Missing = createContext<number>();
	class Root extends Store {
		static types = { fallback: computed, missing: computed };
		get fallback() {
			return Default.consume(this);
		}
		get missing() {
			return Missing.consume(this);
		}
	}
	const f = setup(Root);
	try {
		const result = f.inspect();
		expect(field(result, "fallback")).toBe(7);
		expect(field(result, "missing")).toEqual({
			kind: "unsupported",
			detail: "undefined",
		});
		expect(f.root.fallback).toBe(7);
		expect(f.root.missing).toBeUndefined();
	} finally {
		f.dispose();
	}
});

test.each([false, true])(
	"snapshot caches reached by declared getters isolate restricted reads (warm: %s)",
	(warm) => {
		let reads = 0;
		class Leaf extends Store {
			value = 42;
		}
		class Root extends Store {
			static types = { lazy: child, saved: snapshot, current: computed };
			get lazy() {
				return createStore(Leaf);
			}
			get saved() {
				reads++;
				return this.lazy.value;
			}
			get current() {
				return toSnapshot(this);
			}
		}
		const f = setup(Root);
		try {
			if (warm) expect(f.root.lazy.value).toBe(42);
			const cached = warm ? toSnapshot(f.root) : undefined;
			const before = reads;
			const result = field(f.inspect(), "current");
			expect(reads).toBe(before + 1);
			if (!warm) {
				expect(result).toMatchObject({ kind: "error" });
				expect(
					getStoreAdm(f.root).peekInspectionChild("lazy").initialized
				).toBe(false);
			} else {
				expect(field(field(result, "state"), "saved")).toBe(42);
				expect(toSnapshot(f.root)).toBe(cached);
			}
			expect(toSnapshot(f.root)).toEqual({ state: { saved: 42 } });
			expect(f.root.current).toEqual({ state: { saved: 42 } });
			f.root.lazy.value = 43;
			expect(toSnapshot(f.root)).toEqual({ state: { saved: 43 } });
		} finally {
			f.dispose();
		}
	}
);
