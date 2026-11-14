import { child, createStore, mount, observable, Store } from "../src/index";
import { getStoreAdm } from "../src/store/StoreAdministration";

describe("Store teardown failures", () => {
	test("stops every owned subscription and aggregates cleanup errors after finalization", () => {
		const dependency = observable({ value: 0 });
		const firstError = new Error("first cleanup failed");
		const secondError = new Error("second cleanup failed");
		const cleanups: string[] = [];
		let effectRuns = 0;
		let reactionRuns = 0;
		class Root extends Store {
			constructor(props: Root["props"]) {
				super(props);
				this.effect(() => () => {
					cleanups.push("first");
					expect(this.signal.aborted).toBe(true);
					this[Symbol.dispose]();
					throw firstError;
				});
				this.effect(() => {
					void dependency.value;
					effectRuns++;
					return () => {
						cleanups.push("second");
						throw secondError;
					};
				});
				this.reaction(
					() => dependency.value,
					() => reactionRuns++
				);
				this.effect(() => () => {
					cleanups.push("last");
				});
			}
		}
		const root = mount(createStore(Root));
		let disposalError: unknown;
		try {
			root[Symbol.dispose]();
		} catch (error) {
			disposalError = error;
		}
		expect(disposalError).toBeInstanceOf(AggregateError);
		expect((disposalError as AggregateError).errors).toEqual([
			firstError,
			secondError,
		]);
		expect(cleanups).toEqual(["first", "second", "last"]);
		expect(root.signal.aborted).toBe(true);
		expect(getStoreAdm(root).isMounted).toBe(false);
		expect(() => root[Symbol.dispose]()).not.toThrow();
		expect(() => root.effect(() => {})).toThrow(/disposed store/);
		dependency.value++;
		expect(effectRuns).toBe(1);
		expect(reactionRuns).toBe(0);
		expect(cleanups).toEqual(["first", "second", "last"]);
	});

	test("a failing child does not prevent sibling, descendant, or parent teardown", () => {
		const dependency = observable({ value: 0 });
		const cleanups: string[] = [];
		let runs = 0;
		class Leaf extends Store<{ fail?: boolean; name: string }> {
			constructor(props: Leaf["props"]) {
				super(props);
				this.effect(() => {
					void dependency.value;
					runs++;
					return () => {
						cleanups.push(this.props.name);
						if (this.props.fail) throw new Error("child cleanup failed");
					};
				});
			}
		}
		class Branch extends Store {
			@child get leaves() {
				return [
					createStore(Leaf, { name: "first", fail: true }),
					createStore(Leaf, { name: "second" }),
				];
			}
		}
		class Root extends Store {
			@child get branch() {
				return createStore(Branch);
			}
			@child get sibling() {
				return createStore(Leaf, { name: "sibling" });
			}
			constructor(props: Root["props"]) {
				super(props);
				this.effect(() => () => {
					cleanups.push("root");
				});
			}
		}
		const root = mount(createStore(Root));
		const branch = root.branch;
		const leaves = branch.leaves;
		const sibling = root.sibling;
		expect(() => root[Symbol.dispose]()).toThrow(AggregateError);
		expect(cleanups).toEqual(["first", "second", "sibling", "root"]);
		for (const store of [root, branch, ...leaves, sibling]) {
			expect(store.signal.aborted).toBe(true);
			expect(getStoreAdm(store).isMounted).toBe(false);
			expect(getStoreAdm(store).parent).toBe(null);
		}
		expect(getStoreAdm(root).peekInspectionChild("branch").initialized).toBe(
			false
		);
		dependency.value++;
		expect(runs).toBe(3);
		expect(() => root[Symbol.dispose]()).not.toThrow();
	});

	test("preserves non-Error cleanup failures while continuing teardown", () => {
		const root = mount(createStore(Store));
		let cleaned = false;
		root.effect(() => () => {
			throw undefined;
		});
		root.effect(() => () => {
			throw "cleanup failed";
		});
		root.effect(() => () => {
			cleaned = true;
		});
		let disposalError: unknown;
		try {
			root[Symbol.dispose]();
		} catch (error) {
			disposalError = error;
		}
		expect(disposalError).toBeInstanceOf(AggregateError);
		expect((disposalError as AggregateError).errors).toEqual([
			undefined,
			"cleanup failed",
		]);
		expect(cleaned).toBe(true);
		expect(getStoreAdm(root).isMounted).toBe(false);
	});
});

describe("Store children during and after disposal", () => {
	test("does not initialize or reconcile children after disposal", () => {
		let constructions = 0;
		let getterRuns = 0;
		class Leaf extends Store {
			constructor(props: Leaf["props"]) {
				super(props);
				constructions++;
			}
		}
		class Root extends Store {
			state = observable({ key: "initial" });
			@child get lazy() {
				getterRuns++;
				return createStore(Leaf);
			}
			@child get realized() {
				getterRuns++;
				return createStore(Leaf, { key: this.state.key });
			}
		}
		const root = mount(createStore(Root));
		const realized = root.realized;
		let abortReadError: unknown;
		root.signal.addEventListener("abort", () => {
			try {
				void root.lazy;
			} catch (error) {
				abortReadError = error;
			}
			// Abort handlers run before the child listener has been detached.
			root.state.key = "during-abort";
		});
		root.effect(() => () => {
			expect(() => root.realized).toThrow(/disposed store/);
		});
		root[Symbol.dispose]();
		expect(abortReadError).toEqual(
			expect.objectContaining({
				message: expect.stringMatching(/disposed store/),
			})
		);
		const readsAfterDisposal = getterRuns;
		expect(() => root.lazy).toThrow(/disposed store/);
		expect(() => root.realized).toThrow(/disposed store/);
		root.state.key = "after-disposal";
		expect(getterRuns).toBe(readsAfterDisposal);
		expect(constructions).toBe(1);
		expect(realized.signal.aborted).toBe(true);
	});
});

describe("Single child replacement failures", () => {
	test.each(["type", "key"] as const)(
		"keeps the current child alive when a replacement constructor fails (%s change)",
		(change) => {
			const dependency = observable({ value: 0 });
			let runs = 0;
			let fail = false;
			class Leaf extends Store {
				constructor(props: Leaf["props"]) {
					super(props);
					if (fail) throw new Error("replacement failed");
					this.effect(() => {
						void dependency.value;
						runs++;
					});
				}
			}
			class OtherLeaf extends Leaf {}
			class Root extends Store {
				state = observable({ replace: false });
				@child get leaf() {
					const Type =
						change === "type" && this.state.replace ? OtherLeaf : Leaf;
					const key = change === "key" && this.state.replace ? "new" : "old";
					return createStore(Type, { key });
				}
			}
			const root = mount(createStore(Root));
			const original = root.leaf;
			fail = true;
			expect(() => {
				root.state.replace = true;
			}).toThrow("replacement failed");
			expect(original.signal.aborted).toBe(false);
			expect(getStoreAdm(root).peekInspectionChild("leaf").value).toBe(
				original
			);
			dependency.value++;
			expect(runs).toBe(2);
			fail = false;
			const replacement = root.leaf;
			expect(replacement).not.toBe(original);
			expect(original.signal.aborted).toBe(true);
			expect(replacement.signal.aborted).toBe(false);
			expect(runs).toBe(3);
			root[Symbol.dispose]();
		}
	);

	test("owns and mounts the replacement even when the retired child cleanup throws", () => {
		const dependency = observable({ value: 0 });
		let runs = 0;
		class Leaf extends Store {
			constructor(props: Leaf["props"]) {
				super(props);
				this.effect(() => {
					void dependency.value;
					runs++;
					return () => {
						if (this.key === "old") throw new Error("retired cleanup failed");
					};
				});
			}
		}
		class Root extends Store {
			state = observable({ key: "old" });
			@child get leaf() {
				return createStore(Leaf, { key: this.state.key });
			}
		}
		const root = mount(createStore(Root));
		const original = root.leaf;
		expect(() => {
			root.state.key = "new";
		}).toThrow(AggregateError);
		const replacement = root.leaf;
		expect(replacement).not.toBe(original);
		expect(original.signal.aborted).toBe(true);
		expect(getStoreAdm(replacement).isMounted).toBe(true);
		dependency.value++;
		expect(runs).toBe(3);
		root[Symbol.dispose]();
		expect(replacement.signal.aborted).toBe(true);
		dependency.value++;
		expect(runs).toBe(3);
	});
});
