import {
	Model,
	child,
	findModelById,
	id,
	modelRef,
	onSnapshot,
	onSnapshotDiff,
	reaction,
	toSnapshot,
} from "../src/index";

class Node extends Model {
	@id id!: number;
	@child next?: Node;
}

class Tree extends Model {
	value = 0;
	@child(Node) leaf?: Node;
	@child(Node) list?: Node[];
	@modelRef(Node) ref?: Node;
}

function makeTree() {
	const tree = Tree.create();
	tree.leaf = Node.create({ id: 1 });
	tree.list = [Node.create({ id: 2 })];
	tree.ref = tree.leaf;
	return tree;
}

function observeOwnership(tree: Tree, previous: Node, candidate?: Node) {
	const read = () => ({
		leaf: tree.leaf,
		list: tree.list,
		previousParent: previous.parent,
		candidateParent: candidate?.parent,
		lookup: findModelById(tree, Node, previous.id),
		ref: tree.ref,
	});
	const states: ReturnType<typeof read>[] = [];
	const snapshots: unknown[] = [];
	const diffs: unknown[] = [];
	const stop = [
		reaction(read, (state) => states.push(state)),
		onSnapshot(tree, (snapshot) => snapshots.push(snapshot)),
		onSnapshotDiff(tree, (diff) => diffs.push(diff)),
	];
	return {
		states,
		snapshots,
		diffs,
		stop: () => stop.forEach((dispose) => dispose()),
	};
}

it.each([
	"external owner",
	"sibling slot",
	"duplicate ID",
	"duplicate descendant ID",
	"disposed",
])(
	"rejects a scalar replacement with %s without publishing or detaching anything",
	(reason) => {
		const tree = makeTree();
		const other = makeTree();
		const previous = tree.leaf!;
		const replacement =
			reason === "external owner"
				? other.leaf!
				: reason === "sibling slot"
					? tree.list![0]
					: Node.create({ id: reason === "duplicate ID" ? 2 : 3 });
		if (reason === "duplicate descendant ID") {
			replacement.next = Node.create({ id: 2 });
		}
		if (reason === "disposed") replacement[Symbol.dispose]();
		const replacementParent = replacement.parent;
		const before = toSnapshot(tree);
		const otherBefore = toSnapshot(other);
		const observed = observeOwnership(tree, previous, replacement);
		try {
			expect(() => {
				tree.leaf = replacement;
			}).toThrow();
			expect(tree.leaf).toBe(previous);
			expect(previous.parent).toBe(tree);
			expect(replacement.parent).toBe(replacementParent);
			expect(findModelById(tree, Node, 1)).toBe(previous);
			expect(findModelById(tree, Node, 2)).toBe(tree.list![0]);
			expect(tree.ref).toBe(previous);
			expect(toSnapshot(tree)).toBe(before);
			expect(toSnapshot(other)).toBe(otherBefore);
			expect(observed.states).toHaveLength(0);
			expect(observed.snapshots).toHaveLength(0);
			expect(observed.diffs).toHaveLength(0);
		} finally {
			observed.stop();
		}
	}
);

it.each(["self", "ancestor"])("rejects a scalar %s cycle", (kind) => {
	// No IDs: the broken implementation can create this cycle without walking
	// the cyclic parent chain while updating the ID index.
	const root = Node.create();
	const next = Node.create();
	root.next = next;
	const before = toSnapshot(root);
	const target = kind === "self" ? root : next;
	expect(() => {
		target.next = root;
	}).toThrow(/ancestor|cycle|itself/i);
	expect(root.parent).toBeNull();
	expect(root.next).toBe(next);
	expect(next.parent).toBe(root);
	expect(next.next).toBeUndefined();
	expect(toSnapshot(root)).toBe(before);
});

it("publishes only the final scalar replacement and reuses released subtree IDs", () => {
	const tree = makeTree();
	const previous = tree.leaf!;
	previous.next = Node.create({ id: 3 });
	const replacement = Node.create({ id: 1 });
	replacement.next = Node.create({ id: 3 });
	replacement.next.next = Node.create({ id: 4 });
	const observed = observeOwnership(tree, previous, replacement);
	try {
		tree.leaf = replacement;
		expect(observed.states).toHaveLength(1);
		const [state] = observed.states;
		expect(state.leaf).toBe(replacement);
		expect(state.previousParent).toBeNull();
		expect(state.candidateParent).toBe(tree);
		expect(state.lookup).toBe(replacement);
		expect(state.ref).toBe(replacement);
		expect(findModelById(tree, Node, 3)).toBe(replacement.next);
		expect(findModelById(previous, Node, 3)).toBe(previous.next);
		expect(observed.snapshots).toEqual([toSnapshot(tree)]);
		expect(observed.diffs).toHaveLength(1);
	} finally {
		observed.stop();
	}
});

it.each(["leaf", "list"] as const)(
	"deletes the configured %s field and detaches its children in the same notification",
	(field) => {
		const tree = makeTree();
		const list = tree.list!;
		const child = field === "leaf" ? tree.leaf! : list[0];
		// Ownership must not depend on how a retained list is iterated.
		if (field === "list") list[Symbol.iterator] = [][Symbol.iterator].bind([]);
		tree.ref = child;
		const observed = observeOwnership(tree, child);
		try {
			expect(Reflect.deleteProperty(tree, field)).toBe(true);
			expect(Object.hasOwn(tree, field)).toBe(false);
			expect(observed.states).toHaveLength(1);
			const [state] = observed.states;
			expect(state[field]).toBeUndefined();
			expect(state.previousParent).toBeNull();
			expect(state.lookup).toBeUndefined();
			expect(state.ref).toBeUndefined();
			expect(observed.snapshots).toEqual([toSnapshot(tree)]);
			expect(observed.diffs).toHaveLength(1);
			if (field === "list") {
				const unowned = Node.create({ id: 3 });
				list.push(unowned);
				expect(unowned.parent).toBeNull();
				expect(findModelById(tree, Node, 3)).toBeUndefined();
			}
			const destination = Tree.create();
			destination.leaf = child;
			expect(child.parent).toBe(destination);
			expect(findModelById(destination, Node, child.id)).toBe(child);
		} finally {
			observed.stop();
		}
	}
);

it("rejects incompatible reflective child writes before changing ownership", () => {
	const tree = makeTree();
	const previous = tree.leaf!;
	const replacement = Node.create({ id: 1 });
	const before = toSnapshot(tree);
	const observed = observeOwnership(tree, previous, replacement);
	try {
		for (const attempt of [
			() =>
				Reflect.defineProperty(tree, "leaf", {
					value: replacement,
					configurable: false,
				}),
			() => Reflect.defineProperty(tree, "leaf", { get: () => replacement }),
			() => Reflect.defineProperty(tree, "leaf", { writable: false }),
			() => Reflect.set(tree, "leaf", replacement, {}),
		]) {
			expect(attempt).toThrow(TypeError);
			expect(tree.leaf).toBe(previous);
			expect(previous.parent).toBe(tree);
			expect(replacement.parent).toBeNull();
			expect(tree.ref).toBe(previous);
			expect(toSnapshot(tree)).toBe(before);
			expect(observed.states).toHaveLength(0);
		}
	} finally {
		observed.stop();
	}
});

it("keeps reflective writes guarded when a reaction runs during assignment", () => {
	const tree = makeTree();
	const replacement = Node.create({ id: 1 });
	const invalid = Node.create({ id: 2 });
	const stop = reaction(
		() => tree.leaf,
		() => {
			expect(() =>
				Reflect.defineProperty(tree, "leaf", {
					value: invalid,
					writable: false,
				})
			).toThrow(TypeError);
		}
	);
	try {
		// A compatible descriptor still uses the same atomic write path.
		expect(Reflect.defineProperty(tree, "leaf", { value: replacement })).toBe(
			true
		);
		expect(tree.leaf).toBe(replacement);
		expect(tree.ref).toBe(replacement);
		expect(Object.getOwnPropertyDescriptor(tree, "leaf")?.writable).toBe(true);
		expect(invalid.parent).toBeNull();
	} finally {
		stop();
	}
});

it.each<[string, (model: Tree) => unknown]>([
	["Object.preventExtensions", Object.preventExtensions],
	["Reflect.preventExtensions", Reflect.preventExtensions],
	["Object.seal", Object.seal],
	["Object.freeze", Object.freeze],
])("rejects %s without changing the live model", (_name, restrict) => {
	const tree = makeTree();
	const leaf = tree.leaf!;
	const item = tree.list![0];
	const descriptors = Object.getOwnPropertyDescriptors(tree);
	const before = toSnapshot(tree);

	expect(() => restrict(tree)).toThrow(TypeError);
	expect(Object.isExtensible(tree)).toBe(true);
	expect(Object.getOwnPropertyDescriptors(tree)).toEqual(descriptors);
	expect(tree.leaf).toBe(leaf);
	expect(leaf.parent).toBe(tree);
	expect(item.parent).toBe(tree);
	expect(findModelById(tree, Node, 1)).toBe(leaf);
	expect(findModelById(tree, Node, 2)).toBe(item);
	expect(tree.ref).toBe(leaf);
	expect(toSnapshot(tree)).toBe(before);

	tree.value = 1;
	const replacement = Node.create({ id: 1 });
	tree.leaf = replacement;
	expect(tree.value).toBe(1);
	expect(leaf.parent).toBeNull();
	expect(replacement.parent).toBe(tree);
	expect(tree.ref).toBe(replacement);
});

it("does not delete configured identity or reference properties", () => {
	const tree = makeTree();
	const leaf = tree.leaf!;
	const before = toSnapshot(tree);
	expect(() => Reflect.deleteProperty(leaf, "id")).toThrow(TypeError);
	expect(() => Reflect.deleteProperty(tree, "ref")).toThrow(TypeError);
	expect(leaf.id).toBe(1);
	expect(findModelById(tree, Node, 1)).toBe(leaf);
	expect(tree.ref).toBe(leaf);
	expect(toSnapshot(tree)).toBe(before);
});
