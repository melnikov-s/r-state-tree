import {
	Store,
	child,
	createStore,
	mount,
	Model,
	reaction,
	effect,
	observable,
	signal,
} from "../src/index";

test("can mount a store", () => {
	class S extends Store<any> {}

	const store = mount(createStore(S, { myProp: 1 }));

	expect(store instanceof Store).toBe(true);
	expect(store.props.myProp).toBe(1);
});

describe("Store lifetime signal", () => {
	test("is active while mounted and aborts exactly once on root disposal", () => {
		class S extends Store {}
		const store = mount(createStore(S));
		let aborts = 0;
		store.signal.addEventListener("abort", () => aborts++);

		expect(store.signal.aborted).toBe(false);
		store[Symbol.dispose]();
		expect(store.signal.aborted).toBe(true);
		expect(aborts).toBe(1);

		expect(() => store[Symbol.dispose]()).not.toThrow();
		expect(aborts).toBe(1);
	});

	test("aborts a materialized child when its parent is disposed", () => {
		class ChildStore extends Store {}
		class ParentStore extends Store {
			@child get child() {
				return createStore(ChildStore);
			}
		}

		const parent = mount(createStore(ParentStore));
		const childStore = parent.child;
		expect(childStore.signal.aborted).toBe(false);

		parent[Symbol.dispose]();
		expect(childStore.signal.aborted).toBe(true);
	});

	test("aborts a child removed by reconciliation", () => {
		class ChildStore extends Store {}
		class ParentStore extends Store {
			state = observable({ visible: true });

			@child get child() {
				return this.state.visible ? createStore(ChildStore) : null;
			}
		}

		const parent = mount(createStore(ParentStore));
		const removed = parent.child!;
		parent.state.visible = false;

		expect(parent.child).toBe(null);
		expect(removed.signal.aborted).toBe(true);
	});

	test("aborts a replaced keyed child without aborting its replacement", () => {
		class FirstChild extends Store<any> {}
		class SecondChild extends Store<any> {}
		class ParentStore extends Store {
			state = observable({ replacement: false });

			@child get children() {
				const Type = this.state.replacement ? SecondChild : FirstChild;
				return [createStore(Type, { key: "item" })];
			}
		}

		const parent = mount(createStore(ParentStore));
		const original = parent.children[0];
		parent.state.replacement = true;
		const replacement = parent.children[0];

		expect(replacement).toBeInstanceOf(SecondChild);
		expect(original.signal.aborted).toBe(true);
		expect(replacement.signal.aborted).toBe(false);
	});

	test("aborts before effect cleanup runs", () => {
		let abortedDuringCleanup = false;
		class S extends Store {
			constructor(props: S["props"]) {
				super(props);
				this.effect(() => () => {
					abortedDuringCleanup = this.signal.aborted;
				});
			}
		}

		const store = mount(createStore(S));
		store[Symbol.dispose]();
		expect(abortedDuringCleanup).toBe(true);
	});

	test("returns a stable, already-aborted signal when first accessed in cleanup", () => {
		let firstRead: AbortSignal | undefined;
		class S extends Store {
			constructor(props: S["props"]) {
				super(props);
				this.effect(() => () => {
					firstRead = this.signal;
					expect(firstRead.aborted).toBe(true);
				});
			}
		}

		const store = mount(createStore(S));
		const other = mount(createStore(S));
		store[Symbol.dispose]();
		expect(store.signal).toBe(firstRead);
		other[Symbol.dispose]();
		expect(other.signal).not.toBe(store.signal);
	});

	test("aborts during rollback when mounting fails", () => {
		let failedStore!: Store;
		class FailingStore extends Store {
			constructor(props: FailingStore["props"]) {
				super(props);
				failedStore = this;
				this.effect(() => {
					throw new Error("mount failed");
				});
			}
		}

		expect(() => mount(createStore(FailingStore))).toThrow("mount failed");
		expect(failedStore.signal.aborted).toBe(true);
	});

	test("can guard an asynchronous completion after disposal", async () => {
		let resolve!: (value: string) => void;
		const result = new Promise<string>((done) => {
			resolve = done;
		});

		class S extends Store {
			value = "initial";

			async load() {
				const value = await result;
				if (this.signal.aborted) return;
				this.value = value;
			}
		}

		const store = mount(createStore(S));
		const loading = store.load();
		store[Symbol.dispose]();
		resolve("loaded");
		await loading;

		expect(store.value).toBe("initial");
	});
});

test("owned effects start on mount and are cleaned up on disposal", () => {
	let acquired = 0;
	let cleaned = 0;

	class AppStore extends Store {
		constructor(props: any) {
			super(props);
			this.effect(() => {
				acquired++;
				return () => cleaned++;
			});
			expect(acquired).toBe(0);
		}
	}

	const store = mount(createStore(AppStore));
	expect(acquired).toBe(1);

	store[Symbol.dispose]();
	store[Symbol.dispose]();

	expect(cleaned).toBe(1);
	expect(() => mount(store)).toThrow();
});

test("a disposer can cancel a reactive registration before mount", () => {
	let runs = 0;

	class AppStore extends Store {
		constructor(props: any) {
			super(props);
			const dispose = this.effect(() => void runs++);
			dispose();
		}
	}

	mount(createStore(AppStore));
	expect(runs).toBe(0);
});

test("store tree effects activate bottom-up after the whole tree is mounted", () => {
	type Observation = {
		store: "grandchild" | "child" | "root";
	};
	const observations: Observation[] = [];
	let rootStore!: RootStore;
	let childStore!: ChildStore;
	let grandchildStore!: GrandchildStore;

	const observeMount = (store: Observation["store"]) => {
		expect(rootStore.child).toBe(childStore);
		expect(childStore.grandchild).toBe(grandchildStore);
		observations.push({ store });
	};

	class GrandchildStore extends Store {
		constructor(props: any) {
			super(props);
			grandchildStore = this;
			this.effect(() => observeMount("grandchild"));
		}
	}

	class ChildStore extends Store {
		@child get grandchild() {
			return createStore(GrandchildStore);
		}

		constructor(props: any) {
			super(props);
			childStore = this;
			this.effect(() => observeMount("child"));
			void this.grandchild;
		}
	}

	class RootStore extends Store {
		@child get child() {
			return createStore(ChildStore);
		}

		constructor(props: any) {
			super(props);
			rootStore = this;
			this.effect(() => observeMount("root"));
			void this.child;
		}
	}

	mount(createStore(RootStore));

	expect(observations).toEqual([
		{ store: "grandchild" },
		{ store: "child" },
		{ store: "root" },
	]);
});

test("dynamically mounted child registrations do not activate reentrantly", () => {
	const events: string[] = [];

	class SecondStore extends Store {
		constructor(props: any) {
			super(props);
			this.effect(() => void events.push("second effect"));
		}
	}

	class FirstStore extends Store<{ parent: ParentStore }> {
		constructor(props: FirstStore["props"]) {
			super(props);
			this.effect(() => {
				events.push("first effect start");
				void this.props.parent.second;
				events.push("first effect end");
			});
		}
	}

	class ParentStore extends Store {
		@child get first() {
			return createStore(FirstStore, { parent: this });
		}

		@child get second() {
			return createStore(SecondStore);
		}

		constructor(props: any) {
			super(props);
			this.effect(() => {
				events.push("parent effect start");
				void this.first;
				events.push("parent effect end");
			});
		}
	}

	mount(createStore(ParentStore));

	expect(events).toEqual([
		"parent effect start",
		"parent effect end",
		"first effect start",
		"first effect end",
		"second effect",
	]);
});

test("store effects start when the root store mounts", () => {
	let count = 0;

	class S extends Store<any> {
		constructor(props: any) {
			super(props);
			this.effect(() => void count++);
		}
	}

	mount(createStore(S));
	expect(count).toBe(1);
});

test("mount-scoped effect mutations are batched", () => {
	class S extends Store<any> {
		state = observable({ count: 0 });
		get count() {
			return this.state.count;
		}
		set count(v) {
			this.state.count = v;
		}
		constructor(props: any) {
			super(props);
			this.effect(() => void (this.state.count = 1));
		}
	}

	let s;
	expect(() => (s = mount(createStore(S)))).not.toThrow();
	expect(s!.count).toBe(1);
});

test("store effect cleanup runs on root store disposal", () => {
	let count = 0;

	class S extends Store<any> {
		constructor(props: any) {
			super(props);
			this.effect(() => () => void count++);
		}
	}

	const s = mount(createStore(S));
	expect(count).toBe(0);
	s[Symbol.dispose]();
	expect(count).toBe(1);
});

test("store effect cleanup may mutate state", () => {
	class S extends Store<any> {
		state = observable({ count: 0 });
		get count() {
			return this.state.count;
		}
		set count(v) {
			this.state.count = v;
		}
		constructor(props: any) {
			super(props);
			this.effect(() => () => void this.state.count++);
		}
	}

	const s = mount(createStore(S));
	expect(s.count).toBe(0);
	s[Symbol.dispose]();
	expect(s.count).toBe(1);
});

test("can't initianialize store directly", () => {
	class S extends Store<any> {}

	expect(() => new S({})).toThrow();
});

test("can setup a reaction in a store", () => {
	let trackRuns = 0;
	class S extends Store<any> {
		state = observable({ prop: 0, count: 0 });
		get prop() {
			return this.state.prop;
		}
		set prop(v) {
			this.state.prop = v;
		}
		get count() {
			return this.state.count;
		}
		set count(v) {
			this.state.count = v;
		}
		unsub!: any;

		constructor(props: any) {
			super(props);
			this.unsub = this.reaction(
				() => {
					trackRuns++;
					return this.prop;
				},
				() => this.count++
			);
			expect(trackRuns).toBe(0);
		}
		inc() {
			this.prop++;
		}
	}

	const s = mount(createStore(S));
	expect(trackRuns).toBe(1);
	expect(s.count).toBe(0);
	s.inc();
	expect(s.count).toBe(1);
	s.inc();
	expect(s.count).toBe(2);
	s.unsub();
	s.inc();
	expect(s.count).toBe(2);
});

test("reaction in a store will auto unsub after store is unmounted ", () => {
	class C extends Store<any> {
		constructor(props: any) {
			super(props);
			this.reaction(
				() => this.props.prop,
				() => this.props.countUp()
			);
		}
	}

	class S extends Store<any> {
		// Refactoring multiple observables
		state = observable({ mounted: true, prop: 0, count: 0 });
		get mounted() {
			return this.state.mounted;
		}
		set mounted(v) {
			this.state.mounted = v;
		}
		get prop() {
			return this.state.prop;
		}
		set prop(v) {
			this.state.prop = v;
		}
		get count() {
			return this.state.count;
		}
		set count(v) {
			this.state.count = v;
		}

		@child get c() {
			return this.mounted
				? createStore(C, {
						inc: this.inc.bind(this),
						prop: this.prop,
						countUp: () => this.count++,
					})
				: null;
		}

		inc() {
			this.prop++;
		}

		unMountChild() {
			this.mounted = false;
		}
	}

	const s = mount(createStore(S));
	expect(s.count).toBe(0);
	expect(s.c).toBeTruthy(); // mounts the store
	s.inc();
	expect(s.count).toBe(1);
	s.inc();
	expect(s.count).toBe(2);
	s.unMountChild();
	expect(s.c).toBe(null);
	s.inc();
	expect(s.count).toBe(2);
});

describe("recursive mount diagnostics", () => {
	class SharedModel extends Model {}

	class RecursiveStore extends Store<{ shared: SharedModel }> {
		constructor(props: any) {
			super(props);
			this.effect(() => {
				this.loop;
			});
		}

		@child get loop() {
			return createStore(RecursiveStore, { shared: this.props.shared });
		}
	}

	const mountRecursiveStore = () =>
		mount(
			createStore(RecursiveStore, {
				shared: SharedModel.create(),
			})
		);

	test("recursive mount surfaces circular creation error instead of stack overflow", () => {
		expect(mountRecursiveStore).toThrowError(
			/detected circular store creation/
		);
	});

	test("circular mount error reports guidance to break recursion", () => {
		try {
			mountRecursiveStore();
		} catch (error) {
			if (error instanceof Error) {
				expect(error.message).toContain("detected circular store creation");
				expect(error.message).toContain("RecursiveStore");
				expect(error.message).toContain("Break the ownership cycle");
				return;
			}
			throw error;
		}
		throw new Error("expected recursive mount to throw");
	});
});
