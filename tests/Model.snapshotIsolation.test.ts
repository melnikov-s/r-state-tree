import { Model, applySnapshot, toSnapshot } from "../src/index";

class State extends Model {
	items: { values: number[] }[] = [];
	preferences: { list: { selected: boolean }[] } | null = null;
}

test("forking and hydrating a Model never shares mutable snapshot containers", () => {
	const initial = {
		items: [{ values: [1] }],
		preferences: { list: [{ selected: false }] },
	};
	const a = State.create(initial);
	const saved = toSnapshot(a);
	const b = State.create(saved);
	const c = State.create(saved);
	const update = {
		items: [{ values: [2, 3] }, { values: [4] }],
		preferences: { list: [{ selected: true }, { selected: true }] },
	};
	applySnapshot(b, update);

	expect(toSnapshot(b)).toEqual(update);
	expect(a.items).toEqual(initial.items);
	expect(a.preferences).toEqual(initial.preferences);
	expect(saved).toStrictEqual({
		items: [{ values: [1] }],
		preferences: { list: [{ selected: false }] },
	});
	expect(toSnapshot(c)).toStrictEqual(saved);

	// New entries on the apply path, not just the create path, are isolated.
	b.items[1].values.push(5);
	b.preferences!.list[1].selected = false;
	expect(update.items[1].values).toEqual([4]);
	expect(update.preferences.list[1].selected).toBe(true);
});
