import {
	applySnapshot,
	Store,
	child,
	createStore,
	mount,
	onSnapshot,
	signal,
	snapshot as snapshotField,
	toSnapshot,
} from "../src/index";

describe("Store snapshots", () => {
	test("omits stores without persisted data, including keyed children", () => {
		class Empty extends Store {
			temporary = 1;
		}
		class Root extends Store {
			@child get empty() {
				return createStore(Empty, { key: "empty" });
			}
			@child get list() {
				return [createStore(Empty), createStore(Empty, { key: "keyed" })];
			}
			@child get absent() {
				return null;
			}
			@child get emptyList() {
				return [];
			}
		}
		const root = mount(createStore(Root));
		expect(toSnapshot(root)).toBeUndefined();
		void root.empty;
		void root.list;
		void root.absent;
		void root.emptyList;
		expect(toSnapshot(root)).toBeUndefined();
		expect(applySnapshot(root, toSnapshot(root))).toBe(root);
		root[Symbol.dispose]();
	});

	test("keeps persisted descendants through stateless parents and observes changes", () => {
		class Leaf extends Store {
			@snapshotField value = 1;
		}
		class Branch extends Store {
			@child get leaf() {
				return createStore(Leaf);
			}
		}
		class Root extends Store {
			@child get branch() {
				return createStore(Branch);
			}
		}
		const root = mount(createStore(Root));
		void root.branch.leaf;
		expect(toSnapshot(root)).toEqual({
			children: { branch: { children: { leaf: { state: { value: 1 } } } } },
		});
		const snapshots: unknown[] = [];
		const stop = onSnapshot(root, (snapshot) => snapshots.push(snapshot));
		root.branch.leaf.value = 2;
		expect(snapshots).toEqual([
			{ children: { branch: { children: { leaf: { state: { value: 2 } } } } } },
		]);
		stop();
		root[Symbol.dispose]();
	});

	test("omits empty keyed array entries and round-trips the remaining children", () => {
		class Empty extends Store {}
		class Saved extends Store {
			@snapshotField value = 0;
		}
		class Root extends Store {
			@child get list() {
				return [
					createStore(Empty, { key: "empty" }),
					createStore(Saved, { key: "saved" }),
				];
			}
		}
		const root = mount(createStore(Root));
		(root.list[1] as Saved).value = 7;
		const snapshot = toSnapshot(root);
		expect(snapshot).toEqual({
			children: { list: [{ key: "saved", state: { value: 7 } }] },
		});
		const restored = mount(createStore(Root), { snapshot });
		expect((restored.list[1] as Saved).value).toBe(7);
		expect(toSnapshot(restored)).toEqual(snapshot);
		root[Symbol.dispose]();
		restored[Symbol.dispose]();
	});

	test("uses explicit null entries for empty unkeyed children", () => {
		class Empty extends Store {}
		class Saved extends Store {
			@snapshotField value = 0;
		}
		class Root extends Store {
			@child get list() {
				return [createStore(Empty), createStore(Saved), createStore(Empty)];
			}
		}
		const root = mount(createStore(Root));
		(root.list[1] as Saved).value = 7;
		const snapshot = JSON.parse(JSON.stringify(toSnapshot(root)));
		expect(snapshot).toEqual({
			children: { list: [null, { state: { value: 7 } }, null] },
		});
		const restored = mount(createStore(Root), { snapshot });
		expect(toSnapshot(restored)).toEqual(snapshot);
		expect((restored.list[1] as Saved).value).toBe(7);
		expect(toSnapshot(restored)).toEqual(snapshot);
		(root.list[1] as Saved).value = 9;
		applySnapshot(root, snapshot);
		expect((root.list[1] as Saved).value).toBe(7);
		root[Symbol.dispose]();
		restored[Symbol.dispose]();
	});

	test("round-trips mixed keyed and unkeyed children with explicit null entries", () => {
		class Empty extends Store {}
		class Saved extends Store {
			@snapshotField value = 0;
		}
		class Root extends Store {
			@child get list() {
				return [
					createStore(Empty, { key: "empty" }),
					createStore(Empty),
					createStore(Saved, { key: "saved" }),
					createStore(Saved),
					createStore(Empty),
				];
			}
		}
		const root = mount(createStore(Root));
		(root.list[2] as Saved).value = 7;
		(root.list[3] as Saved).value = 9;
		const snapshot = JSON.parse(JSON.stringify(toSnapshot(root)));
		expect(snapshot).toEqual({
			children: {
				list: [
					null,
					{ key: "saved", state: { value: 7 } },
					{ state: { value: 9 } },
					null,
				],
			},
		});
		const restored = mount(createStore(Root), { snapshot });
		expect((restored.list[2] as Saved).value).toBe(7);
		expect((restored.list[3] as Saved).value).toBe(9);
		expect(toSnapshot(restored)).toEqual(snapshot);
		root[Symbol.dispose]();
		restored[Symbol.dispose]();
	});

	test("preserves unapplied lazy snapshots and saves hydrated stores compactly", () => {
		let realized = 0;
		class Empty extends Store {}
		class Leaf extends Store {
			@snapshotField value = 0;
		}
		class Root extends Store {
			@child get empty() {
				return createStore(Empty, { key: "empty" });
			}
			@child get leaf() {
				realized++;
				return createStore(Leaf);
			}
			@child get absent() {
				return null;
			}
			@child get list() {
				return [];
			}
		}
		const children = {
			empty: { key: "empty", state: {}, children: {} },
			leaf: { state: { value: 7 }, children: {} },
		};
		const root = mount(createStore(Root), {
			snapshot: { state: {}, children },
		});
		// Lazy input is preserved, not migrated or instantiated during a save.
		expect(toSnapshot(root)).toEqual({ children });
		expect(realized).toBe(0);
		void root.empty;
		void root.absent;
		void root.list;
		expect(root.leaf.value).toBe(7);
		// Once hydrated, the normal serializer produces the compact format.
		expect(toSnapshot(root)).toEqual({
			children: { leaf: { state: { value: 7 } } },
		});
		root[Symbol.dispose]();
	});

	test("observes transitions between persisted and empty child branches", () => {
		const enabled = signal(false);
		class Empty extends Store {}
		class Saved extends Store {
			@snapshotField value = 1;
		}
		class Root extends Store {
			@child get leaf() {
				return enabled.value ? createStore(Saved) : createStore(Empty);
			}
		}
		const root = mount(createStore(Root));
		void root.leaf;
		const snapshots: unknown[] = [];
		const stop = onSnapshot(root, (snapshot) => snapshots.push(snapshot));
		enabled.value = true;
		enabled.value = false;
		expect(snapshots).toEqual([
			{ children: { leaf: { state: { value: 1 } } } },
			undefined,
		]);
		stop();
		root[Symbol.dispose]();
	});

	test("preserves explicitly persisted empty values and falsy state", () => {
		class S extends Store {
			@snapshotField object = {};
			@snapshotField list = [];
			@snapshotField zero = 0;
			@snapshotField flag = false;
			@snapshotField missing = undefined;
		}
		const store = mount(createStore(S));
		expect(toSnapshot(store)).toEqual({
			state: { object: {}, list: [], zero: 0, flag: false, missing: undefined },
		});
		store[Symbol.dispose]();
	});

	test("serializes only decorated snapshot fields and observes changes", () => {
		class S extends Store {
			@snapshotField count = 1;
			temporary = "not persisted";
		}

		const store = mount(createStore(S));
		const snapshots: unknown[] = [];
		const stop = onSnapshot(store, (snapshot) => snapshots.push(snapshot));

		expect(toSnapshot(store)).toEqual({
			state: { count: 1 },
		});

		store.count = 2;
		expect(snapshots).toEqual([
			{
				state: { count: 2 },
			},
		]);

		stop();
	});

	test("preserves pending lazy child snapshots when snapshotting again", () => {
		class Child extends Store {
			@snapshotField value = 0;
		}
		class Root extends Store {
			@child get child() {
				return createStore(Child, { key: "only" });
			}
		}

		const snapshot = {
			children: {
				child: {
					key: "only",
					state: { value: 7 },
				},
			},
		};
		const store = mount(createStore(Root), { snapshot });

		expect(toSnapshot(store)).toEqual(snapshot);
		expect(store.child.value).toBe(7);
		expect(toSnapshot(store)).toEqual(snapshot);
	});
});
