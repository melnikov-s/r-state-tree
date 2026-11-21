import {
	applySnapshot,
	child,
	createStore,
	effect,
	mount,
	onSnapshot,
	signal,
	snapshot as snapshotField,
	Store,
	toSnapshot,
} from "../src/index";
import type { StoreSnapshot } from "../src/index";

const savedLabel = (label: string) => ({ state: { label } });

function captureFailure(run: () => unknown): unknown {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error("Expected reconciliation to fail");
}

function underlyingFailures(error: unknown): unknown[] {
	return error instanceof AggregateError
		? error.errors.flatMap(underlyingFailures)
		: [error];
}

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

	test("keeps live children after failed construction and hydrates on an explicit retry", () => {
		let throwOnConstruction = true;
		const failure = new Error("cannot construct yet");
		class Added extends Label {
			constructor(props: Added["props"]) {
				super(props);
				if (throwOnConstruction) throw failure;
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
		const error = captureFailure(() => applySnapshot(root, snapshot));
		expect(underlyingFailures(error)[0]).toBe(failure);
		expect(toSnapshot(root)).toEqual({
			state: { add: true },
			children: { tabs: [savedLabel("default")] },
		});
		expect(original?.label).toBe("default");
		throwOnConstruction = false;
		applySnapshot(root, snapshot);
		expect(root.tabs[0]).toBe(original);
		expect(root.tabs.map((tab) => tab?.label)).toEqual(["first", "second"]);
		root[Symbol.dispose]();
	});

	test("rejects a realized editor snapshot without saving or retrying the rejected value", () => {
		let unopenedReads = 0;
		class Editor extends Store {
			@snapshotField due = new Date("2026-12-01T00:00:00.000Z");
		}
		class Workspace extends Store {
			@child get editors() {
				return [createStore(Editor, { key: "ada" })];
			}
			@child get unopened() {
				unopenedReads++;
				return [createStore(Label)];
			}
		}
		const workspace = mount(createStore(Workspace));
		const editors = workspace.editors;
		const [ada] = editors;
		const initialDue = ada.due;
		const input = (due: string) => ({
			children: {
				editors: [{ key: "ada", state: { due } }],
				unopened: [savedLabel("still pending")],
			},
		});
		const saves: (StoreSnapshot | undefined)[] = [];
		const stop = onSnapshot(workspace, (snapshot) => saves.push(snapshot));

		try {
			expect(() => applySnapshot(workspace, input("not-a-date"))).toThrow(
				/invalid ISO date string/
			);
			expect(ada.due).toBe(initialDue);
			const live = input(initialDue.toISOString());
			expect(toSnapshot(workspace)).toEqual(live);
			expect(saves).toEqual([live]);
			expect(workspace.editors).toBe(editors);
			expect(unopenedReads).toBe(0);

			const validDue = "2027-01-01T00:00:00.000Z";
			applySnapshot(workspace, input(validDue));
			expect(workspace.editors).toBe(editors);
			expect(ada.due).toEqual(new Date(validDue));
			expect(saves.at(-1)).toEqual(input(validDue));
			expect(unopenedReads).toBe(0);
			expect(workspace.unopened[0].label).toBe("still pending");
		} finally {
			stop();
			workspace[Symbol.dispose]();
		}
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

describe("Store child list ownership", () => {
	test("finishes retiring the old list and mounts the replacement after a cleanup throws", () => {
		const keys = signal(["a", "b"]);
		const failure = new Error("a cleanup failed");
		const started: string[] = [];
		const retired: string[] = [];
		class Tab extends Store {
			constructor(props: Tab["props"]) {
				super(props);
				this.effect(() => {
					const key = String(this.key);
					started.push(key);
					return () => {
						retired.push(key);
						if (key === "a") throw failure;
					};
				});
			}
		}
		class Root extends Store {
			@child get tabs() {
				return keys.value.map((key) => createStore(Tab, { key }));
			}
		}
		const root = mount(createStore(Root));
		const original = root.tabs;
		const error = captureFailure(() => {
			keys.value = ["c"];
		});

		expect(underlyingFailures(error)).toEqual([failure]);
		expect(retired).toEqual(["a", "b"]);
		expect(original.map((tab) => tab.signal.aborted)).toEqual([true, true]);
		expect(started).toEqual(["a", "b", "c"]);
		const [replacement] = root.tabs;
		expect(replacement.key).toBe("c");
		root[Symbol.dispose]();
		expect(retired).toEqual(["a", "b", "c"]);
	});

	test.each([false, true])(
		"reports all failures in order and keeps the replacement owned (list: %s)",
		(list) => {
			const replacement = signal(false);
			const cleanupA = new Error("a cleanup failed");
			const cleanupB = new Error("b cleanup failed");
			const startC = new Error("c activation failed");
			const started: string[] = [];
			const retired: string[] = [];
			class Tab extends Store {
				constructor(props: Tab["props"]) {
					super(props);
					this.effect(() => {
						const key = String(this.key);
						started.push(key);
						return () => {
							retired.push(key);
							if (key === "a") throw cleanupA;
							if (key === "b") throw cleanupB;
						};
					});
					this.effect(() => {
						if (this.key === "c") throw startC;
					});
				}
			}
			class Root extends Store {
				@child get tabs() {
					const keys = replacement.value ? ["c", "d"] : ["a", "b"];
					return list
						? keys.map((key) => createStore(Tab, { key }))
						: createStore(Tab, { key: keys[0] });
				}
			}
			const root = mount(createStore(Root));
			void root.tabs;
			const error = captureFailure(() => {
				replacement.value = true;
			});

			expect(error).toBeInstanceOf(AggregateError);
			expect(underlyingFailures(error)).toEqual(
				list ? [cleanupA, cleanupB, startC] : [cleanupA, startC]
			);
			expect(retired).toEqual(list ? ["a", "b"] : ["a"]);
			expect(started).toEqual(list ? ["a", "b", "c", "d"] : ["a", "c"]);
			const current = root.tabs;
			expect((Array.isArray(current) ? current[0] : current).key).toBe("c");
			root[Symbol.dispose]();
			expect(retired).toEqual(list ? ["a", "b", "c", "d"] : ["a", "c"]);
		}
	);

	test("finishes initial list activation after a child throws and does not retry published children", () => {
		const failure = new Error("a activation failed");
		const started: string[] = [];
		const retired: string[] = [];
		class Tab extends Label {
			constructor(props: Tab["props"]) {
				super(props);
				this.effect(() => {
					const key = String(this.key);
					started.push(key);
					if (key === "a") throw failure;
					return () => {
						retired.push(key);
					};
				});
			}
		}
		class Root extends Store {
			@child get tabs() {
				return ["a", "b"].map((key) => createStore(Tab, { key }));
			}
		}
		const root = mount(createStore(Root));
		expect(toSnapshot(root)).toBeUndefined();

		expect(captureFailure(() => root.tabs)).toBe(failure);
		expect(started).toEqual(["a", "b"]);
		expect(toSnapshot(root)).toEqual({
			children: {
				tabs: ["a", "b"].map((key) => ({ key, ...savedLabel("default") })),
			},
		});
		expect(root.tabs.map((tab) => tab.key)).toEqual(["a", "b"]);
		expect(started).toEqual(["a", "b"]);
		root[Symbol.dispose]();
		expect(retired).toEqual(["b"]);
	});

	test("does not mask a cleanup failure with a reaction flushed by applySnapshot", () => {
		const cleanupFailure = new Error("cleanup failed");
		const reactionFailure = new Error("reaction failed");
		class Tab extends Store {
			constructor(props: Tab["props"]) {
				super(props);
				this.effect(() => () => {
					throw cleanupFailure;
				});
			}
		}
		class Root extends Store {
			@snapshotField hide = false;
			@child get tabs() {
				return this.hide ? [] : [createStore(Tab)];
			}
		}
		const root = mount(createStore(Root));
		const [tab] = root.tabs;
		const stop = effect(() => {
			if (root.hide) throw reactionFailure;
		});
		const error = captureFailure(() =>
			applySnapshot(root, { state: { hide: true } })
		);

		expect(underlyingFailures(error)).toEqual([
			cleanupFailure,
			reactionFailure,
		]);
		expect(tab.signal.aborted).toBe(true);
		expect(root.tabs).toEqual([]);
		stop();
		root[Symbol.dispose]();
	});

	test("does not allow a caller to remove an owned child from the published array", () => {
		class Root extends Store {
			@child get tabs() {
				return [createStore(Label)];
			}
		}
		const root = mount(createStore(Root));
		const tabs = root.tabs;
		const [tab] = tabs;
		expect(() => root.tabs.pop()).toThrow(TypeError);
		expect(root.tabs).toBe(tabs);
		expect(tabs).toEqual([tab]);
		root[Symbol.dispose]();
		expect(tab.signal.aborted).toBe(true);
	});
});
