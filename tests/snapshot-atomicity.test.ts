import {
	Model,
	applySnapshot,
	batch,
	child,
	effect,
	id,
	onSnapshot,
	onSnapshotDiff,
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
