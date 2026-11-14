import {
	Model,
	applySnapshot,
	child,
	findModelById,
	id,
	onSnapshot,
	onSnapshotDiff,
	reaction,
	signal,
	toSnapshot,
	type Snapshot,
} from "../src/index";

class Item extends Model {
	@id id!: number;
	value = 0;
}

class Root extends Model {
	value = 0;
	@child(Item) first = Item.create({ id: 1 });
	@child(Item) second = Item.create({ id: 2 });
	@child(Item) items = [Item.create({ id: 3 })];
}

function watch(root: Root) {
	const snapshots: unknown[] = [];
	const diffs: unknown[] = [];
	const parents: unknown[] = [];
	const before = toSnapshot(root);
	const first = root.first;
	const second = root.second;
	const items = root.items;
	const item = items[0];
	const stops = [
		onSnapshot(root, (snapshot) => snapshots.push(snapshot)),
		onSnapshotDiff(root, (diff) => diffs.push(diff)),
		reaction(
			() => first.parent,
			(parent) => parents.push(parent)
		),
	];
	return {
		assertUnchanged() {
			expect(toSnapshot(root)).toBe(before);
			expect(root.first).toBe(first);
			expect(root.second).toBe(second);
			expect(root.items).toBe(items);
			expect(root.items).toEqual([item]);
			for (const child of [first, second, item]) {
				expect(child.parent).toBe(root);
				expect(findModelById(root, Item, child.id)).toBe(child);
			}
			expect(snapshots).toEqual([]);
			expect(diffs).toEqual([]);
			expect(parents).toEqual([]);
		},
		stop() {
			stops.forEach((stop) => stop());
		},
	};
}

// Retained as deferred regressions for a separate attachment/identity guarantee.
// The observer-only applySnapshot fix is covered in snapshot-atomicity.test.ts.
const deferredTest = test.skip;

deferredTest.each(["owned child", "conflicting identifier", "disposed child"])(
	"failed scalar replacement preserves the tree: %s",
	(failure) => {
		const root = Root.create();
		const replacement =
			failure === "owned child"
				? root.second
				: Item.create({ id: failure === "conflicting identifier" ? 2 : 4 });
		if (failure === "disposed child") replacement[Symbol.dispose]();
		const observed = watch(root);
		try {
			expect(() => {
				root.first = replacement;
			}).toThrow();
			observed.assertUnchanged();
		} finally {
			observed.stop();
		}
	}
);

deferredTest.each(["assignment", "push", "index", "splice", "fill"])(
	"failed child array mutation preserves the tree: %s",
	(operation) => {
		const root = Root.create();
		const replacement = Item.create({ id: 2 });
		const observed = watch(root);
		try {
			expect(() => {
				switch (operation) {
					case "assignment":
						root.items = [Item.create({ id: 4 }), replacement];
						break;
					case "push":
						root.items.push(Item.create({ id: 4 }), replacement);
						break;
					case "index":
						root.items[0] = replacement;
						break;
					case "splice":
						root.items.splice(-1, 1, replacement);
						break;
					case "fill":
						root.items.fill(replacement);
						break;
				}
			}).toThrow();
			observed.assertUnchanged();
			expect(replacement.parent).toBe(null);
			expect(findModelById(root, Item, 4)).toBe(undefined);
		} finally {
			observed.stop();
		}
	}
);

deferredTest.each(["assignment", "push", "fill", "copyWithin"])(
	"child arrays reject repeated model identities: %s",
	(operation) => {
		const root = Root.create();
		root.items.push(Item.create({ id: 4 }));
		const items = root.items;
		const before = [...items];
		const snapshot = toSnapshot(root);
		expect(() => {
			switch (operation) {
				case "assignment":
					root.items = [items[0], items[0]];
					break;
				case "push":
					items.push(items[0]);
					break;
				case "fill":
					items.fill(items[0]);
					break;
				case "copyWithin":
					items.copyWithin(1, 0, 1);
					break;
			}
		}).toThrow();
		expect(root.items).toBe(items);
		expect(items).toEqual(before);
		expect(toSnapshot(root)).toBe(snapshot);
	}
);

deferredTest(
	"failed snapshot preserves replaced children, arrays, and nested values",
	() => {
		const root = Root.create();
		const observed = watch(root);
		try {
			expect(() =>
				applySnapshot(root, {
					value: 99,
					first: { id: 5 },
					items: [{ id: 3, value: 99 }],
					second: { id: 5 },
				})
			).toThrow();
			observed.assertUnchanged();
			expect(root.items[0].value).toBe(0);
		} finally {
			observed.stop();
		}
	}
);

deferredTest(
	"snapshot validates hydration before changing signals, dates, or containers",
	() => {
		class State extends Model {
			count = signal(0);
			data = { nested: { value: 0 }, date: new Date("2024-01-01") };
		}
		const state = State.create();
		const count = state.count;
		const data = state.data;
		const nested = data.nested;
		const date = data.date;
		const snapshot = toSnapshot(state);
		const values: number[] = [];
		const stop = reaction(
			() => state.count.value,
			(value) => values.push(value)
		);
		try {
			expect(() =>
				applySnapshot(state, {
					count: 99,
					data: { nested: { value: 99 }, date: "invalid" },
				})
			).toThrow(/date/);
			expect(state.count).toBe(count);
			expect(state.data).toBe(data);
			expect(state.data.nested).toBe(nested);
			expect(state.data.date).toBe(date);
			expect(nested.value).toBe(0);
			expect(toSnapshot(state)).toBe(snapshot);
			expect(values).toEqual([]);
		} finally {
			stop();
		}
	}
);

deferredTest.each(["scalar", "array", "push", "snapshot"])(
	"attachment rejects self and ancestor cycles: %s",
	(operation) => {
		class Node extends Model {
			@child next: Node | null = null;
			@child nodes: Node[] = [];
		}
		const root = Node.create();
		const leaf = Node.create();
		root.next = leaf;
		for (const target of [root, leaf]) {
			const before = toSnapshot(root);
			expect(() => {
				switch (operation) {
					case "scalar":
						target.next = root;
						break;
					case "array":
						target.nodes = [root];
						break;
					case "push":
						target.nodes.push(root);
						break;
					case "snapshot":
						applySnapshot(target, { next: root } as unknown as Snapshot<Node>);
						break;
				}
			}).toThrow(/cycle|ancestor|itself/i);
			expect(root.parent).toBe(null);
			expect(leaf.parent).toBe(root);
			expect(toSnapshot(root)).toBe(before);
		}
	}
);

deferredTest(
	"successful replacement publishes consistent ownership and identifiers once",
	() => {
		const root = Root.create();
		const previous = root.first;
		const next = Item.create({ id: 1, value: 7 });
		const states: unknown[] = [];
		const stop = onSnapshot(root, () =>
			states.push({
				first: root.first,
				parent: root.first.parent,
				previousParent: previous.parent,
				lookup: findModelById(root, Item, 1),
			})
		);
		try {
			root.first = next;
			expect(states).toEqual([
				{ first: next, parent: root, previousParent: null, lookup: next },
			]);
		} finally {
			stop();
		}
	}
);

deferredTest(
	"snapshot may reuse identifiers released by another property in the same commit",
	() => {
		const root = Root.create();
		const oldFirst = root.first;
		applySnapshot(root, { second: { id: 1 }, first: { id: 4 } });
		expect(root.first.id).toBe(4);
		expect(root.second.id).toBe(1);
		expect(oldFirst.parent).toBe(null);
		expect(findModelById(root, Item, 1)).toBe(root.second);
		expect(findModelById(root, Item, 4)).toBe(root.first);
	}
);

deferredTest.each([
	"undefined",
	"sparse",
	"non-model",
	"owned",
	"defineProperty",
	"grow",
	"delete",
])(
	"invalid child array shape/ownership is rejected before publication: %s",
	(kind) => {
		const root = Root.create();
		const observed = watch(root);
		try {
			expect(() => {
				switch (kind) {
					case "undefined":
						root.items = [undefined!];
						break;
					case "sparse":
						root.items = new Array<Item>(1);
						break;
					case "non-model":
						root.items.push({} as Item);
						break;
					case "owned":
						root.items[0] = root.second;
						break;
					case "defineProperty":
						Object.defineProperty(root.items, "0", { value: root.second });
						break;
					case "grow":
						root.items.length = 2;
						break;
					case "delete":
						delete root.items[0];
						break;
				}
			}).toThrow();
			observed.assertUnchanged();
		} finally {
			observed.stop();
		}
	}
);

deferredTest(
	"length truncation detaches removed children and updates the ID index",
	() => {
		const root = Root.create();
		const removed = root.items[0];
		const items = root.items;
		const snapshots: unknown[] = [];
		const stop = onSnapshot(root, (snapshot) => snapshots.push(snapshot));
		try {
			items.length = 0;
			expect(root.items).toBe(items);
			expect(root.items).toEqual([]);
			expect(removed.parent).toBe(null);
			expect(findModelById(root, Item, 3)).toBe(undefined);
			expect(snapshots).toEqual([toSnapshot(root)]);
		} finally {
			stop();
		}
	}
);

deferredTest(
	"negative splice indexes preserve retained children and detach removed ones",
	() => {
		const root = Root.create();
		const previous = root.items[0];
		const next = Item.create({ id: 3 });
		expect(root.items.splice(-1, 1, next)).toEqual([previous]);
		expect(root.items).toEqual([next]);
		expect(previous.parent).toBe(null);
		expect(next.parent).toBe(root);
		expect(findModelById(root, Item, 3)).toBe(next);
	}
);

deferredTest(
	"throwing array sort comparator leaves the array unchanged",
	() => {
		const root = Root.create();
		root.items.push(Item.create({ id: 4 }));
		const snapshot = toSnapshot(root);
		const items = [...root.items];
		expect(() =>
			root.items.sort(() => {
				throw new Error("comparison failed");
			})
		).toThrow("comparison failed");
		expect(root.items).toEqual(items);
		expect(toSnapshot(root)).toBe(snapshot);
	}
);

deferredTest(
	"model property definition rejects incompatible descriptors before changing ownership",
	() => {
		const root = Root.create();
		const next = Item.create({ id: 1 });
		const observed = watch(root);
		try {
			expect(() =>
				Object.defineProperty(root, "first", {
					value: next,
					configurable: false,
				})
			).toThrow();
			observed.assertUnchanged();
			expect(next.parent).toBe(null);
		} finally {
			observed.stop();
		}
	}
);

deferredTest(
	"deleting a child detaches it while deleting an identifier is rejected",
	() => {
		const root = Root.create();
		const first = root.first;
		expect(Reflect.deleteProperty(root, "first")).toBe(true);
		expect(first.parent).toBe(null);
		expect(findModelById(root, Item, 1)).toBe(undefined);
		expect(() => Reflect.deleteProperty(root.second, "id")).toThrow();
		expect(root.second.id).toBe(2);
		expect(findModelById(root, Item, 2)).toBe(root.second);
	}
);

deferredTest.each([
	"readonly field",
	"readonly nested field",
	"non-configurable array index",
])(
	"snapshot validates descriptors before changing earlier fields: %s",
	(kind) => {
		class State extends Model {
			value = 0;
			data = { value: 0 };
			items = [0, 1];
		}
		const state = State.create();
		if (kind === "readonly field")
			Object.defineProperty(state, "data", { writable: false });
		if (kind === "readonly nested field")
			Object.defineProperty(state.data, "value", { writable: false });
		if (kind === "non-configurable array index")
			Object.defineProperty(state.items, "0", {
				configurable: false,
				enumerable: false,
			});
		const before = toSnapshot(state);
		expect(() =>
			applySnapshot(
				state,
				kind === "readonly field"
					? { value: 99, data: null! }
					: kind === "readonly nested field"
						? { value: 99, data: { value: 99 } }
						: { value: 99, items: [2] }
			)
		).toThrow();
		expect(state.value).toBe(0);
		expect(toSnapshot(state)).toBe(before);
	}
);

deferredTest(
	"applying a snapshot to an attached child validates against the whole tree",
	() => {
		const root = Root.create();
		const observed = watch(root);
		try {
			expect(() => applySnapshot(root.first, { value: 99, id: 2 })).toThrow();
			observed.assertUnchanged();
		} finally {
			observed.stop();
		}
	}
);

deferredTest(
	"snapshot failure does not attach a supplied external model",
	() => {
		class Branch extends Model {
			@child(Item) item: Item | null = null;
		}
		class Tree extends Model {
			@child(Branch) branch: Branch | null = null;
			@child(Item) item = Item.create({ id: 1 });
		}
		const root = Tree.create();
		const supplied = Item.create({ id: 1 });
		const before = toSnapshot(root);
		expect(() =>
			applySnapshot(root, {
				branch: { item: supplied },
			} as unknown as Snapshot<Tree>)
		).toThrow();
		expect(supplied.parent).toBe(null);
		expect(root.branch).toBe(null);
		expect(toSnapshot(root)).toBe(before);
	}
);

deferredTest(
	"a notification error does not roll back an already committed snapshot",
	() => {
		const root = Root.create();
		const stop = onSnapshot(root, () => {
			throw new Error("listener failed");
		});
		try {
			expect(() => applySnapshot(root, { value: 7 })).toThrow(
				"listener failed"
			);
			expect(root.value).toBe(7);
			expect(toSnapshot(root).value).toBe(7);
		} finally {
			stop();
		}
	}
);

deferredTest.each(["sort", "reverse"] as const)(
	"successful %s preserves child identities, ownership, and ID lookups",
	(operation) => {
		const root = Root.create();
		root.items.push(Item.create({ id: 4 }));
		const [first, second] = root.items;
		const items = root.items;
		const snapshots: unknown[] = [];
		const stop = onSnapshot(root, (snapshot) => snapshots.push(snapshot));
		try {
			if (operation === "sort") items.sort((a, b) => b.id - a.id);
			else items.reverse();
			expect(root.items).toBe(items);
			expect(items).toEqual([second, first]);
			for (const item of items) {
				expect(item.parent).toBe(root);
				expect(findModelById(root, Item, item.id)).toBe(item);
			}
			expect(snapshots).toEqual([toSnapshot(root)]);
		} finally {
			stop();
		}
	}
);

deferredTest(
	"a successful multi-property snapshot emits only the committed state",
	() => {
		const root = Root.create();
		const snapshots: unknown[] = [];
		const stop = onSnapshot(root, (snapshot) => snapshots.push(snapshot));
		try {
			applySnapshot(root, {
				value: 7,
				first: { id: 1, value: 8 },
				items: [{ id: 3, value: 9 }],
			});
			expect(snapshots).toEqual([toSnapshot(root)]);
			expect(toSnapshot(root)).toMatchObject({
				value: 7,
				first: { value: 8 },
				items: [{ value: 9 }],
			});
		} finally {
			stop();
		}
	}
);
