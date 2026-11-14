import {
	Model,
	id,
	modelRef,
	child,
	toSnapshot,
	applySnapshot,
	onSnapshot,
	onSnapshotDiff,
	isObservable,
	observable,
	signal,
} from "../src/index";

describe("snapshot serialization rules", () => {
	test("preserves JavaScript primitive values for application codecs", () => {
		class M extends Model {
			missing: unknown = undefined;
			notANumber = Number.NaN;
			positiveInfinity = Infinity;
			negativeInfinity = -Infinity;
		}

		const m = M.create();
		const snapshot = toSnapshot(m);

		expect(snapshot.missing).toBeUndefined();
		expect(snapshot.notANumber).toBeNaN();
		expect(snapshot.positiveInfinity).toBe(Infinity);
		expect(snapshot.negativeInfinity).toBe(-Infinity);
	});

	test("does not report unchanged NaN state in snapshot diffs", () => {
		class M extends Model {
			notANumber = Number.NaN;
			count = 0;
		}

		const m = M.create();
		const diffs: unknown[] = [];
		const stop = onSnapshotDiff(m, (diff) => diffs.push(diff));

		m.count = 1;

		expect(diffs).toEqual([
			{
				undo: { count: 0 },
				redo: { count: 1 },
			},
		]);
		stop();
	});

	test("serializes an unresolved model ref as null", () => {
		class Item extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(Item) items: Item[] = [];
			@modelRef(Item) selected?: Item;
		}

		const root = Root.create();
		const snapshot = toSnapshot(root);

		expect(snapshot).toEqual({ items: [], selected: null });
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(() => applySnapshot(root, snapshot)).not.toThrow();
		expect(root.selected).toBeUndefined();
	});

	test("round-trips null child snapshots without creating a child", () => {
		class Child extends Model {}
		class Root extends Model {
			@child(Child) child: Child | null = null;
		}

		const root = Root.create();
		const snapshot = JSON.parse(JSON.stringify(toSnapshot(root)));

		expect(snapshot).toEqual({ child: null });
		expect(() => applySnapshot(root, snapshot)).not.toThrow();
		expect(root.child).toBeNull();
	});

	test("diffs transitions to and from a null child snapshot", () => {
		class Child extends Model {
			value = 1;
		}
		class Root extends Model {
			@child(Child) child: Child | null = null;
		}

		const root = Root.create();
		const diffs: unknown[] = [];
		const stop = onSnapshotDiff(root, (diff) => diffs.push(diff));

		root.child = Child.create();
		root.child = null;

		expect(diffs).toEqual([
			{
				undo: { child: null },
				redo: { child: { value: 1 } },
			},
			{
				undo: { child: { value: 1 } },
				redo: { child: null },
			},
		]);
		stop();
	});

	test("round-trips null snapshots for child types with identifiers", () => {
		class Child extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(Child) child: Child | null = null;
		}

		const root = Root.create();
		const snapshot = JSON.parse(JSON.stringify(toSnapshot(root)));

		expect(snapshot).toEqual({ child: null });
		expect(() => applySnapshot(root, snapshot)).not.toThrow();
		expect(root.child).toBeNull();
	});

	test("preserves unresolved model ref ids in snapshots", () => {
		class Item extends Model {
			@id id!: number;
		}
		class Root extends Model {
			@child(Item) items = [Item.create({ id: 1 })];
			@modelRef(Item) selected: Item | undefined = this.items[0];
		}

		const root = Root.create();
		const selected = root.items[0];
		root.items = [];

		expect(root.selected).toBeUndefined();
		expect(toSnapshot(root)).toEqual({
			items: [],
			selected: { id: 1 },
		});

		root.items = [selected];
		expect(root.selected).toBe(selected);
	});

	describe("Date serialization", () => {
		test("Date serializes to ISO string in snapshots", () => {
			class M extends Model {
				createdAt: Date = new Date("2024-01-15T10:30:00.000Z");
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.createdAt).toBe("2024-01-15T10:30:00.000Z");
			expect(typeof snapshot.createdAt).toBe("string");
		});

		test("Date state hydrates back into the runtime Date shape", () => {
			class M extends Model {
				createdAt = new Date("2024-01-15T10:30:00.000Z");
				nested = {
					updatedAt: new Date("2024-01-16T10:30:00.000Z"),
				};
			}

			const m = M.create();
			applySnapshot(m, {
				createdAt: "2025-02-01T12:00:00.000Z",
				nested: { updatedAt: "2025-02-02T12:00:00.000Z" },
			});

			expect(m.createdAt).toBeInstanceOf(Date);
			expect(m.createdAt.toISOString()).toBe("2025-02-01T12:00:00.000Z");
			expect(m.nested.updatedAt).toBeInstanceOf(Date);
			expect(m.nested.updatedAt.toISOString()).toBe("2025-02-02T12:00:00.000Z");
		});

		test("observable Date state remains observable after hydration", () => {
			class M extends Model {
				createdAt = observable(new Date("2024-01-15T10:30:00.000Z"));
			}

			const m = M.create();
			applySnapshot(m, {
				createdAt: "2025-02-01T12:00:00.000Z",
			});

			expect(isObservable(m.createdAt)).toBe(true);

			const snapshots: unknown[] = [];
			const stop = onSnapshot(m, (snapshot) => snapshots.push(snapshot));

			m.createdAt.setUTCFullYear(2026);

			expect(snapshots).toEqual([{ createdAt: "2026-02-01T12:00:00.000Z" }]);
			expect(toSnapshot(m)).toEqual({
				createdAt: "2026-02-01T12:00:00.000Z",
			});
			stop();
		});

		test("Date in nested object serializes to ISO string", () => {
			class M extends Model {
				data = { timestamp: new Date("2024-06-20T15:00:00.000Z") };
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({
				timestamp: "2024-06-20T15:00:00.000Z",
			});
		});

		test("Date in array serializes to ISO string", () => {
			class M extends Model {
				dates: Date[] = [
					new Date("2024-01-01T00:00:00.000Z"),
					new Date("2024-12-31T23:59:59.999Z"),
				];
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.dates).toEqual([
				"2024-01-01T00:00:00.000Z",
				"2024-12-31T23:59:59.999Z",
			]);
		});

		test("Date array hydration preserves the element shape when the array grows", () => {
			class M extends Model {
				dates = [new Date("2024-01-01T00:00:00.000Z")];
			}

			const m = M.create({
				dates: ["2025-01-01T00:00:00.000Z", "2025-01-02T00:00:00.000Z"],
			});

			expect(m.dates).toHaveLength(2);
			expect(m.dates.every((date) => date instanceof Date)).toBe(true);
			expect(m.dates.map((date) => date.toISOString())).toEqual([
				"2025-01-01T00:00:00.000Z",
				"2025-01-02T00:00:00.000Z",
			]);
		});
	});

	describe("Signal serialization", () => {
		test("signals serialize to their current .value in snapshots", () => {
			class M extends Model {
				count = signal(42);
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.count).toBe(42);
			expect(typeof snapshot.count).toBe("number");
		});

		test("Signal array hydration preserves distinct elements when the array grows", () => {
			class M extends Model {
				counts = [signal(0)];
			}

			const m = M.create({ counts: [1, 2] });

			expect(m.counts).toHaveLength(2);
			expect(m.counts[0]).not.toBe(m.counts[1]);
			expect(m.counts.map((count) => count.value)).toEqual([1, 2]);
		});

		test("signal with object value serializes the object", () => {
			class M extends Model {
				data = signal({ nested: { value: 123 } });
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({ nested: { value: 123 } });
		});

		test("signal with array value serializes the array", () => {
			class M extends Model {
				items = signal([1, 2, 3]);
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.items).toEqual([1, 2, 3]);
		});

		test("signal with Date value serializes to ISO string", () => {
			class M extends Model {
				when = signal(new Date("2024-03-15T12:00:00.000Z"));
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.when).toBe("2024-03-15T12:00:00.000Z");
		});
	});

	describe("Non-plain object rejection", () => {
		test("Map field fails during creation", () => {
			class M extends Model {
				data = new Map([["key", "value"]]);
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support Map at path "data"/
			);
		});

		test("Set field fails during creation", () => {
			class M extends Model {
				items = new Set([1, 2, 3]);
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support Set at path "items"/
			);
		});

		test("WeakMap field fails during creation", () => {
			class M extends Model {
				cache = new WeakMap();
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support WeakMap at path "cache"/
			);
		});

		test("WeakSet field fails during creation", () => {
			class M extends Model {
				visited = new WeakSet();
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support WeakSet at path "visited"/
			);
		});

		test("class instance field fails during creation", () => {
			class CustomClass {
				value = 42;
			}

			class M extends Model {
				instance = new CustomClass();
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support class instance \(CustomClass\) at path "instance"/
			);
		});

		test("nested Map throws with correct path", () => {
			class M extends Model {
				data = { level1: { level2: new Map() } };
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support Map at path "data\.level1\.level2"/
			);
		});

		test("Map in array throws with correct path", () => {
			class M extends Model {
				items: any[] = [{ nested: new Map() }];
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support Map at path "items\[0\]\.nested"/
			);
		});

		test("RegExp field fails during creation", () => {
			class M extends Model {
				pattern = /test/gi;
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support RegExp at path "pattern"/
			);
		});

		test("Error field fails during creation", () => {
			class M extends Model {
				lastError = new Error("oops");
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support Error at path "lastError"/
			);
		});
	});

	describe("Unsupported primitive rejection", () => {
		test("bigint field fails during creation", () => {
			class M extends Model {
				id = 1n;
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support bigint at path "id"/
			);
		});

		test("symbol field fails during creation", () => {
			class M extends Model {
				token = Symbol("t");
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support symbol at path "token"/
			);
		});

		test("function field fails during creation", () => {
			class M extends Model {
				fn = () => 1;
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support function at path "fn"/
			);
		});
	});

	describe("Valid snapshot values", () => {
		test("plain objects are allowed", () => {
			class M extends Model {
				data = { a: 1, b: { c: 2 } };
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({ a: 1, b: { c: 2 } });
		});

		test("arrays are allowed", () => {
			class M extends Model {
				items = [1, "two", { three: 3 }];
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.items).toEqual([1, "two", { three: 3 }]);
		});

		test("primitives are allowed", () => {
			class M extends Model {
				str = "hello";
				num = 42;
				bool = true;
				nil: null = null;
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.str).toBe("hello");
			expect(snapshot.num).toBe(42);
			expect(snapshot.bool).toBe(true);
			expect(snapshot.nil).toBe(null);
		});

		test("null prototype objects are allowed", () => {
			class M extends Model {
				data = Object.create(null);
			}

			const m = M.create();
			m.data.key = "value";
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({ key: "value" });
		});
	});
});
