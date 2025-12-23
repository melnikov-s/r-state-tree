import { toObservableTree, effect, source, isObservable } from "../src";

describe("toObservableTree", () => {
	describe("nested reactivity (initial values)", () => {
		test("nested object property assignment triggers effect", () => {
			const tree = toObservableTree({
				user: { name: "Alice", profile: { age: 30 } },
			});

			let count = 0;
			let capturedName = "";
			let capturedAge = 0;

			effect(() => {
				capturedName = tree.user.name;
				capturedAge = tree.user.profile.age;
				count++;
			});

			expect(count).toBe(1);
			expect(capturedName).toBe("Alice");
			expect(capturedAge).toBe(30);

			// Mutate nested property
			tree.user.name = "Bob";
			expect(count).toBe(2);
			expect(capturedName).toBe("Bob");

			// Mutate deeply nested property
			tree.user.profile.age = 31;
			expect(count).toBe(3);
			expect(capturedAge).toBe(31);
		});

		test("nested object reassignment triggers effect", () => {
			const tree = toObservableTree({
				config: { theme: "dark" },
			});

			let count = 0;
			let capturedTheme = "";

			effect(() => {
				capturedTheme = tree.config.theme;
				count++;
			});

			expect(count).toBe(1);
			expect(capturedTheme).toBe("dark");

			// Reassign entire nested object
			tree.config = { theme: "light" };
			expect(count).toBe(2);
			expect(capturedTheme).toBe("light");
		});
	});

	describe("array nested reactivity (initial values)", () => {
		test("nested array element mutation triggers effect", () => {
			const tree = toObservableTree({
				items: [{ value: 1 }, { value: 2 }],
			});

			let count = 0;
			let capturedValue = 0;

			effect(() => {
				capturedValue = tree.items[0].value;
				count++;
			});

			expect(count).toBe(1);
			expect(capturedValue).toBe(1);

			// Mutate nested object inside array
			tree.items[0].value = 10;
			expect(count).toBe(2);
			expect(capturedValue).toBe(10);
		});

		test("array push with new object triggers length effect", () => {
			const tree = toObservableTree({
				items: [{ id: 1 }],
			});

			let count = 0;
			let capturedLength = 0;

			effect(() => {
				capturedLength = tree.items.length;
				count++;
			});

			expect(count).toBe(1);
			expect(capturedLength).toBe(1);

			// Push triggers length effect
			tree.items.push({ id: 2 });
			expect(count).toBe(2);
			expect(capturedLength).toBe(2);
		});

		test("deeply nested arrays are reactive", () => {
			const tree = toObservableTree({
				matrix: [
					[{ x: 1 }, { x: 2 }],
					[{ x: 3 }, { x: 4 }],
				],
			});

			let count = 0;
			let capturedX = 0;

			effect(() => {
				capturedX = tree.matrix[1][0].x;
				count++;
			});

			expect(count).toBe(1);
			expect(capturedX).toBe(3);

			// Mutate deeply nested value
			tree.matrix[1][0].x = 30;
			expect(count).toBe(2);
			expect(capturedX).toBe(30);
		});

		test("top-level array is reactive", () => {
			const tree = toObservableTree([{ name: "first" }, { name: "second" }]);

			let count = 0;
			let capturedName = "";

			effect(() => {
				capturedName = tree[0].name;
				count++;
			});

			expect(count).toBe(1);
			expect(capturedName).toBe("first");

			tree[0].name = "updated";
			expect(count).toBe(2);
			expect(capturedName).toBe("updated");
		});
	});

	describe("ignores non-plain objects", () => {
		test("Map is not wrapped and not traversed", () => {
			const map = new Map([["key", { value: 1 }]]);
			const tree = toObservableTree({
				data: map,
			});

			// Map is not observable
			expect(isObservable(tree.data)).toBe(false);
			expect(tree.data).toBe(map);
			expect(tree.data instanceof Map).toBe(true);

			// Values inside the Map are not wrapped either
			expect(isObservable(tree.data.get("key"))).toBe(false);
		});

		test("Set is not wrapped and not traversed", () => {
			const innerObj = { value: 1 };
			const set = new Set([innerObj]);
			const tree = toObservableTree({
				data: set,
			});

			expect(isObservable(tree.data)).toBe(false);
			expect(tree.data).toBe(set);
			expect(tree.data instanceof Set).toBe(true);
		});

		test("Date is not wrapped", () => {
			const date = new Date("2024-01-01");
			const tree = toObservableTree({
				createdAt: date,
			});

			expect(isObservable(tree.createdAt)).toBe(false);
			expect(tree.createdAt).toBe(date);
			expect(tree.createdAt instanceof Date).toBe(true);
		});

		test("class instance is not wrapped and not traversed", () => {
			class MyClass {
				nested = { value: 1 };
			}
			const instance = new MyClass();
			const tree = toObservableTree({
				obj: instance,
			});

			expect(isObservable(tree.obj)).toBe(false);
			expect(tree.obj).toBe(instance);
			expect(tree.obj instanceof MyClass).toBe(true);
			// Nested property inside class instance is not wrapped
			expect(isObservable(tree.obj.nested)).toBe(false);
		});

		test("RegExp is not wrapped", () => {
			const regex = /test/gi;
			const tree = toObservableTree({
				pattern: regex,
			});

			expect(isObservable(tree.pattern)).toBe(false);
			expect(tree.pattern).toBe(regex);
			expect(tree.pattern instanceof RegExp).toBe(true);
		});

		test("Error is not wrapped", () => {
			const error = new Error("test error");
			const tree = toObservableTree({
				err: error,
			});

			expect(isObservable(tree.err)).toBe(false);
			expect(tree.err).toBe(error);
			expect(tree.err instanceof Error).toBe(true);
		});

		test("mixed content: plain objects wrapped, non-plain left alone", () => {
			const map = new Map();
			const date = new Date();

			const tree = toObservableTree({
				plain: { value: 1 },
				map,
				date,
				nested: {
					innerPlain: { x: 2 },
					innerMap: new Map(),
				},
			});

			// Plain objects are observable
			expect(isObservable(tree)).toBe(true);
			expect(isObservable(tree.plain)).toBe(true);
			expect(isObservable(tree.nested)).toBe(true);
			expect(isObservable(tree.nested.innerPlain)).toBe(true);

			// Non-plain objects are not observable
			expect(isObservable(tree.map)).toBe(false);
			expect(isObservable(tree.date)).toBe(false);
			expect(isObservable(tree.nested.innerMap)).toBe(false);
		});
	});

	describe("source purity", () => {
		test("structuredClone on source does not throw for JSON-like input", () => {
			const tree = toObservableTree({
				user: { name: "Alice", tags: ["a", "b"] },
				items: [{ id: 1 }, { id: 2 }],
				count: 42,
				active: true,
				nothing: null,
			});

			// Source should be proxy-free
			const src = source(tree);
			expect(isObservable(src)).toBe(false);

			// structuredClone should not throw
			expect(() => structuredClone(src)).not.toThrow();

			// Cloned value should match
			const cloned = structuredClone(src);
			expect(cloned).toEqual({
				user: { name: "Alice", tags: ["a", "b"] },
				items: [{ id: 1 }, { id: 2 }],
				count: 42,
				active: true,
				nothing: null,
			});
		});

		test("source of nested observable is not a proxy", () => {
			const tree = toObservableTree({
				nested: { deep: { value: 1 } },
			});

			const nestedSource = source(tree.nested);
			expect(isObservable(nestedSource)).toBe(false);

			const deepSource = source(tree.nested.deep);
			expect(isObservable(deepSource)).toBe(false);
		});

		test("mutations do not store proxies in source", () => {
			const tree = toObservableTree({
				items: [] as { id: number }[],
			});

			// Add new item (not pre-wrapped)
			tree.items.push({ id: 1 });

			// Source should not contain proxies
			const src = source(tree);
			expect(isObservable(src.items[0])).toBe(false);
			expect(() => structuredClone(src)).not.toThrow();
		});
	});

	describe("shallow behavior after initial wrap", () => {
		test("new object assignments are NOT auto-wrapped", () => {
			const tree = toObservableTree({
				existing: { value: 1 },
			}) as { existing: { value: number }; newProp?: { foo: number } };

			// Initially wrapped values are observable
			expect(isObservable(tree.existing)).toBe(true);

			// Assign a NEW plain object
			tree.newProp = { foo: 42 };

			// New assignment is NOT auto-wrapped (normal shallow behavior)
			expect(isObservable(tree.newProp)).toBe(false);
			expect(tree.newProp.foo).toBe(42);
		});

		test("new array element assignments are NOT auto-wrapped", () => {
			const tree = toObservableTree({
				items: [{ id: 1 }],
			});

			// Initially wrapped values are observable
			expect(isObservable(tree.items[0])).toBe(true);

			// Assign a NEW element
			tree.items[1] = { id: 2 };

			// New assignment is NOT auto-wrapped (normal shallow behavior)
			expect(isObservable(tree.items[1])).toBe(false);
		});
	});

	describe("edge cases", () => {
		test("primitives pass through unchanged", () => {
			expect(toObservableTree(42)).toBe(42);
			expect(toObservableTree("hello")).toBe("hello");
			expect(toObservableTree(true)).toBe(true);
			expect(toObservableTree(null)).toBe(null);
			expect(toObservableTree(undefined)).toBe(undefined);
		});

		test("empty object is observable", () => {
			const tree = toObservableTree({});
			expect(isObservable(tree)).toBe(true);
		});

		test("empty array is observable", () => {
			const tree = toObservableTree([]);
			expect(isObservable(tree)).toBe(true);
		});

		test("null-prototype objects are supported (plain object semantics)", () => {
			const raw = Object.create(null) as { nested?: { value: number } };
			raw.nested = { value: 1 };

			const tree = toObservableTree(raw);
			expect(isObservable(tree)).toBe(true);

			let count = 0;
			let captured = 0;
			effect(() => {
				captured = tree.nested!.value;
				count++;
			});

			expect(count).toBe(1);
			expect(captured).toBe(1);

			tree.nested = { value: 2 };
			expect(count).toBe(2);
			expect(captured).toBe(2);
		});
	});

	describe("shared references (DAG)", () => {
		test("shared object reference is allowed and both paths are observable", () => {
			const shared = { x: 1 };
			const tree = toObservableTree({ a: shared, b: shared });

			// Both paths should be observable
			expect(isObservable(tree.a)).toBe(true);
			expect(isObservable(tree.b)).toBe(true);

			// They should point to the same underlying source
			expect(source(tree.a)).toBe(source(tree.b));

			// Mutations through one path affect both
			let countA = 0;
			let countB = 0;
			effect(() => {
				tree.a.x;
				countA++;
			});
			effect(() => {
				tree.b.x;
				countB++;
			});

			expect(countA).toBe(1);
			expect(countB).toBe(1);

			tree.a.x = 2;
			expect(countA).toBe(2);
			expect(countB).toBe(2);
			expect(tree.b.x).toBe(2);
		});

		test("shared array reference is allowed", () => {
			const shared = [1, 2, 3];
			const tree = toObservableTree({ a: shared, b: shared });

			expect(isObservable(tree.a)).toBe(true);
			expect(isObservable(tree.b)).toBe(true);
			expect(source(tree.a)).toBe(source(tree.b));
		});

		test("diamond-shaped DAG is allowed", () => {
			const leaf = { value: 1 };
			const left = { leaf };
			const right = { leaf };
			const tree = toObservableTree({ left, right });

			expect(isObservable(tree.left.leaf)).toBe(true);
			expect(isObservable(tree.right.leaf)).toBe(true);
			expect(source(tree.left.leaf)).toBe(source(tree.right.leaf));
		});
	});

	describe("cycle detection", () => {
		test("self-referential object throws with path", () => {
			const o: any = {};
			o.self = o;

			expect(() => toObservableTree(o)).toThrow(/circular references/i);
			expect(() => toObservableTree(o)).toThrow(/path "self"/);
		});

		test("mutual cycle throws with path", () => {
			const a: any = {};
			const b: any = { a };
			a.b = b;

			expect(() => toObservableTree(a)).toThrow(/circular references/i);
			expect(() => toObservableTree(a)).toThrow(/path "b\.a"/);
		});

		test("array cycle throws with path", () => {
			const arr: any[] = [];
			arr[0] = arr;

			expect(() => toObservableTree(arr)).toThrow(/circular references/i);
			expect(() => toObservableTree(arr)).toThrow(/path "\[0\]"/);
		});

		test("deep nested cycle throws with path", () => {
			const root: any = {
				user: {
					profile: {},
				},
			};
			root.user.profile.parent = root.user;

			expect(() => toObservableTree(root)).toThrow(/circular references/i);
			expect(() => toObservableTree(root)).toThrow(
				/path "user\.profile\.parent"/
			);
		});

		test("cycle in nested array throws with correct path", () => {
			const root: any = {
				items: [{ nested: {} }],
			};
			root.items[0].nested.cycle = root.items;

			expect(() => toObservableTree(root)).toThrow(/circular references/i);
			expect(() => toObservableTree(root)).toThrow(
				/path "items\[0\]\.nested\.cycle"/
			);
		});
	});
});
