import { getDiff } from "../src/utils";
import { CommonCfgTypes, ModelCfgTypes } from "../src/types";
import type { ModelConfiguration } from "../src/types";

function diffChildren(
	previous: object[],
	next: object[],
	itemConfig: ModelConfiguration<unknown> = { id: { type: ModelCfgTypes.id } }
) {
	const before = { items: previous };
	const after = { items: next };
	const configs = new WeakMap<object, ModelConfiguration<unknown>>();
	const rootConfig = { items: { type: CommonCfgTypes.child } };
	configs.set(before, rootConfig);
	configs.set(after, rootConfig);
	// Use indexed iteration so tests can observe when the diff itself builds
	// an index by iterating the previous array.
	previous.forEach((snapshot) => configs.set(snapshot, itemConfig));
	next.forEach((snapshot) => configs.set(snapshot, itemConfig));
	return getDiff(before, after, (snapshot) => configs.get(snapshot));
}

function observedIteration(items: object[]) {
	const iterate = vi.fn(() => items[Symbol.iterator]());
	const array = new Proxy(items, {
		get(target, key, receiver) {
			return key === Symbol.iterator
				? iterate
				: Reflect.get(target, key, receiver);
		},
	});
	return { array, iterate };
}

test("unchanged child snapshots emit an identifier without enumerating fields", () => {
	const ownKeys = vi.fn(Reflect.ownKeys);
	const unchanged = new Proxy({ id: 1, value: 10 }, { ownKeys });
	const before = { id: 2, value: 10 };
	const after = { id: 2, value: 99 };

	expect(diffChildren([unchanged, before], [unchanged, after])).toStrictEqual({
		items: [{ id: 1 }, { id: 2, value: 99 }],
	});
	expect(ownKeys).not.toHaveBeenCalled();
});

test("reordered unchanged snapshots skip field enumeration after identity matching", () => {
	const ownKeys = vi.fn(Reflect.ownKeys);
	const a = new Proxy({ id: 0, value: 10 }, { ownKeys });
	const b = new Proxy({ id: 1, value: 20 }, { ownKeys });

	expect(diffChildren([a, b], [b, a])).toStrictEqual({
		items: [{ id: 1 }, { id: 0 }],
	});
	expect(ownKeys).not.toHaveBeenCalled();
});

test("aligned child edits do not build an identity index", () => {
	const unchanged = { id: 0, value: 10 };
	const { array, iterate } = observedIteration([
		unchanged,
		{ id: 1, value: 10 },
	]);

	expect(diffChildren(array, [unchanged, { id: 1, value: 99 }])).toStrictEqual({
		items: [{ id: 0 }, { id: 1, value: 99 }],
	});
	expect(iterate).not.toHaveBeenCalled();
});

test("structural changes build one index and still match shifted edits by identity", () => {
	const a = { id: 0, value: 10 };
	const b = { id: 1, value: 20 };
	const c = { id: 2, value: 30 };
	const d = { id: 3, value: 40 };
	const { array, iterate } = observedIteration([a, b, c, d]);

	expect(diffChildren(array, [a, { ...c, value: 99 }, d, b])).toStrictEqual({
		items: [{ id: 0 }, { id: 2, value: 99 }, { id: 3 }, { id: 1 }],
	});
	expect(iterate).toHaveBeenCalledTimes(1);
});

test("identifier metadata is discovered once per configuration, not per child or diff", () => {
	const ownKeys = vi.fn(Reflect.ownKeys);
	const config = new Proxy<ModelConfiguration<unknown>>(
		{ key: { type: ModelCfgTypes.id } },
		{ ownKeys }
	);
	const previous = [
		{ key: 0, value: 10 },
		{ key: "", value: 20 },
	];
	const next = [{ key: 0, value: 99 }, previous[1]];

	for (let repeat = 0; repeat < 2; repeat++) {
		expect(diffChildren(previous, next, config)).toStrictEqual({
			items: [{ key: 0, value: 99 }, { key: "" }],
		});
		expect(diffChildren(next, previous, config)).toStrictEqual({
			items: [{ key: 0, value: 10 }, { key: "" }],
		});
	}
	expect(ownKeys).toHaveBeenCalledTimes(1);
});

test("missing identifier metadata is cached without making ID-less diffs partial", () => {
	const ownKeys = vi.fn(Reflect.ownKeys);
	const config = new Proxy<ModelConfiguration<unknown>>({}, { ownKeys });
	const previous = [
		{ value: 10, label: "saved" },
		{ value: 20, label: "saved" },
	];
	const next = [{ value: 99, label: "saved" }, previous[1]];

	for (let repeat = 0; repeat < 2; repeat++) {
		expect(diffChildren(previous, next, config)).toStrictEqual({ items: next });
		expect(diffChildren(next, previous, config)).toStrictEqual({
			items: previous,
		});
	}
	expect(ownKeys).toHaveBeenCalledTimes(1);
});

test("different configurations with the same ID do not take the aligned shortcut", () => {
	const oldConfig = { oldKey: { type: ModelCfgTypes.id } };
	const newConfig = { newKey: { type: ModelCfgTypes.id } };
	const before = { items: [{ oldKey: 1, value: 10 }] };
	const after = { items: [{ newKey: 1, value: 10 }] };
	const configs = new WeakMap<object, ModelConfiguration<unknown>>([
		[before, { items: { type: CommonCfgTypes.child } }],
		[after, { items: { type: CommonCfgTypes.child } }],
		[before.items[0], oldConfig],
		[after.items[0], newConfig],
	]);

	expect(
		getDiff<{ items: object[] }>(before, after, (snapshot) =>
			configs.get(snapshot)
		)
	).toStrictEqual({
		items: [{ newKey: 1, value: 10 }],
	});
});
