import {
	applySnapshot,
	Store,
	child,
	createStore,
	mount,
	reaction,
	effect,
	observable,
	isObservable,
	onSnapshot,
	signal,
	snapshot as snapshotField,
	toSnapshot,
} from "../src/index";

describe("Store snapshots", () => {
	test("hydrates snapshot fields before mounted effects activate", () => {
		const valuesSeenByEffect: number[] = [];

		class S extends Store {
			@snapshotField count = 0;

			constructor(props: S["props"]) {
				super(props);
				this.effect(() => {
					valuesSeenByEffect.push(this.count);
				});
			}
		}

		const store = mount(createStore(S), {
			snapshot: {
				state: { count: 42 },
				children: {},
			},
		});

		expect(store.count).toBe(42);
		expect(valuesSeenByEffect).toEqual([42]);
	});

	test("applySnapshot hydrates an unmounted store before its effects activate", () => {
		const valuesSeenByEffect: number[] = [];

		class S extends Store {
			@snapshotField count = 0;

			constructor(props: S["props"]) {
				super(props);
				this.effect(() => {
					valuesSeenByEffect.push(this.count);
				});
			}
		}

		const store = createStore(S);
		applySnapshot(store, { state: { count: 42 }, children: {} });

		const mounted = mount(store);

		expect(mounted.count).toBe(42);
		expect(valuesSeenByEffect).toEqual([42]);
	});

	test("applySnapshot applies to an already mounted store", () => {
		const seen: number[] = [];

		class S extends Store {
			@snapshotField count = 0;

			constructor(props: S["props"]) {
				super(props);
				this.reaction(
					() => this.count,
					(count) => seen.push(count)
				);
			}
		}

		const store = mount(createStore(S));
		expect(store.count).toBe(0);

		applySnapshot(store, { state: { count: 7 }, children: {} });

		expect(store.count).toBe(7);
		expect(toSnapshot(store)).toEqual({ state: { count: 7 } });
		expect(seen).toEqual([7]);
	});

	test("does not retain references into the supplied state snapshot", () => {
		class S extends Store {
			@snapshotField payload: { count: number } | undefined = undefined;
		}

		const snapshot = {
			state: { payload: { count: 1 } },
			children: {},
		};
		const store = mount(createStore(S), { snapshot });
		const payload = store.payload!;

		expect(payload).not.toBe(snapshot.state.payload);

		payload.count = 2;
		expect(snapshot.state.payload.count).toBe(1);

		snapshot.state.payload.count = 3;
		expect(payload.count).toBe(2);

		store[Symbol.dispose]();
	});

	test("preserves observable element shape when hydrated snapshot arrays grow", () => {
		class S extends Store {
			@snapshotField items = [observable({ value: 0 })];
		}

		const store = mount(createStore(S), {
			snapshot: {
				state: {
					items: [{ value: 1 }, { value: 2 }],
				},
				children: {},
			},
		});

		expect(store.items.map((item) => isObservable(item))).toEqual([true, true]);

		const snapshots: unknown[] = [];
		const stop = onSnapshot(store, (snapshot) => snapshots.push(snapshot));

		store.items[1].value = 3;

		const expected = {
			state: {
				items: [{ value: 1 }, { value: 3 }],
			},
		};
		expect(snapshots).toEqual([expected]);
		expect(toSnapshot(store)).toEqual(expected);

		stop();
		store[Symbol.dispose]();
	});

	test("lazily applies keyed child snapshots before child effects activate", () => {
		const childValuesSeenByEffect: Array<[string, number]> = [];

		class Child extends Store {
			@snapshotField value = 0;

			constructor(props: Child["props"]) {
				super(props);
				this.effect(() => {
					childValuesSeenByEffect.push([String(this.key), this.value]);
				});
			}
		}

		class Root extends Store {
			@snapshotField ids = ["a", "b"];

			@child get children() {
				return this.ids.map((id) => createStore(Child, { key: id }));
			}
		}

		const store = mount(createStore(Root), {
			snapshot: {
				state: { ids: ["b", "a"] },
				children: {
					children: [
						{
							key: "a",
							state: { value: 10 },
							children: {},
						},
						{
							key: "b",
							state: { value: 20 },
							children: {},
						},
					],
				},
			},
		});

		expect(childValuesSeenByEffect).toEqual([]);
		expect(store.children.map((item) => [item.key, item.value])).toEqual([
			["b", 20],
			["a", 10],
		]);
		expect(childValuesSeenByEffect).toEqual([
			["b", 20],
			["a", 10],
		]);
	});

	test("hydrates unkeyed child snapshots positionally", () => {
		class Child extends Store {
			@snapshotField value = 0;
		}

		class Root extends Store {
			@child get children() {
				return [createStore(Child), createStore(Child), createStore(Child)];
			}
		}

		const root = mount(createStore(Root), {
			snapshot: {
				state: {},
				children: {
					children: [1, 2, 3].map((value) => ({
						state: { value },
						children: {},
					})),
				},
			},
		});

		expect(root.children.map((child) => child.value)).toEqual([1, 2, 3]);
	});

	test("does not mistake inherited object members for pending child snapshots", () => {
		class Leaf extends Store {}
		class Root extends Store {
			@child get toString(): any {
				return createStore(Leaf);
			}

			@child get valueOf(): any {
				return null;
			}
		}

		const root = mount(createStore(Root));

		expect(root.toString).toBeInstanceOf(Leaf);
		expect(root.valueOf).toBeNull();
		expect(toSnapshot(root)).toBeUndefined();

		root[Symbol.dispose]();
	});

	test("hydrates a child realized during its parent constructor", () => {
		class Child extends Store {
			@snapshotField value = 0;
		}

		class Root extends Store {
			constructor(props: Root["props"]) {
				super(props);
				void this.child;
			}

			@child get child() {
				return createStore(Child);
			}
		}

		const root = mount(createStore(Root), {
			snapshot: {
				state: {},
				children: {
					child: {
						state: { value: 7 },
						children: {},
					},
				},
			},
		});

		expect(root.child.value).toBe(7);
	});

	test("hydrates the child selected by snapshot state after constructor access", () => {
		const valuesSeenByEffect: number[] = [];
		const selectionInstances: Array<{ useChildB: boolean }> = [];

		class ChildA extends Store {
			@snapshotField value = 0;
		}

		class ChildB extends Store {
			@snapshotField value = 0;

			constructor(props: ChildB["props"]) {
				super(props);
				this.effect(() => {
					valuesSeenByEffect.push(this.value);
				});
			}
		}

		class Root extends Store {
			@snapshotField selection = { useChildB: false };

			constructor(props: Root["props"]) {
				super(props);
				selectionInstances.push(this.selection);
				void this.child;
			}

			@child get child() {
				return this.selection.useChildB
					? createStore(ChildB)
					: createStore(ChildA);
			}
		}

		const root = mount(createStore(Root), {
			snapshot: {
				state: { selection: { useChildB: true } },
				children: {
					child: {
						state: { value: 7 },
						children: {},
					},
				},
			},
		});

		expect(root.selection).toBe(selectionInstances[0]);
		expect(root.child).toBeInstanceOf(ChildB);
		expect(root.child.value).toBe(7);
		expect(valuesSeenByEffect).toEqual([7]);
	});

	test("matches a reordered subset by key and discards unmatched snapshots", () => {
		class Child extends Store {
			@snapshotField value = 0;
		}

		class Root extends Store<{ ids: string[] }> {
			@child get children() {
				return this.props.ids.map((id) => createStore(Child, { key: id }));
			}
		}

		const savedKeys = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
		const currentKeys = ["j", "b", "h", "a", "e"];
		const root = mount(createStore(Root, { ids: currentKeys }), {
			snapshot: {
				state: {},
				children: {
					children: savedKeys.map((key, index) => ({
						key,
						state: { value: index + 1 },
						children: {},
					})),
				},
			},
		});

		const expectedChildren = [
			["j", 10],
			["b", 2],
			["h", 8],
			["a", 1],
			["e", 5],
		];

		expect(root.children.map((child) => [child.key, child.value])).toEqual(
			expectedChildren
		);
		const snapshotChildren = toSnapshot(root)?.children?.children;
		if (!Array.isArray(snapshotChildren)) {
			throw new Error("Expected an array of child snapshots");
		}
		expect(
			snapshotChildren.map((child) => [child?.key, child?.state?.value])
		).toEqual(expectedChildren);
	});

	test("discards an unmatched single-child snapshot after realization", () => {
		class Child extends Store {
			@snapshotField value = 0;
		}
		class Root extends Store {
			@snapshotField activeKey = "current";

			@child get child() {
				return createStore(Child, { key: this.activeKey });
			}
		}

		const root = mount(createStore(Root), {
			snapshot: {
				state: { activeKey: "current" },
				children: {
					child: {
						key: "saved",
						state: { value: 7 },
						children: {},
					},
				},
			},
		});

		expect(root.child.key).toBe("current");
		expect(root.child.value).toBe(0);

		root.activeKey = "saved";

		expect(root.child.key).toBe("saved");
		expect(root.child.value).toBe(0);
	});

	test("failed lazy child hydration is retryable and disposes each child", () => {
		const createdChildren: Store[] = [];

		class Child extends Store {
			@snapshotField createdAt = new Date("2024-01-01T00:00:00.000Z");

			constructor(props: Child["props"]) {
				super(props);
				createdChildren.push(this);
			}
		}
		class Root extends Store {
			@child get child() {
				return createStore(Child);
			}
		}

		const root = mount(createStore(Root), {
			snapshot: {
				state: {},
				children: {
					child: {
						state: { createdAt: "not-a-date" },
						children: {},
					},
				},
			},
		});

		expect(() => root.child).toThrow(/invalid ISO date string/);
		expect(createdChildren).toHaveLength(1);
		expect(createdChildren[0].signal.aborted).toBe(true);

		expect(() => root.child).toThrow(/invalid ISO date string/);
		expect(createdChildren).toHaveLength(2);
		expect(createdChildren[1].signal.aborted).toBe(true);

		root[Symbol.dispose]();
	});

	test("rolls back a partially hydrated child list", () => {
		const createdChildren: Store[] = [];

		class Child extends Store {
			@snapshotField createdAt = new Date("2024-01-01T00:00:00.000Z");

			constructor(props: Child["props"]) {
				super(props);
				createdChildren.push(this);
			}
		}
		class Root extends Store {
			@child get children() {
				return [
					createStore(Child, { key: "valid" }),
					createStore(Child, { key: "invalid" }),
				];
			}
		}

		const snapshot = {
			children: {
				children: [
					{
						key: "valid",
						state: { createdAt: "2025-01-01T00:00:00.000Z" },
					},
					{
						key: "invalid",
						state: { createdAt: "not-a-date" },
					},
				],
			},
		};
		const root = mount(createStore(Root), { snapshot });

		let hydrationError: unknown;
		try {
			void root.children;
		} catch (error) {
			hydrationError = error;
		}

		const abortedChildren = createdChildren.map(
			(childStore) => childStore.signal.aborted
		);
		const snapshotAfterFailure = toSnapshot(root);

		createdChildren.forEach((childStore) => childStore[Symbol.dispose]());
		root[Symbol.dispose]();

		expect(hydrationError).toBeInstanceOf(Error);
		expect((hydrationError as Error).message).toMatch(
			/invalid ISO date string/
		);
		expect(abortedChildren).toEqual([true, true]);
		expect(snapshotAfterFailure).toEqual(snapshot);
	});

	test("disposes child getter tracking created during snapshot hydration", () => {
		const useChildB = signal(false);

		class ChildA extends Store {}
		class ChildB extends Store {}
		class Root extends Store {
			constructor(props: Root["props"]) {
				super(props);
				void this.child;
			}

			@child get child() {
				return useChildB.value ? createStore(ChildB) : createStore(ChildA);
			}
		}

		const root = mount(createStore(Root), {
			snapshot: { state: {}, children: {} },
		});
		root[Symbol.dispose]();

		expect(() => {
			useChildB.value = true;
		}).not.toThrow();
	});

	test("does not expose an empty intermediate snapshot while realizing a pending child", () => {
		class Child extends Store {
			@snapshotField value = 0;
		}
		class Root extends Store {
			@child get child() {
				return createStore(Child, { key: "only" });
			}
		}

		const expected = {
			children: {
				child: {
					key: "only",
					state: { value: 7 },
				},
			},
		};
		const root = mount(createStore(Root), { snapshot: expected });
		const snapshots: unknown[] = [];
		const stop = onSnapshot(root, (snapshot) => snapshots.push(snapshot));

		void root.child;

		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]).toEqual(expected);
		stop();
	});

	test("keeps same-type child instances isolated by child property", () => {
		class Pane extends Store {
			@snapshotField position = 0;
		}
		class Root extends Store {
			@child get left() {
				return createStore(Pane, { key: "shared" });
			}
			@child get right() {
				return createStore(Pane, { key: "shared" });
			}
		}

		const root = mount(createStore(Root), {
			snapshot: {
				state: {},
				children: {
					left: {
						key: "shared",
						state: { position: 10 },
						children: {},
					},
					right: {
						key: "shared",
						state: { position: 20 },
						children: {},
					},
				},
			},
		});

		expect(root.left.position).toBe(10);
		expect(root.right.position).toBe(20);
		expect(root.left).not.toBe(root.right);
	});

	test("tracks child state and dynamic keyed child changes", () => {
		class Child extends Store {
			@snapshotField value = 0;
		}
		class Root extends Store {
			@snapshotField ids = ["a"];

			@child get children() {
				return this.ids.map((id) => createStore(Child, { key: id }));
			}
		}

		const root = mount(createStore(Root));
		void root.children;
		const snapshots: unknown[] = [];
		const stop = onSnapshot(root, (snapshot) => snapshots.push(snapshot));

		root.children[0].value = 3;
		root.ids = ["a", "b"];
		void root.children;

		expect(snapshots.at(-1)).toEqual({
			state: { ids: ["a", "b"] },
			children: {
				children: [
					{ key: "a", state: { value: 3 } },
					{ key: "b", state: { value: 0 } },
				],
			},
		});

		stop();
	});
});
