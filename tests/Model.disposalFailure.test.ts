import {
	Model,
	child,
	findModelById,
	id,
	modelRef,
	reaction,
} from "../src/index";

class Item extends Model {
	@id id!: number;
	label = "";
	children: Item[] = [];
	peer?: Item;
	static get types() {
		return { children: child(Item), peer: modelRef(Item) };
	}
}

class Tree extends Model {
	value = 0;
	@child(Item) first?: Item;
	@child(Item) siblings: Item[] = [];
}

test("a throwing detachment observer cannot leave a disposed tree writable", () => {
	const tree = Tree.create();
	const first = Item.create({ id: 1, children: [{ id: 2 }] });
	const nested = first.children[0];
	const sibling = Item.create({ id: 3 });
	tree.first = first;
	tree.siblings.push(sibling);
	const siblings = tree.siblings;
	const owned = [first, nested, sibling];
	const ownership = () =>
		owned.map((item) => [item.parent, findModelById(tree, Item, item.id)]);
	const detached = owned.map(() => [null, undefined]);
	const failure = new Error("detach subscriber");
	const observations: ReturnType<typeof ownership>[] = [];
	const stop = reaction(
		() => first.parent,
		(parent) => {
			if (parent !== null) return;
			observations.push(ownership());
			throw failure;
		}
	);

	try {
		expect(ownership()).toEqual([
			[tree, first],
			[first, nested],
			[tree, sibling],
		]);
		expect(() => tree[Symbol.dispose]()).toThrow(failure);
		expect(observations).toEqual([detached]);
		expect(ownership()).toEqual(detached);
		expect(findModelById(first, Item, nested.id)).toBeUndefined();

		expect(() => {
			tree.value = 1;
		}).toThrow("disposed model");
		for (const item of owned) {
			expect(() => {
				item.label = "changed";
			}).toThrow("disposed model");
		}
		const candidate = Item.create({ id: 4 });
		expect(() => {
			tree.first = candidate;
		}).toThrow("disposed model");
		expect(() => siblings.push(candidate)).toThrow("disposed model");
		expect(candidate.parent).toBeNull();
		expect(findModelById(tree, Item, candidate.id)).toBeUndefined();
		expect(() => {
			Tree.create().first = sibling;
		}).toThrow("disposed model");

		expect(() => tree[Symbol.dispose]()).not.toThrow();
		expect(observations).toEqual([detached]);
	} finally {
		stop();
	}
});

test("detachment observers see terminal disposal before reentering", () => {
	const tree = Tree.create({ first: { id: 1 }, siblings: [{ id: 2 }] });
	const first = tree.first!;
	const siblings = tree.siblings;
	expect(() => first[Symbol.dispose]()).toThrow("attached child model");
	expect(first.parent).toBe(tree);
	expect(findModelById(tree, Item, first.id)).toBe(first);
	first.label = "still active";

	const candidate = Item.create({ id: 3 });
	const failure = new Error("detach subscriber");
	let notifications = 0;
	const stop = reaction(
		() => first.parent,
		(parent) => {
			if (parent !== null) return;
			notifications++;
			expect(() => {
				tree.first = candidate;
			}).toThrow("disposed model");
			expect(() => siblings.push(candidate)).toThrow("disposed model");
			expect(() => tree[Symbol.dispose]()).not.toThrow();
			expect(() => first[Symbol.dispose]()).not.toThrow();
			throw failure;
		}
	);

	try {
		expect(() => tree[Symbol.dispose]()).toThrow(failure);
		expect(notifications).toBe(1);
	} finally {
		stop();
	}
});

test("removing a child is reversible and disposal never follows a model ref", () => {
	const tree = Tree.create({ first: { id: 1 }, siblings: [{ id: 2 }] });
	const first = tree.first!;
	const [peer] = tree.siblings;
	first.peer = peer;
	expect(first.peer).toBe(peer);

	tree.first = undefined;
	expect(first.parent).toBeNull();
	first.label = "detached";
	tree.first = first;
	expect(first.peer).toBe(peer);

	// Dispose the former owner while the referenced item is owned by a different tree.
	const [removed] = tree.siblings.splice(0);
	const other = Tree.create();
	other.first = removed;
	tree[Symbol.dispose]();
	peer.label = "still active";
	expect(peer.parent).toBe(other);
	expect(findModelById(other, Item, peer.id)).toBe(peer);
});
