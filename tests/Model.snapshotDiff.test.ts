import {
	Model,
	applySnapshot,
	batch,
	child,
	id,
	modelRef,
	observable,
	onSnapshotDiff,
	signal,
	toSnapshot,
} from "../src/index";
import type { Snapshot, SnapshotDiff } from "../src/index";

describe.each([true, false])(
	"snapshot diff round trips (identified: %s)",
	(identified) => {
		class Leaf extends Model {
			value = 0;
			label = "default";
		}

		class Item extends Model {
			// Exercise a custom identifier key, including the valid identifier zero.
			static types: NonNullable<typeof Model.types> = identified
				? { key: id }
				: {};
			key = 0;
			value = 0;
			label = "default";
			@child(Leaf) nested: Leaf | null = null;
		}

		class Root extends Model {
			unchanged = "persisted";
			@child(Item) items: Item | Item[] | null = [];
			@child(Item) selected: Item | null = null;
		}

		const item = (key: number) => ({
			key,
			value: 10,
			label: "persisted",
			nested: { value: 20, label: "persisted nested value" },
		});
		const a = item(0);
		const b = item(1);
		const c = item(2);

		type Case = {
			name: string;
			before: Snapshot<Root>;
			after: Snapshot<Root>;
		};

		const cases: Case[] = [
			{
				name: "delete first child",
				before: { items: [a, b] },
				after: { items: [b] },
			},
			{
				name: "delete middle child",
				before: { items: [a, b, c] },
				after: { items: [a, c] },
			},
			{
				name: "delete last child",
				before: { items: [a, b] },
				after: { items: [a] },
			},
			{
				name: "delete all children",
				before: { items: [a, b] },
				after: { items: [] },
			},
			{
				name: "insert first child",
				before: { items: [b] },
				after: { items: [a, b] },
			},
			{
				name: "insert middle child",
				before: { items: [a, c] },
				after: { items: [a, b, c] },
			},
			{
				name: "insert last child",
				before: { items: [a] },
				after: { items: [a, b] },
			},
			{
				name: "insert into empty array",
				before: { items: [] },
				after: { items: [a, b] },
			},
			{
				name: "reorder children",
				before: { items: [a, b, c] },
				after: { items: [c, a, b] },
			},
			{
				name: "replace array child",
				before: { items: [a, b] },
				after: { items: [c, b] },
			},
			{
				name: "single child to array",
				before: { items: a },
				after: { items: [b, a] },
			},
			{
				name: "array to single child",
				before: { items: [b, a] },
				after: { items: a },
			},
			{
				name: "null to array",
				before: { items: null },
				after: { items: [a, b] },
			},
			{
				name: "array to null",
				before: { items: [a, b] },
				after: { items: null },
			},
			{
				name: "null to single child",
				before: { selected: null },
				after: { selected: a },
			},
			{
				name: "single child to null",
				before: { selected: a },
				after: { selected: null },
			},
			{
				name: "replace single child",
				before: { selected: a },
				after: { selected: b },
			},
			{
				name: "change array child with unchanged sibling",
				before: { items: [a, b] },
				after: { items: [{ ...a, value: 99 }, b] },
			},
			{
				name: "change single child without changing its identifier",
				before: { selected: a },
				after: { selected: { ...a, value: 99 } },
			},
			{
				name: "change nested child in array",
				before: { items: [a, b] },
				after: { items: [{ ...a, nested: { ...a.nested, value: 99 } }, b] },
			},
			{
				name: "change nested single child",
				before: { selected: a },
				after: { selected: { ...a, nested: { ...a.nested, value: 99 } } },
			},
			{
				name: "nested child to null",
				before: { selected: a },
				after: { selected: { ...a, nested: null } },
			},
			{
				name: "nested null to child",
				before: { selected: { ...a, nested: null } },
				after: { selected: a },
			},
		];

		test.each(cases)("$name", ({ before, after }) => {
			const root = Root.create(before);
			const beforeSnapshot = structuredClone(toSnapshot(root));
			const diffs: SnapshotDiff<Root>[] = [];
			const stop = onSnapshotDiff(root, (diff) => diffs.push(diff));

			applySnapshot(root, after);
			const afterSnapshot = structuredClone(toSnapshot(root));
			stop();

			expect(diffs).toHaveLength(1);
			const { undo, redo } = diffs[0];
			// Verify repeatability on the original tree and independence from any
			// detached instances retained by the mutation that produced the diff.
			for (const target of [root, Root.create(afterSnapshot)]) {
				for (let cycle = 0; cycle < 2; cycle++) {
					applySnapshot(target, structuredClone(undo));
					expect(toSnapshot(target)).toStrictEqual(beforeSnapshot);
					applySnapshot(target, structuredClone(redo));
					expect(toSnapshot(target)).toStrictEqual(afterSnapshot);
				}
			}

			const field = "items" in after ? "items" : "selected";
			expect(Object.keys(undo)).toEqual([field]);
			expect(Object.keys(redo)).toEqual([field]);
			if (!identified) {
				// Without identifiers, do not assume positional identity. Replay
				// must have complete data even when hydration recreates children.
				expect(undo).toStrictEqual({ [field]: beforeSnapshot[field] });
				expect(redo).toStrictEqual({ [field]: afterSnapshot[field] });
			}
		});
	}
);

test("repeating a cleared model ref produces no diff; a subsequent change still does", () => {
	class Item extends Model {
		@id id = 1;
	}
	class Root extends Model {
		@child(Item) items: Item[] = [Item.create()];
		@modelRef(Item) selected: Item | undefined = undefined;
	}
	const root = Root.create();
	const listener = vi.fn();
	const stop = onSnapshotDiff(root, listener);

	root.selected = undefined;
	expect(listener).not.toHaveBeenCalled();

	root.selected = root.items[0];
	expect(listener).toHaveBeenCalledExactlyOnceWith(
		{ undo: { selected: null }, redo: { selected: { id: 1 } } },
		root
	);
	stop();
});

test("child edits omit unchanged ordinary snapshot values, including Date and Signal contents", () => {
	class Item extends Model {
		@id id = 1;
		count = 0;
		tags = ["saved"];
		details = { values: [NaN, undefined], date: new Date(0) };
		settings = signal(observable({ enabled: false }));
	}
	class Root extends Model {
		@child(Item) items: Item[] = [Item.create()];
	}
	const root = Root.create();
	const item = root.items[0];
	const history: SnapshotDiff<Root>[] = [];
	const stop = onSnapshotDiff(root, (diff) => history.push(diff));

	item.count = 1;
	item.settings.value.enabled = true;
	stop();

	expect(history).toStrictEqual([
		{
			undo: { items: [{ id: 1, count: 0 }] },
			redo: { items: [{ id: 1, count: 1 }] },
		},
		{
			undo: { items: [{ id: 1, settings: { enabled: false } }] },
			redo: { items: [{ id: 1, settings: { enabled: true } }] },
		},
	]);
	const edit = history[history.length - 1];
	applySnapshot(root, edit.undo);
	expect(item.settings.value.enabled).toBe(false);
	applySnapshot(root, edit.redo);
	expect(item.settings.value.enabled).toBe(true);
	expect(history).toHaveLength(2);
});

test.each([true, false])(
	"an equal child snapshot does not produce a diff (identified: %s)",
	(identified) => {
		class Item extends Model {
			static types: NonNullable<typeof Model.types> = identified
				? { key: id }
				: {};
			key = 1;
			count = 0;
			data = { numbers: [1, 2] };
		}
		class Root extends Model {
			@child(Item) items: Item[] = [Item.create()];
			@child(Item) selected = Item.create({ key: 2 });
		}
		const root = Root.create();
		const diff = vi.fn();
		const stop = onSnapshotDiff(root, diff);

		root.items[0].data = { numbers: [1, 2] };
		root.items = Array.from(root.items);
		root.selected.data = { numbers: [1, 2] };
		expect(diff).not.toHaveBeenCalled();

		root.items[0].count++;
		expect(diff).toHaveBeenCalledOnce();
		expect(diff.mock.calls[0][0].redo).not.toHaveProperty("selected");
		stop();
	}
);

test("a recorded batch replays both ways without appending to history", () => {
	class Todo extends Model {
		title = "Old title";
		completed = false;
	}
	const todo = Todo.create();
	const history: SnapshotDiff<Todo>[] = [];
	const stop = onSnapshotDiff(todo, (diff) => history.push(diff));

	batch(() => {
		todo.title = "New title";
		todo.completed = true;
	});
	const edit = history[history.length - 1];
	stop();

	applySnapshot(todo, edit.undo);
	expect(toSnapshot(todo)).toStrictEqual({
		title: "Old title",
		completed: false,
	});
	applySnapshot(todo, edit.redo);
	expect(toSnapshot(todo)).toStrictEqual({
		title: "New title",
		completed: true,
	});
	expect(history).toHaveLength(1);
});

test("undoing an in-place deletion restores the removed child's persisted value", () => {
	class Item extends Model {
		@id id = 0;
		value = 0;
	}
	class Root extends Model {
		@child(Item) items: Item[] = [];
	}

	const root = Root.create({
		items: [
			{ id: 1, value: 10 },
			{ id: 2, value: 10 },
		],
	});
	const before = structuredClone(toSnapshot(root));
	const survivingChild = root.items[1];
	const diffs: SnapshotDiff<Root>[] = [];
	const stop = onSnapshotDiff(root, (diff) => diffs.push(diff));

	root.items.splice(0, 1);
	const after = structuredClone(toSnapshot(root));
	stop();

	expect(diffs).toStrictEqual([
		{
			undo: { items: [{ id: 1, value: 10 }, { id: 2 }] },
			redo: { items: [{ id: 2 }] },
		},
	]);
	applySnapshot(root, diffs[0].undo);
	expect(toSnapshot(root)).toStrictEqual(before);
	expect(root.items[0].value).toBe(10);
	expect(root.items[1]).toBe(survivingChild);
	applySnapshot(root, diffs[0].redo);
	expect(toSnapshot(root)).toStrictEqual(after);
	expect(root.items[0]).toBe(survivingChild);
});

describe("compact identity-aware snapshot diffs", () => {
	class Leaf extends Model {
		@id key = "";
		value = 0;
		label = "default";
	}
	class Item extends Model {
		@id key: string | number = 0;
		value = 0;
		label = "default";
		@child(Leaf) leaf: Leaf | null = null;
	}
	class Root extends Model {
		unchanged = "persisted";
		@child(Item) items: Item[] = [];
		@child(Item) selected: Item | null = null;
	}

	const a = {
		key: 0,
		value: 10,
		label: "persisted item",
		leaf: { key: "leaf-a", value: 20, label: "persisted leaf" },
	};
	const b = { ...a, key: "", leaf: { ...a.leaf, key: "leaf-b" } };
	const c = { ...a, key: 2, leaf: { ...a.leaf, key: "leaf-c" } };
	const newLeaf = { key: "new-leaf", value: 30, label: "new persisted leaf" };

	const cases: {
		name: string;
		before: Snapshot<Root>;
		after: Snapshot<Root>;
		expected: SnapshotDiff<Root>;
	}[] = [
		{
			name: "insertion includes only the new child in full",
			before: { items: [b] },
			after: { items: [a, b] },
			expected: {
				undo: { items: [{ key: "" }] },
				redo: { items: [a, { key: "" }] },
			},
		},
		{
			name: "deletion includes only the removed child in full",
			before: { items: [a, b, c] },
			after: { items: [a, c] },
			expected: {
				undo: { items: [{ key: 0 }, b, { key: 2 }] },
				redo: { items: [{ key: 0 }, { key: 2 }] },
			},
		},
		{
			name: "reordering contains identifiers only",
			before: { items: [a, b, c] },
			after: { items: [c, a, b] },
			expected: {
				undo: { items: [{ key: 0 }, { key: "" }, { key: 2 }] },
				redo: { items: [{ key: 2 }, { key: 0 }, { key: "" }] },
			},
		},
		{
			name: "replacement preserves only the replaced children in full",
			before: { items: [a, b] },
			after: { items: [c, b] },
			expected: {
				undo: { items: [a, { key: "" }] },
				redo: { items: [c, { key: "" }] },
			},
		},
		{
			name: "array value edits omit unchanged fields and sibling data",
			before: { items: [a, b] },
			after: { items: [{ ...a, value: 99 }, b] },
			expected: {
				undo: { items: [{ key: 0, value: 10 }, { key: "" }] },
				redo: { items: [{ key: 0, value: 99 }, { key: "" }] },
			},
		},
		{
			name: "deletion and a shifted survivor edit match by identity",
			before: { items: [a, b] },
			after: { items: [{ ...b, value: 99 }] },
			expected: {
				undo: { items: [a, { key: "", value: 10 }] },
				redo: { items: [{ key: "", value: 99 }] },
			},
		},
		{
			name: "single child edits retain identity without copying its subtree",
			before: { selected: a },
			after: { selected: { ...a, value: 99 } },
			expected: {
				undo: { selected: { key: 0, value: 10 } },
				redo: { selected: { key: 0, value: 99 } },
			},
		},
		{
			name: "nested edits are recursively compact",
			before: { selected: a },
			after: { selected: { ...a, leaf: { ...a.leaf, value: 99 } } },
			expected: {
				undo: { selected: { key: 0, leaf: { key: "leaf-a", value: 20 } } },
				redo: { selected: { key: 0, leaf: { key: "leaf-a", value: 99 } } },
			},
		},
		{
			name: "nested replacement includes the leaf, not the whole parent",
			before: { selected: a },
			after: { selected: { ...a, leaf: newLeaf } },
			expected: {
				undo: { selected: { key: 0, leaf: a.leaf } },
				redo: { selected: { key: 0, leaf: newLeaf } },
			},
		},
		{
			name: "nested removal includes the leaf, not the whole parent",
			before: { selected: a },
			after: { selected: { ...a, leaf: null } },
			expected: {
				undo: { selected: { key: 0, leaf: a.leaf } },
				redo: { selected: { key: 0, leaf: null } },
			},
		},
		{
			name: "identifier changes preserve all data needed for recreation",
			before: { selected: a },
			after: { selected: { ...a, key: "renamed" } },
			expected: {
				undo: { selected: a },
				redo: { selected: { ...a, key: "renamed" } },
			},
		},
	];

	test.each(cases)("$name", ({ before, after, expected }) => {
		const root = Root.create(before);
		const beforeSnapshot = structuredClone(toSnapshot(root));
		const diffs: SnapshotDiff<Root>[] = [];
		const stop = onSnapshotDiff(root, (diff) => diffs.push(diff));
		applySnapshot(root, after);
		const afterSnapshot = structuredClone(toSnapshot(root));
		stop();

		// Exact shapes ensure that unchanged fields/subtrees cannot silently
		// creep back into otherwise correct but oversized undo/redo payloads.
		expect(diffs).toStrictEqual([expected]);
		for (const target of [root, Root.create(afterSnapshot)]) {
			for (let cycle = 0; cycle < 2; cycle++) {
				applySnapshot(target, structuredClone(diffs[0].undo));
				expect(toSnapshot(target)).toStrictEqual(beforeSnapshot);
				applySnapshot(target, structuredClone(diffs[0].redo));
				expect(toSnapshot(target)).toStrictEqual(afterSnapshot);
			}
		}
	});
});
