import {
	applySnapshot,
	batch,
	child,
	createStore,
	mount,
	observable,
	snapshot,
	Store,
} from "../src/index";
import * as childReconciliation from "../src/store/ChildReconciliation";

function observeReconciliation() {
	return vi.spyOn(childReconciliation, "reconcileChildStores");
}

describe("Store child reconciliation caching", () => {
	afterEach(() => vi.restoreAllMocks());

	test.each([32, 128])(
		"does not reconcile during indexed iteration over %i unchanged children",
		(size) => {
			let getterRuns = 0;
			class Leaf extends Store<{ value: number }> {}
			class Root extends Store {
				state = observable({ offset: 0 });
				@child get children() {
					getterRuns++;
					return Array.from({ length: size }, (_, key) =>
						createStore(Leaf, { key, value: key + this.state.offset })
					);
				}
			}
			const root = mount(createStore(Root));
			const reconcile = observeReconciliation();
			const children = root.children;
			expect(reconcile).toHaveBeenCalledTimes(1);
			reconcile.mockClear();

			let sum = 0;
			for (let i = 0; i < root.children.length; i++) {
				sum += root.children[i].props.value;
			}
			expect(sum).toBe((size * (size - 1)) / 2);
			expect(getterRuns).toBe(1);
			expect(reconcile).toHaveBeenCalledTimes(0);

			// Invalidation updates even a retained array, without another public read.
			root.state.offset = 10;
			expect(children[0].props.value).toBe(10);
			expect(reconcile).toHaveBeenCalledTimes(1);
			reconcile.mockClear();
			for (let i = 0; i < root.children.length; i++) {
				expect(root.children[i]).toBe(children[i]);
				expect(root.children[i].props.value).toBe(i + 10);
			}
			expect(root.children).toBe(children);
			expect(getterRuns).toBe(2);
			expect(reconcile).toHaveBeenCalledTimes(0);
			root[Symbol.dispose]();
		}
	);

	test("caches single, null, undefined, and empty-array children", () => {
		class Leaf extends Store {}
		class Root extends Store {
			@child get single() {
				return createStore(Leaf);
			}
			@child get absent() {
				return null;
			}
			@child get missing() {
				return undefined;
			}
			@child get empty() {
				return [];
			}
		}
		const root = mount(createStore(Root));
		const reconcile = observeReconciliation();
		for (const name of ["single", "absent", "missing", "empty"] as const) {
			const child = root[name];
			reconcile.mockClear();
			for (let i = 0; i < 10; i++) expect(root[name]).toBe(child);
			expect(reconcile).toHaveBeenCalledTimes(0);
		}
		root[Symbol.dispose]();
	});

	test("reconciles synchronous batch reads once per descriptor change", () => {
		class Leaf extends Store<{ value: number }> {}
		class OtherLeaf extends Leaf {}
		class Root extends Store {
			state = observable({ ids: [1, 2], value: 0, otherType: false });
			@child get children() {
				const Type = this.state.otherType ? OtherLeaf : Leaf;
				return this.state.ids.map((key) =>
					createStore(Type, { key, value: this.state.value })
				);
			}
		}
		const root = mount(createStore(Root));
		const original = root.children;
		const reconcile = observeReconciliation();
		batch(() => {
			root.state.value = 1;
			expect(root.children).toBe(original);
			expect(original.map((leaf) => leaf.props.value)).toEqual([1, 1]);
			expect(root.children).toBe(original);
			expect(reconcile).toHaveBeenCalledTimes(1);

			root.state.ids = [2, 1];
			expect(root.children).toEqual([original[1], original[0]]);
			expect(root.children).toEqual([original[1], original[0]]);
			expect(reconcile).toHaveBeenCalledTimes(2);

			root.state.otherType = true;
			expect(root.children.every((leaf) => leaf instanceof OtherLeaf)).toBe(
				true
			);
			expect(original.every((leaf) => leaf.signal.aborted)).toBe(true);
			expect(root.children).toHaveLength(2);
			expect(reconcile).toHaveBeenCalledTimes(3);
		});
		// The queued listener must not repeat work already performed by a read.
		expect(reconcile).toHaveBeenCalledTimes(3);
		root[Symbol.dispose]();
	});

	test("synchronously updates single-child props, keys, and nullability in a batch", () => {
		class Leaf extends Store<{ value: number }> {}
		class Root extends Store {
			state = observable({ key: "first", value: 0, present: true });
			@child get leaf() {
				return this.state.present
					? createStore(Leaf, {
							key: this.state.key,
							value: this.state.value,
						})
					: null;
			}
		}
		const root = mount(createStore(Root));
		const original = root.leaf!;
		batch(() => {
			root.state.value = 1;
			expect(root.leaf).toBe(original);
			expect(original.props.value).toBe(1);
			root.state.key = "second";
			expect(root.leaf).not.toBe(original);
			expect(root.leaf!.key).toBe("second");
			expect(original.signal.aborted).toBe(true);
			const replacement = root.leaf!;
			root.state.present = false;
			expect(root.leaf).toBeNull();
			expect(replacement.signal.aborted).toBe(true);
			root.state.present = true;
			expect(root.leaf).toBeInstanceOf(Leaf);
			expect(root.leaf!.props.value).toBe(1);
		});
		root[Symbol.dispose]();
	});

	test("skips reconciliation when an invalidated getter returns the same descriptor", () => {
		const dependency = observable({ value: 0 });
		class Leaf extends Store {}
		const element = createStore(Leaf);
		let getterRuns = 0;
		class Root extends Store {
			@child get leaf() {
				getterRuns++;
				void dependency.value;
				return element;
			}
		}
		const root = mount(createStore(Root));
		const leaf = root.leaf;
		const reconcile = observeReconciliation();
		dependency.value++;
		expect(root.leaf).toBe(leaf);
		expect(getterRuns).toBe(2);
		expect(reconcile).toHaveBeenCalledTimes(0);
		root[Symbol.dispose]();
	});

	test("hydrates pending snapshots even when realized descriptors are unchanged", () => {
		class Leaf extends Store {
			@snapshot value = 0;
		}
		class Root extends Store {
			@child get leaf() {
				return createStore(Leaf);
			}
			@child get children() {
				return [createStore(Leaf, { key: "a" })];
			}
		}
		const root = mount(createStore(Root));
		const leaf = root.leaf;
		const children = root.children;
		applySnapshot(root, {
			children: {
				leaf: { state: { value: 7 } },
				children: [{ key: "a", state: { value: 8 } }],
			},
		});
		expect(root.leaf).toBe(leaf);
		expect(root.children).toBe(children);
		expect(leaf.value).toBe(7);
		expect(children[0].value).toBe(8);
		const reconcile = observeReconciliation();
		void root.leaf;
		void root.children;
		expect(reconcile).toHaveBeenCalledTimes(0);
		root[Symbol.dispose]();
	});

	test("retries a failed array update without caching the failed plan", () => {
		let fail = true;
		class Leaf extends Store<{ value: number }> {
			constructor(props: Leaf["props"]) {
				super(props);
				if (props.key === "new" && fail) throw new Error("construction failed");
			}
		}
		class Root extends Store {
			state = observable({ add: false });
			@child get children() {
				return this.state.add
					? [
							createStore(Leaf, { key: "old", value: 1 }),
							createStore(Leaf, { key: "new", value: 2 }),
						]
					: [createStore(Leaf, { key: "old", value: 0 })];
			}
		}
		const root = mount(createStore(Root));
		const original = root.children;
		expect(() => {
			root.state.add = true;
		}).toThrow("construction failed");
		expect(() => root.children).toThrow("construction failed");
		expect(original[0].props.value).toBe(0);
		expect(original[0].signal.aborted).toBe(false);
		fail = false;
		expect(root.children[0]).toBe(original[0]);
		expect(root.children.map((leaf) => leaf.props.value)).toEqual([1, 2]);
		const reconcile = observeReconciliation();
		void root.children;
		expect(reconcile).toHaveBeenCalledTimes(0);
		root[Symbol.dispose]();
	});

	test("retries the same descriptor after initial construction fails", () => {
		let fail = true;
		let attempts = 0;
		class Leaf extends Store {
			constructor(props: Leaf["props"]) {
				super(props);
				attempts++;
				if (fail) throw new Error("construction failed");
			}
		}
		class Root extends Store {
			@child get leaf() {
				return createStore(Leaf);
			}
		}
		const root = mount(createStore(Root));
		expect(() => root.leaf).toThrow("construction failed");
		expect(() => root.leaf).toThrow("construction failed");
		fail = false;
		expect(root.leaf).toBeInstanceOf(Leaf);
		expect(attempts).toBe(3);
		const reconcile = observeReconciliation();
		void root.leaf;
		expect(reconcile).toHaveBeenCalledTimes(0);
		root[Symbol.dispose]();
	});
});
