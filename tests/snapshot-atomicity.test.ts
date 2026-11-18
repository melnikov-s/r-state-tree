import {
	Model,
	applySnapshot,
	batch,
	child,
	effect,
	findModelById,
	id,
	modelRef,
	observable,
	onSnapshot,
	onSnapshotDiff,
	signal,
	toSnapshot,
} from "../src/index";

class Item extends Model {
	@id id!: number;
	value = 0;
}

class Root extends Model {
	value = 0;
	@child(Item) first: Item[] = [];
	@child(Item) second: Item[] = [];
}

function failSnapshot(root: Root): void {
	expect(() =>
		applySnapshot(root, {
			value: 99,
			first: [{ id: 1 }],
			second: [{ id: 1 }],
		})
	).toThrow("already assigned");
}

test("failed snapshot does not emit snapshots or diffs, or expose failed values to effects", () => {
	const root = Root.create();
	const snapshots: unknown[] = [];
	const diffs: unknown[] = [];
	const values: number[] = [];
	const stops = [
		onSnapshot(root, (snapshot) => snapshots.push(snapshot)),
		onSnapshotDiff(root, (diff) => diffs.push(diff)),
		effect(() => {
			values.push(root.value);
		}),
	];
	try {
		failSnapshot(root);
		expect(root.value).toBe(0);
		expect(snapshots).toEqual([]);
		expect(diffs).toEqual([]);
		expect(values.length).toBeGreaterThan(0);
		expect(values.every((value) => value === 0)).toBe(true);
	} finally {
		stops.forEach((stop) => stop());
	}
});

test.each(["alone", "before valid change", "after valid change"])(
	"failed snapshot inside an outer batch: %s",
	(order) => {
		const root = Root.create();
		const values: number[] = [];
		const stop = onSnapshot(root, (snapshot) => values.push(snapshot.value!));
		try {
			batch(() => {
				if (order === "after valid change") root.value = 7;
				failSnapshot(root);
				if (order === "before valid change") root.value = 7;
			});
			expect(values).toEqual(order === "alone" ? [] : [7]);
		} finally {
			stop();
		}
	}
);

test("a successful retry emits one snapshot and a diff against the last committed state", () => {
	class State extends Model {
		value = 0;
		date = new Date("2024-01-01");
	}
	const state = State.create();
	const snapshots: unknown[] = [];
	const diffs: unknown[] = [];
	const stops = [
		onSnapshot(state, (snapshot) => snapshots.push(snapshot)),
		onSnapshotDiff(state, (diff) => diffs.push(diff)),
	];
	try {
		expect(() => applySnapshot(state, { value: 99, date: "invalid" })).toThrow(
			/date/
		);
		expect(snapshots).toEqual([]);
		expect(diffs).toEqual([]);
		applySnapshot(state, { value: 7 });
		expect(snapshots).toEqual([toSnapshot(state)]);
		expect(diffs).toEqual([{ undo: { value: 0 }, redo: { value: 7 } }]);
	} finally {
		stops.forEach((stop) => stop());
	}
});

test("a rejected first ID assignment restores the field and the ancestor index", () => {
	class State extends Model {
		n = 0;
		@id id?: number;
		date = new Date("2024-01-01");
	}
	class Tree extends Model {
		@child(State) state = State.create();
		@modelRef(State) selected?: State;
	}
	const root = Tree.create({ selected: { id: 42 } });
	const { state } = root;
	const before = toSnapshot(root);
	const snapshots: unknown[] = [];
	const diffs: unknown[] = [];
	const observed: [number, number | undefined, State | undefined][] = [];
	const stops = [
		onSnapshot(root, (snapshot) => snapshots.push(snapshot)),
		onSnapshotDiff(state, (diff) => diffs.push(diff)),
		effect(() => {
			observed.push([state.n, state.id, root.selected]);
		}),
	];
	try {
		expect(() =>
			applySnapshot(state, { n: 99, id: 42, date: "invalid" })
		).toThrow('invalid ISO date string in snapshot: "invalid"');
		expect(state.id).toBeUndefined();
		expect(state.n).toBe(0);
		expect(root.state).toBe(state);
		expect(state.parent).toBe(root);
		expect(findModelById(root, State, 42)).toBeUndefined();
		expect(toSnapshot(root)).toEqual(before);
		expect(snapshots).toEqual([]);
		expect(diffs).toEqual([]);
		expect(observed).not.toHaveLength(0);
		expect(
			observed.every(
				([n, currentId, selected]) =>
					n === 0 && currentId === undefined && selected === undefined
			)
		).toBe(true);

		state.id = 42;
		expect(() => {
			state.id = undefined;
		}).toThrow("can't clear an id");
		expect(root.selected).toBe(state);
		expect(findModelById(root, State, 42)).toBe(state);
		expect(snapshots).toEqual([toSnapshot(root)]);
		expect(diffs).toEqual([{ undo: { id: undefined }, redo: { id: 42 } }]);
	} finally {
		stops.forEach((stop) => stop());
	}
});

test("rollback releases newly occupied IDs before restoring replaced children", () => {
	class Tree extends Model {
		@child(Item) scalar = Item.create({ id: 3 });
		@child(Item) first = [Item.create({ id: 1, value: 5 })];
		@child(Item) second: Item[] = [];
		@modelRef(Item) selected?: Item;
		date = new Date("2024-01-01");
	}
	const root = Tree.create({ selected: { id: 1 } });
	const before = toSnapshot(root);
	const snapshots: unknown[] = [];
	const stop = onSnapshot(root, (snapshot) => snapshots.push(snapshot));
	try {
		expect(() =>
			applySnapshot(root, {
				scalar: { id: 2 },
				first: [],
				second: [{ id: 1, value: 99 }],
				selected: { id: 2 },
				date: "invalid",
			})
		).toThrow('invalid ISO date string in snapshot: "invalid"');
		// Check restored state and its live index, not child/proxy identity.
		expect(toSnapshot(root)).toEqual(before);
		expect(root.first[0].parent).toBe(root);
		expect(findModelById(root, Item, 1)).toBe(root.first[0]);
		expect(root.selected).toBe(root.first[0]);
		expect(findModelById(root, Item, 2)).toBeUndefined();
		expect(findModelById(root, Item, 3)).toBe(root.scalar);
		expect(root.scalar.parent).toBe(root);
		expect(snapshots).toEqual([]);
	} finally {
		stop();
	}
});

test("rollback restores partially hydrated observable containers, Signals and Dates", () => {
	class State extends Model {
		detail = observable({
			count: signal(1),
			items: observable([4, 5]),
			optional: new Date("2024-01-01") as Date | null,
			start: new Date("2024-01-02"),
			end: new Date("2024-01-03"),
		});
	}
	const state = State.create();
	const before = toSnapshot(state);
	const { count, items, optional, start, end } = state.detail;
	const snapshots: unknown[] = [];
	const stop = onSnapshot(state, (snapshot) => snapshots.push(snapshot));
	try {
		expect(() =>
			applySnapshot(state, {
				detail: {
					count: 2,
					items: [9],
					optional: null,
					start: "2025-01-01",
					end: "invalid",
				},
			})
		).toThrow('invalid ISO date string in snapshot: "invalid"');
		expect(toSnapshot(state)).toEqual(before);
		expect(state.detail.count).toBe(count);
		expect(state.detail.items).toBe(items);
		expect(state.detail.optional).toBe(optional);
		expect(state.detail.start).toBe(start);
		expect(state.detail.end).toBe(end);
		expect(snapshots).toEqual([]);
	} finally {
		stop();
	}
});

test("a reaction error while flushing rollback does not replace the load error", () => {
	class State extends Model {
		@child(Item) items: Item[] = [];
		date = new Date("2024-01-01");
	}
	const state = State.create();
	const observed: number[] = [];
	const stop = effect(() => {
		observed.push(state.items.length);
		if (observed.length > 1) throw new Error("effect failed");
	});
	try {
		expect(() =>
			applySnapshot(state, { items: [{ id: 1 }], date: "invalid" })
		).toThrow('invalid ISO date string in snapshot: "invalid"');
		// A child-array reference can change after rollback, but effects still
		// see only the restored contents.
		expect(observed).toEqual([0, 0]);
	} finally {
		stop();
	}
});

test("rollback suppresses equivalent snapshots of retained children and their root", () => {
	const root = Root.create();
	root.first = [Item.create({ id: 1 })];
	const item = root.first[0];
	const snapshots: unknown[] = [];
	const stops = [
		onSnapshot(root, (snapshot) => snapshots.push(snapshot)),
		onSnapshot(item, (snapshot) => snapshots.push(snapshot)),
	];
	try {
		expect(() =>
			applySnapshot(root, {
				first: [{ id: 1, value: 99 }],
				second: [{ id: 1 }],
			})
		).toThrow("already assigned");
		expect(item.value).toBe(0);
		expect(snapshots).toEqual([]);
	} finally {
		stops.forEach((stop) => stop());
	}
});

test("a rollback does not suppress a valid notification in an unrelated tree", () => {
	const root = Root.create();
	const other = Root.create();
	const values: number[] = [];
	const stop = onSnapshot(other, (snapshot) => values.push(snapshot.value!));
	try {
		batch(() => {
			failSnapshot(root);
			other.value = 7;
		});
		expect(values).toEqual([7]);
	} finally {
		stop();
	}
});

test("rollback snapshot comparison preserves undefined and non-finite values", () => {
	class State extends Model {
		values = [undefined, NaN, Infinity, -Infinity, -0];
		date = new Date("2024-01-01");
	}
	const state = State.create();
	const snapshots: unknown[] = [];
	const stop = onSnapshot(state, (snapshot) => snapshots.push(snapshot));
	try {
		expect(() =>
			applySnapshot(state, { values: [99], date: "invalid" })
		).toThrow(/date/);
		expect(snapshots).toEqual([]);
		expect(toSnapshot(state).values).toEqual([
			undefined,
			NaN,
			Infinity,
			-Infinity,
			-0,
		]);
	} finally {
		stop();
	}
});

test("successful snapshot application emits only the completed state", () => {
	const root = Root.create();
	const snapshots: unknown[] = [];
	const stop = onSnapshot(root, (snapshot) => snapshots.push(snapshot));
	try {
		applySnapshot(root, { value: 7, first: [{ id: 1, value: 8 }] });
		expect(snapshots).toEqual([toSnapshot(root)]);
	} finally {
		stop();
	}
});

test("listener errors propagate without rolling back a committed snapshot", () => {
	const root = Root.create();
	const stop = onSnapshot(root, () => {
		throw new Error("listener failed");
	});
	try {
		expect(() => applySnapshot(root, { value: 7 })).toThrow("listener failed");
		expect(root.value).toBe(7);
	} finally {
		stop();
	}
});
