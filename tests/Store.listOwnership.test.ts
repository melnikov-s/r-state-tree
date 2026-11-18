import {
	applySnapshot,
	child,
	createStore,
	mount,
	signal,
	snapshot as snapshotField,
	Store,
	toSnapshot,
} from "../src/index";

const savedLabel = (label: string) => ({ state: { label } });

class Label extends Store {
	@snapshotField label = "default";
}

describe("Store child list matching", () => {
	test.each([0, 1])(
		"hydrates mixed reused and new unkeyed children with replacement at index %i",
		(replacedIndex) => {
			const activated: string[] = [];
			class Original extends Label {}
			class Replacement extends Label {
				constructor(props: Replacement["props"]) {
					super(props);
					this.effect(() => {
						activated.push(this.label);
					});
				}
			}
			class Root extends Store {
				@snapshotField replace = false;
				@child get tabs() {
					return [0, 1].map((index) =>
						createStore(
							this.replace && index === replacedIndex ? Replacement : Original
						)
					);
				}
			}
			const root = mount(createStore(Root));
			const original = root.tabs;
			applySnapshot(root, {
				state: { replace: true },
				children: { tabs: [savedLabel("first"), savedLabel("second")] },
			});

			expect(root.tabs[1 - replacedIndex]).toBe(original[1 - replacedIndex]);
			expect(original[replacedIndex].signal.aborted).toBe(true);
			expect(root.tabs.map(({ label }) => label)).toEqual(["first", "second"]);
			expect(activated).toEqual([replacedIndex === 0 ? "first" : "second"]);
			root[Symbol.dispose]();
		}
	);

	test("reorders keyed stores without shifting unkeyed positions or consuming descriptor gaps", () => {
		class Empty extends Store {}
		class Root extends Store {
			@snapshotField reverse = false;
			@child get tabs() {
				return [
					createStore(Label, { key: this.reverse ? "b" : "a" }),
					null,
					createStore(Empty),
					createStore(Label),
					createStore(Label, { key: this.reverse ? "a" : "b" }),
				];
			}
		}
		const root = mount(createStore(Root));
		const [a, empty, unkeyed, b] = root.tabs;

		applySnapshot(root, {
			state: { reverse: true },
			children: {
				tabs: [
					{ key: "a", ...savedLabel("A") },
					null,
					savedLabel("unkeyed"),
					{ key: "b", ...savedLabel("B") },
				],
			},
		});

		expect(root.tabs).toEqual([b, empty, unkeyed, a]);
		for (const [index, store] of [b, empty, unkeyed, a].entries()) {
			expect(root.tabs[index]).toBe(store);
		}
		expect(
			root.tabs
				.filter((store) => store instanceof Label)
				.map((store) => store.label)
		).toEqual(["B", "unkeyed", "A"]);
		root[Symbol.dispose]();
	});

	test("creates an unkeyed child when a keyed child formerly occupied that position", () => {
		const keyed = signal(true);
		class Root extends Store {
			@child get tabs() {
				return [createStore(Label, { key: keyed.value ? "a" : undefined })];
			}
		}
		const root = mount(createStore(Root));
		const [before] = root.tabs;
		keyed.value = false;

		expect(root.tabs).toHaveLength(1);
		expect(root.tabs[0]).not.toBe(before);
		expect(root.tabs[0].key).toBeUndefined();
		expect(before.signal.aborted).toBe(true);
		root[Symbol.dispose]();
	});

	test("retains the pending list when construction fails and hydrates on retry", () => {
		let throwOnConstruction = true;
		class Added extends Label {
			constructor(props: Added["props"]) {
				super(props);
				if (throwOnConstruction) throw new Error("cannot construct yet");
			}
		}
		class Root extends Store {
			@snapshotField add = false;
			@child get tabs() {
				return [createStore(Label), this.add ? createStore(Added) : null];
			}
		}
		const root = mount(createStore(Root));
		const [original] = root.tabs;
		void toSnapshot(root);
		const snapshot = {
			state: { add: true },
			children: { tabs: [savedLabel("first"), savedLabel("second")] },
		};
		expect(() => applySnapshot(root, snapshot)).toThrow("cannot construct yet");
		expect(toSnapshot(root)).toEqual(snapshot);
		expect(original?.label).toBe("default");
		throwOnConstruction = false;
		expect(root.tabs[0]).toBe(original);
		expect(root.tabs.map((tab) => tab?.label)).toEqual(["first", "second"]);
		root[Symbol.dispose]();
	});

	test("retries pending hydration when the descriptor did not change", () => {
		class Dated extends Store {
			@snapshotField date: Date | string = new Date(0);
		}
		class Root extends Store {
			@child get tabs() {
				return [createStore(Dated)];
			}
		}
		const root = mount(createStore(Root));
		const [original] = root.tabs;
		const snapshot = { children: { tabs: [{ state: { date: "unknown" } }] } };
		expect(() => applySnapshot(root, snapshot)).toThrow(
			/invalid ISO date string/
		);
		expect(toSnapshot(root)).toEqual(snapshot);
		original.date = "";
		expect(root.tabs[0]).toBe(original);
		expect(original.date).toBe("unknown");
		root[Symbol.dispose]();
	});

	test.each([1_000, 2_000])(
		"does not repeatedly filter remaining snapshots when hydrating %i children",
		(size) => {
			let getterReads = 0;
			class Root extends Store {
				@child get tabs() {
					getterReads++;
					return Array.from({ length: size }, (_, index) =>
						createStore(Label, { key: size - index - 1 })
					);
				}
			}
			const snapshot = {
				children: {
					tabs: Array.from({ length: size }, (_, key) => ({
						key,
						...savedLabel(`measured snapshot ${key}`),
					})),
				},
			};
			const root = mount(createStore(Root), { snapshot });
			expect(toSnapshot(root)).toEqual(snapshot);
			expect(getterReads).toBe(0);

			let filterSlots = 0;
			const filter = Array.prototype.filter;
			const spy = vi
				.spyOn(Array.prototype, "filter")
				.mockImplementation(function (
					this: typeof snapshot.children.tabs,
					predicate,
					thisArg
				) {
					if (this[0]?.state?.label?.startsWith("measured snapshot ")) {
						filterSlots += this.length;
					}
					return filter.call(this, predicate, thisArg);
				});
			let tabs: Label[];
			try {
				tabs = root.tabs;
			} finally {
				spy.mockRestore();
				root[Symbol.dispose]();
			}
			expect(tabs.map((tab) => tab.label)).toEqual(
				snapshot.children.tabs.map(({ state }) => state.label).reverse()
			);
			expect(filterSlots).toBeLessThanOrEqual(size);
		}
	);
});
