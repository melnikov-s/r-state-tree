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

function setup<T extends Store>(Type: new (...args: any[]) => T) {
	const root = mount(createStore(Type));
	const inspector = createInspector();
	const { rootId } = inspector.registerRoot("root", root);
	return {
		root,
		inspect: (path: string[] = []): any =>
			inspector.query({ op: "inspect", rootId, path, depth: 4 }),
		dispose() {
			inspector.dispose();
			root[Symbol.dispose]();
		},
	};
}

function field(value: any, name: string): any {
	return value.fields.find((entry: any) => entry.name === name).value;
}

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
