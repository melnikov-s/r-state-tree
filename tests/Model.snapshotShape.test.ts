import {
	Model,
	child,
	id,
	modelRef,
	observable,
	onSnapshot,
	reaction,
	toSnapshot,
} from "../src/index";

class State extends Model {
	x = 1;
	declare extra?: number;
}

test.each(["cold", "warm"])(
	"tracks an initially %s snapshot through field additions and removals",
	(cache) => {
		class Empty extends Model {
			declare extra?: number;
		}
		const model = Empty.create();
		if (cache === "warm") expect(toSnapshot(model)).toStrictEqual({});

		model.extra = undefined;
		const added = toSnapshot(model);
		expect(added).toStrictEqual({ extra: undefined });
		expect(toSnapshot(model)).toBe(added);

		Object.defineProperty(model, "extra", { value: 2 });
		const updated = toSnapshot(model);
		expect(updated).toStrictEqual({ extra: 2 });

		delete model.extra;
		expect(toSnapshot(model)).toStrictEqual({});
		expect(updated).toStrictEqual({ extra: 2 });
	}
);

test("publishes ordinary assignments, reflective updates and deletion once per write", () => {
	const model = State.create();
	const initial = toSnapshot(model);
	const snapshots: unknown[] = [];
	const xValues: number[] = [];
	const extraValues: (number | undefined)[] = [];
	const stops = [
		onSnapshot(model, (snapshot) => snapshots.push(snapshot)),
		reaction(
			() => model.x,
			(value) => xValues.push(value)
		),
		reaction(
			() => model.extra,
			(value) => extraValues.push(value)
		),
	];
	try {
		model.extra = 2;
		expect(snapshots).toStrictEqual([{ x: 1, extra: 2 }]);
		model.x = 2;
		Object.defineProperty(model, "x", { value: 3 });
		model.extra = 4;
		delete model.extra;
		model.x = 3; // A same-value assignment does not notify.

		expect(xValues).toEqual([2, 3]);
		expect(extraValues).toEqual([2, 4, undefined]);
		expect(snapshots).toStrictEqual([
			{ x: 1, extra: 2 },
			{ x: 2, extra: 2 },
			{ x: 3, extra: 2 },
			{ x: 3, extra: 4 },
			{ x: 3 },
		]);
		expect(toSnapshot(model)).toBe(snapshots.at(-1));
		expect(initial).toStrictEqual({ x: 1 });
	} finally {
		stops.forEach((stop) => stop());
	}
});

test("tracks the enumerable keys through reflective addition and descriptor changes", () => {
	const model = State.create();
	const keys: string[] = [];
	const stop = reaction(
		() => Object.keys(model).join(","),
		(value) => keys.push(value)
	);
	try {
		expect(toSnapshot(model)).toStrictEqual({ x: 1 });
		Object.defineProperty(model, "extra", {
			value: 2,
			configurable: true,
			enumerable: true,
		});
		expect(toSnapshot(model)).toStrictEqual({ x: 1, extra: 2 });
		Object.defineProperty(model, "extra", { enumerable: false });
		expect(toSnapshot(model)).toStrictEqual({ x: 1 });
		expect(model.extra).toBe(2);
		Object.defineProperty(model, "extra", { enumerable: true });
		expect(toSnapshot(model)).toStrictEqual({ x: 1, extra: 2 });
		delete model.extra;
		expect(Object.isExtensible(model)).toBe(true);
		expect(keys).toEqual(["x,extra", "x", "x,extra", "x"]);
	} finally {
		stop();
	}
});

test("keeps define-style initializers and reflective replacements shallow-reactive", () => {
	class Document extends Model {
		items = observable([1]);
	}
	const model = Document.create();
	const snapshots: unknown[] = [];
	const stop = onSnapshot(model, (snapshot) => snapshots.push(snapshot));
	try {
		model.items.push(2);
		const replacement = observable([3]);
		Object.defineProperty(model, "items", { value: replacement });
		expect(model.items).toBe(replacement);
		replacement.push(4);
		expect(snapshots).toStrictEqual([
			{ items: [1, 2] },
			{ items: [3] },
			{ items: [3, 4] },
		]);
	} finally {
		stop();
	}
});

test("keeps managed fields on their guarded reflective write paths", () => {
	class Leaf extends Model {
		@id id = 1;
	}
	class Root extends Model {
		@child(Leaf) leaf = Leaf.create();
		@modelRef(Leaf) ref?: Leaf;
	}
	const root = Root.create();
	Object.defineProperty(root, "ref", { value: root.leaf });
	const snapshot = toSnapshot(root);
	expect(root.leaf.parent).toBe(root);
	expect(root.ref).toBe(root.leaf);
	expect(snapshot).toStrictEqual({ leaf: { id: 1 }, ref: { id: 1 } });

	expect(() =>
		Reflect.defineProperty(root, "leaf", { get: () => null })
	).toThrow(TypeError);
	expect(() =>
		Reflect.defineProperty(root.leaf, "id", { value: 2, writable: false })
	).toThrow(TypeError);
	expect(() =>
		Reflect.defineProperty(root, "ref", { value: undefined, enumerable: false })
	).toThrow(TypeError);
	expect(toSnapshot(root)).toBe(snapshot);
});
