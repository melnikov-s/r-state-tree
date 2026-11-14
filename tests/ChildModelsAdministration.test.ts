import { getAdministration } from "../src/observables";
import {
	Model,
	child,
	id,
	modelRef,
	findModelById,
	toSnapshot,
	onSnapshot,
	effect,
	reaction,
	source,
} from "../src/index";

class Item extends Model {
	@id id!: number;
	children: Item[] = [];
	static get types() {
		return { children: child(Item) };
	}
}

class List extends Model {
	@child(Item) items: Item[] = [];
	@modelRef(Item) selected?: Item;
}

function listWith(...ids: number[]): List {
	return List.create({ items: ids.map((id) => ({ id })) });
}

function expectOwned(list: List, items: Item[]): void {
	expect(list.items).toEqual(items);
	expect(Object.keys(list.items)).toEqual(items.map((_, i) => String(i)));
	for (const item of items) {
		expect(item.parent).toBe(list);
		expect(findModelById(list, Item, item.id)).toBe(item);
	}
	expect(toSnapshot(list).items).toEqual(items.map((item) => toSnapshot(item)));
}

function expectDetached(list: List, items: Item[]): void {
	for (const item of items) {
		expect(item.parent).toBe(null);
		if (!list.items.some((owned) => owned.id === item.id)) {
			expect(findModelById(list, Item, item.id)).toBe(undefined);
		}
	}
}

describe("child array ownership transactions", () => {
	test("push, pop, indexed writes and tail splice do not scan retained children", () => {
		const list = listWith(...Array.from({ length: 1000 }, (_, i) => i));
		const adm = getAdministration(list.items);
		const backing = adm.source;
		const reads: number[] = [];
		// Instrument backing reads without changing the array's behavior.
		const instrumented = new Proxy(backing, {
			get(target, key, receiver) {
				if (typeof key === "string" && /^\d+$/.test(key))
					reads.push(Number(key));
				return Reflect.get(target, key, receiver);
			},
		});
		Object.defineProperty(adm, "source", { value: instrumented });
		try {
			const appended = Item.create({ id: 1000 });
			list.items.push(appended);
			expect(reads).toEqual([]);
			reads.length = 0;
			const replacement = Item.create({ id: 1001 });
			list.items[500] = replacement;
			expect(reads.length).toBeLessThan(10);
			expect(reads.every((index) => index === 500)).toBe(true);
			reads.length = 0;
			expect(list.items.pop()).toBe(appended);
			expect(reads.length).toBeLessThan(10);
			expect(reads.every((index) => index === 1000)).toBe(true);
			reads.length = 0;
			list.items.splice(999, 1, appended);
			expect(reads.length).toBeLessThan(10);
			expect(reads.every((index) => index === 999)).toBe(true);
			expect(appended.parent).toBe(list);
			expect(replacement.parent).toBe(list);
		} finally {
			Object.defineProperty(adm, "source", { value: backing });
		}
	});

	test("membership checks stay correct after reordering and removal", () => {
		const list = listWith(1, 2, 3);
		const original = [...list.items];
		list.items.reverse();
		expect(() => list.items.push(original[0])).toThrow("duplicate models");
		expect(list.items.pop()).toBe(original[0]);
		list.items.unshift(original[0]);
		expectOwned(list, [original[0], original[2], original[1]]);
	});

	test("unsupported operations reject even on empty child arrays", () => {
		const list = listWith();
		const item = Item.create({ id: 1 });
		expect(() => list.items.fill(item)).toThrow("do not support fill()");
		expect(() => list.items.copyWithin(0, 0)).toThrow(
			"do not support copyWithin()"
		);
		expect(() => {
			list.items.length = 0;
		}).toThrow("length is read-only");
		expectOwned(list, []);
		expect(item.parent).toBe(null);
	});

	test("same-value indexed assignment is a no-op", () => {
		const list = listWith(1);
		const item = list.items[0];
		let notifications = 0;
		const stop = onSnapshot(list, () => {
			notifications++;
		});
		list.items[0] = item;
		list.items[0] = source(item);
		expect(notifications).toBe(0);
		expectOwned(list, [item]);
		stop();
	});

	test("native commit failure leaves membership, ownership and IDs unchanged", () => {
		const list = listWith(1);
		const original = [...list.items];
		const replacement = Item.create({ id: 2 });
		Object.defineProperty(list.items, "constructor", {
			configurable: true,
			value: {
				[Symbol.species]: class {
					constructor() {
						throw new Error("native commit failed");
					}
				},
			},
		});
		try {
			expect(() => list.items.splice(0, 1, replacement)).toThrow(
				"native commit failed"
			);
		} finally {
			Reflect.deleteProperty(list.items, "constructor");
		}
		expectOwned(list, original);
		expect(replacement.parent).toBe(null);
		expect(findModelById(list, Item, 2)).toBe(undefined);
		list.items.splice(0, 1, replacement);
		expectOwned(list, [replacement]);
		expectDetached(list, original);
	});

	test("splice(start) removes the tail and splice(start, undefined) removes nothing", () => {
		const list = listWith(1, 2, 3);
		const [first, ...tail] = list.items;
		expect(list.items.splice(1, undefined)).toEqual([]);
		expect(list.items.splice(1)).toEqual(tail);
		expectOwned(list, [first]);
		expectDetached(list, tail);
		expect(list.items.splice(0)).toEqual([first]);
		expectOwned(list, []);
		expectDetached(list, [first]);
	});

	test.each([NaN, -Infinity, Infinity, -1.8, 1.8, -99, 99])(
		"splice normalizes start %s like a native array",
		(start) => {
			const list = listWith(1, 2, 3);
			const original = [...list.items];
			const expected = [...original];
			const replacement = Item.create({ id: 4 });
			const removed = expected.splice(start, 1.8, replacement);
			expect(list.items.splice(start, 1.8, replacement)).toEqual(removed);
			expectOwned(list, expected);
			expectDetached(list, removed);
		}
	);

	test("index assignment appends to an empty array or at its length", () => {
		const list = listWith();
		const first = Item.create({ id: 1 });
		const second = Item.create({ id: 2 });
		list.items[0] = first;
		list.items[list.items.length] = second;
		expectOwned(list, [first, second]);
	});

	test("index replacement detaches old children and attaches replacements", () => {
		const list = listWith(1);
		const old = list.items[0];
		const replacement = Item.create({ id: 2 });
		list.items[0] = replacement;
		expectOwned(list, [replacement]);
		expectDetached(list, [old]);
	});

	test("raw Model inputs are normalized to their public identity", () => {
		const list = listWith();
		const item = Item.create({ id: 1 });
		list.items[0] = source(item);
		expectOwned(list, [item]);
		expect(list.items[0]).toBe(item);
	});

	test("empty mutation ranges have native no-op semantics", () => {
		const list = listWith(1, 2);
		const original = [...list.items];
		expect(Reflect.apply(list.items.splice, list.items, [])).toEqual([]);
		expect(list.items.splice(0, undefined)).toEqual([]);
		expect(() => list.items.fill(undefined as unknown as Item, 1, 1)).toThrow(
			"do not support fill()"
		);
		expect(() => list.items.copyWithin(0, 2)).toThrow(
			"do not support copyWithin()"
		);
		expectOwned(list, original);
	});

	test("failed append leaves an empty array empty, without an undefined slot", () => {
		const list = listWith();
		const other = listWith(1);
		const item = other.items[0];
		expect(() => {
			list.items[0] = item;
		}).toThrow("already attached");
		expectOwned(list, []);
		expectOwned(other, [item]);
	});

	test("length truncation is rejected; splice unregisters descendant IDs and invalidates references", () => {
		const list = List.create({ items: [{ id: 1, children: [{ id: 2 }] }] });
		const item = list.items[0];
		const descendant = item.children[0];
		list.selected = descendant;
		const seen: Array<Item | undefined> = [];
		const stop = effect(() => {
			seen.push(list.selected);
		});
		expect(() => {
			list.items.length = 0;
		}).toThrow("length is read-only");
		expectOwned(list, [item]);
		expect(seen).toEqual([descendant]);
		list.items.splice(0);
		expectOwned(list, []);
		expectDetached(list, [item]);
		expect(descendant.parent).toBe(item);
		expect(findModelById(list, Item, 2)).toBe(undefined);
		expect(findModelById(item, Item, 2)).toBe(descendant);
		expect(seen).toEqual([descendant, undefined]);
		stop();
	});

	test("rejected length truncation preserves ownership; splice allows reattachment elsewhere", () => {
		const list = listWith(1, 2, 3);
		const [first, ...removed] = list.items;
		expect(() => {
			list.items.length = 1;
		}).toThrow("use splice()");
		expectOwned(list, [first, ...removed]);
		list.items.splice(1);
		expectOwned(list, [first]);
		expectDetached(list, removed);
		const other = listWith();
		other.items.push(...removed);
		expectOwned(other, removed);
	});

	test("fill is rejected even for a single slot; indexed replacement updates ownership", () => {
		const list = listWith(1, 2, 3);
		const [first, old, last] = list.items;
		const replacement = Item.create({ id: 4 });
		expect(() => list.items.fill(replacement, -2, -1)).toThrow(
			"do not support fill()"
		);
		expectOwned(list, [first, old, last]);
		expect(replacement.parent).toBe(null);
		list.items[1] = replacement;
		expectOwned(list, [first, replacement, last]);
		expectDetached(list, [old]);
	});

	test("fill over one element is rejected; splice may reuse the removed child's ID", () => {
		const list = listWith(1);
		const old = list.items[0];
		const replacement = Item.create({ id: 1 });
		expect(() => list.items.fill(replacement)).toThrow("do not support fill()");
		expectOwned(list, [old]);
		list.items.splice(0, 1, replacement);
		expectOwned(list, [replacement]);
		expectDetached(list, [old]);
	});

	test("fill and copyWithin always reject, including empty and identity ranges", () => {
		const list = listWith(1, 2, 3);
		const original = [...list.items];
		const replacement = Item.create({ id: 4 });
		expect(() => list.items.fill(replacement)).toThrow("do not support fill()");
		expectOwned(list, original);
		expect(replacement.parent).toBe(null);
		expect(() => list.items.copyWithin(1, 0, 2)).toThrow(
			"do not support copyWithin()"
		);
		expectOwned(list, original);
		expect(() => list.items.copyWithin(0, 0)).toThrow(
			"do not support copyWithin()"
		);
		expect(() => list.items.copyWithin(3, 0)).toThrow(
			"do not support copyWithin()"
		);
		expectOwned(list, original);
	});

	test("splice can reorder retained children without detaching them", () => {
		const list = listWith(1, 2, 3);
		const [a, b, c] = list.items;
		const parents: Array<Model | null> = [];
		const stop = reaction(
			() => a.parent,
			(parent) => {
				parents.push(parent);
			}
		);
		expect(list.items.splice(0, 3, c, a, b)).toEqual([a, b, c]);
		expectOwned(list, [c, a, b]);
		expect(parents).toEqual([]);
		stop();
	});

	test("reverse and sort preserve ownership and notify final snapshots", () => {
		const list = listWith(1, 2, 3);
		const original = [...list.items];
		const snapshots: unknown[] = [];
		const stop = onSnapshot(list, (snapshot) => {
			snapshots.push(snapshot.items);
		});
		expect(list.items.reverse()).toBe(list.items);
		expectOwned(list, [...original].reverse());
		expect(list.items.sort((a, b) => a.id - b.id)).toBe(list.items);
		expectOwned(list, original);
		expect(snapshots).toHaveLength(2);
		stop();
	});

	test("a throwing comparator or reentrant mutation leaves the array untouched", () => {
		const list = listWith(1, 2, 3);
		const original = [...list.items];
		expect(() =>
			list.items.sort(() => {
				throw new Error("comparison failed");
			})
		).toThrow("comparison failed");
		expectOwned(list, original);
		expect(() =>
			list.items.sort(() => {
				list.items.pop();
				return 0;
			})
		).toThrow("reentrant");
		expectOwned(list, original);
	});

	test("push, pop, shift and unshift all update ownership", () => {
		const list = listWith(1);
		const first = list.items[0];
		const second = Item.create({ id: 2 });
		const third = Item.create({ id: 3 });
		expect(list.items.push(second)).toBe(2);
		expect(list.items.unshift(third)).toBe(3);
		expectOwned(list, [third, first, second]);
		expect(list.items.pop()).toBe(second);
		expect(list.items.shift()).toBe(third);
		expectOwned(list, [first]);
		expectDetached(list, [second, third]);
	});

	test("failed multi-item splice validates all incoming ownership and IDs first", () => {
		const list = listWith(1, 2);
		const original = [...list.items];
		const good = Item.create({ id: 3 });
		const duplicateId = Item.create({ id: 2 });
		const other = listWith(4);
		const owned = other.items[0];
		for (const invalid of [duplicateId, owned]) {
			expect(() => list.items.splice(0, 1, good, invalid)).toThrow();
			expectOwned(list, original);
			expect(good.parent).toBe(null);
			expect(findModelById(list, Item, 3)).toBe(undefined);
		}
		expectOwned(other, [owned]);
	});

	test("conflicting descendant IDs and conflicts between incoming subtrees are atomic", () => {
		const list = List.create({ items: [{ id: 1, children: [{ id: 2 }] }] });
		const original = [...list.items];
		const a = Item.create({ id: 3, children: [{ id: 4 }] });
		const b = Item.create({ id: 5, children: [{ id: 4 }] });
		const conflict = Item.create({ id: 6, children: [{ id: 2 }] });
		expect(() => list.items.push(a, b)).toThrow("already assigned");
		expect(() => list.items.push(a, conflict)).toThrow("already assigned");
		expectOwned(list, original);
		for (const item of [a, b, conflict]) expect(item.parent).toBe(null);
		expect(findModelById(list, Item, 4)).toBe(undefined);
	});

	test("replacing subtrees can reuse all removed IDs", () => {
		const list = List.create({ items: [{ id: 1, children: [{ id: 2 }] }] });
		const old = list.items[0];
		const replacement = Item.create({ id: 1, children: [{ id: 2 }] });
		list.items.splice(0, 1, replacement);
		expectOwned(list, [replacement]);
		expect(old.parent).toBe(null);
		expect(findModelById(list, Item, 2)).toBe(replacement.children[0]);
	});

	test("duplicate identity, raw-source aliases, invalid values and holes are rejected atomically", () => {
		const list = listWith(1, 2);
		const original = [...list.items];
		const item = Item.create({ id: 3 });
		const attempts = [
			() => list.items.push(item, item),
			() => list.items.push(original[0]),
			() => {
				list.items[1] = source(original[0]);
			},
			() => {
				list.items[4] = item;
			},
			() => {
				list.items.length = 4;
			},
			() => list.items.push(undefined as unknown as Item),
			() => list.items.fill({} as Item, 0, 1),
			() => {
				delete list.items[0];
			},
		];
		for (const attempt of attempts) {
			expect(attempt).toThrow();
			expectOwned(list, original);
			expect(item.parent).toBe(null);
		}
	});

	test.each([-1, 1.5, NaN, Infinity, 2 ** 32, 1n])(
		"length assignment %s is unsupported without changing ownership",
		(length) => {
			const list = listWith(1);
			const original = [...list.items];
			expect(() => {
				(list.items as unknown as { length: unknown }).length = length;
			}).toThrow("length is read-only");
			expectOwned(list, original);
		}
	);

	test("defineProperty replacements, append and truncation are explicitly rejected", () => {
		const list = listWith(1);
		const original = [...list.items];
		const replacement = Item.create({ id: 2 });
		const appended = Item.create({ id: 3 });
		const attempts = [
			() => Object.defineProperty(list.items, "0", { value: replacement }),
			() =>
				Object.defineProperty(list.items, "1", {
					value: appended,
					writable: true,
					enumerable: true,
					configurable: true,
				}),
			() => Object.defineProperty(list.items, "length", { value: 0 }),
		];
		for (const attempt of attempts) {
			expect(attempt).toThrow("use indexed assignment or splice()");
			expectOwned(list, original);
		}
		expect(replacement.parent).toBe(null);
		expect(appended.parent).toBe(null);
	});

	test("accessors, immutable descriptors and non-extensible arrays are explicitly rejected", () => {
		const list = listWith(1);
		const original = [...list.items];
		const attempts = [
			() => Object.defineProperty(list.items, "0", { get: () => original[0] }),
			() => Object.defineProperty(list.items, "0", { writable: false }),
			() => Object.defineProperty(list.items, "0", { configurable: false }),
			() => Object.defineProperty(list.items, "length", { writable: false }),
			() => Object.freeze(list.items),
			() => Object.seal(list.items),
			() => Object.preventExtensions(list.items),
			() => Object.setPrototypeOf(list.items, { 1: { set: () => {} } }),
		];
		for (const attempt of attempts) {
			expect(attempt).toThrow();
			expectOwned(list, original);
			expect(Object.isExtensible(list.items)).toBe(true);
		}
	});

	test("whole-property replacement validates before detaching the old collection", () => {
		const list = listWith(1, 2);
		const originalArray = list.items;
		const original = [...list.items];
		const other = listWith(3);
		expect(() => {
			list.items = [original[0], other.items[0]];
		}).toThrow("already attached");
		expect(list.items).toBe(originalArray);
		expectOwned(list, original);
		list.items = [...original].reverse();
		expectOwned(list, [...original].reverse());
		// A stale array reference must not detach children retained by its replacement.
		originalArray.splice(0);
		expectOwned(list, [...original].reverse());
	});

	test("observers see consistent final ownership and registrations, and no failed intermediate state", () => {
		const list = listWith(1);
		const seen: number[][] = [];
		const stop = effect(() => {
			const items = [...list.items];
			for (const item of items) {
				expect(item.parent).toBe(list);
				expect(findModelById(list, Item, item.id)).toBe(item);
			}
			seen.push(items.map((item) => item.id));
		});
		const replacement = Item.create({ id: 2 });
		list.items[0] = replacement;
		expect(() => list.items.push(replacement)).toThrow();
		expect(() => list.items.fill(replacement)).toThrow("do not support fill()");
		expect(() => {
			list.items.length = 0;
		}).toThrow("length is read-only");
		list.items.splice(0);
		expect(seen).toEqual([[1], [2], []]);
		stop();
	});

	test("an observer may mutate the collection after the previous transaction commits", () => {
		const list = listWith();
		const second = Item.create({ id: 2 });
		const stop = reaction(
			() => list.items.length,
			(length) => {
				if (length === 1) list.items.push(second);
			}
		);
		const first = Item.create({ id: 1 });
		list.items.push(first);
		expectOwned(list, [first, second]);
		stop();
	});

	test("removed children are not disposed with their former owner", () => {
		const list = listWith(1, 2);
		const [retained, removed] = list.items;
		expect(() => {
			list.items.length = 1;
		}).toThrow("length is read-only");
		list.items.splice(1);
		list[Symbol.dispose]();
		expect(() => {
			retained.id = 3;
		}).toThrow("disposed");
		expect(() => {
			removed.id = 4;
		}).not.toThrow();
		expect(removed.parent).toBe(null);
	});

	test("overridden backing-array method properties cannot interrupt an ownership commit", () => {
		const list = listWith(1);
		const first = list.items[0];
		const second = Item.create({ id: 2 });
		const fail = () => {
			throw new Error("must not dispatch here");
		};
		Object.defineProperty(list.items, "map", {
			value: fail,
			configurable: true,
		});
		Object.defineProperty(list.items, "splice", {
			value: fail,
			configurable: true,
		});
		list.items.push(second);
		delete (list.items as unknown as Record<string, unknown>).map;
		delete (list.items as unknown as Record<string, unknown>).splice;
		expectOwned(list, [first, second]);
	});

	test("disposed children and ownership cycles are rejected before any state changes", () => {
		const list = listWith(1);
		const original = [...list.items];
		const disposed = Item.create({ id: 2 });
		disposed[Symbol.dispose]();
		expect(() => list.items.push(disposed)).toThrow("disposed");
		expectOwned(list, original);
		const ancestor = Item.create({ id: 3, children: [{ id: 4 }] });
		const descendant = ancestor.children[0];
		expect(() => descendant.children.push(ancestor)).toThrow("ancestor");
		expect(descendant.children).toEqual([]);
		expect(ancestor.parent).toBe(null);
		expect(descendant.parent).toBe(ancestor);
	});
});
