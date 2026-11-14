import {
	Model,
	id,
	transient,
	toSnapshot,
	applySnapshot,
	onSnapshot,
	computed,
	effect,
	isObservable,
	observable,
	signal,
} from "../src/index";

test("can create a model", () => {
	class M extends Model {}

	const model = M.create();

	expect(model instanceof Model).toBe(true);
});

test("ordinary Model fields are snapshotted and transient fields are excluded", () => {
	class M extends Model {
		title = "saved";
		@transient cache = observable(new Map<string, number>());
	}

	const model = M.create();
	model.cache.set("runtime", 1);

	expect(toSnapshot(model)).toEqual({ title: "saved" });
});

test("unsupported implicit Model fields fail during creation", () => {
	class M extends Model {
		cache = new Map<string, number>();
	}

	expect(() => M.create()).toThrow(
		/snapshots do not support Map.*cache.*Mark runtime-only Model fields with @transient/
	);
});

test("named factories can prepare input before creating a model", () => {
	class Item extends Model {
		@id id?: number;
		title = "";

		static fromTitle(title = "new") {
			return this.create({ id: 1, title: title.trim() });
		}
	}

	const item = Item.fromTitle("  hello  ");
	expect({ id: item.id, title: item.title }).toEqual({ id: 1, title: "hello" });
	expect(Item.fromTitle().title).toBe("new");
});

test("direct new calls are disallowed", () => {
	class M extends Model {}
	expect(() => new M()).toThrowErrorMatchingInlineSnapshot(
		`[Error: r-state-tree: Can't initialize model directly, use \`M.create()\` instead]`
	);
});

// Ordinary Model fields are shallow-reactive and participate in snapshots by default.
// Their values are not deep-wrapped. Treat plain objects/arrays as immutable, or
// store `observable()` containers / `signal()` values if you need in-place mutation + snapshot updates.
describe("implicit Model snapshot fields", () => {
	test("fields are reactive on assignment (property-level)", () => {
		class M extends Model {
			title = "a";
			setTitle(t: string) {
				this.title = t;
			}
		}

		const m = M.create();
		let count = 0;

		effect(() => {
			m.title;
			count++;
		});

		m.setTitle("b");
		expect(count).toBe(2);
	});

	test("toSnapshot updates after assignment (no stale cache)", () => {
		class M extends Model {
			title = "a";
			setTitle(t: string) {
				this.title = t;
			}
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ title: "a" });
		m.setTitle("b");
		expect(toSnapshot(m)).toStrictEqual({ title: "b" });
	});

	test("observable() container mutations update snapshots", () => {
		class M extends Model {
			items: { value: number }[] = observable([]);
			addItem(value: number) {
				this.items.push({ value });
			}
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ items: [] });
		m.addItem(1);
		expect(toSnapshot(m)).toStrictEqual({ items: [{ value: 1 }] });

		// Items are NOT wrapped (shallow behavior)
		expect(isObservable(m.items[0])).toBe(false);
	});

	test("nested observable() containers update snapshots on deep mutation", () => {
		class M extends Model {
			data = observable({ nested: observable({ value: 1 }) });
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ data: { nested: { value: 1 } } });
		m.data.nested.value++;
		expect(toSnapshot(m)).toStrictEqual({ data: { nested: { value: 2 } } });
	});

	test("signal() serializes current value and stays up to date", () => {
		class M extends Model {
			count = signal(0);
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ count: 0 });
		m.count.value = 1;
		expect(toSnapshot(m)).toStrictEqual({ count: 1 });
	});

	test("raw in-place mutation does NOT trigger onSnapshot; reassignment does", () => {
		class M extends Model {
			tags: string[] = [];

			pushTag(tag: string) {
				this.tags.push(tag); // in-place
			}

			reassignTags(tags: string[]) {
				this.tags = tags;
			}
		}

		const m = M.create();
		const snapshots: any[] = [];
		const off = onSnapshot(m, (snap) => snapshots.push(snap));

		// In-place mutation: onSnapshot does NOT fire
		m.pushTag("a");
		expect(snapshots.length).toBe(0);

		// toSnapshot also returns the stale cached snapshot (from when listener was set up)
		// because the snapshot is a memoized computed and no reactive dependencies changed
		expect(toSnapshot(m)).toStrictEqual({ tags: [] });

		// Reassignment: onSnapshot fires and cache is invalidated
		m.reassignTags(["a", "b"]);
		expect(snapshots.length).toBe(1);
		expect(snapshots[0]).toStrictEqual({ tags: ["a", "b"] });

		// Now toSnapshot reflects the new value
		expect(toSnapshot(m)).toStrictEqual({ tags: ["a", "b"] });

		off();
	});

	test("observable() container triggers onSnapshot on mutation", () => {
		class M extends Model {
			items: { id: number }[] = observable([]);

			addItem(id: number) {
				this.items.push({ id });
			}
		}

		const m = M.create();
		const snapshots: any[] = [];
		const off = onSnapshot(m, (snap) => snapshots.push(snap));

		m.addItem(1);
		expect(snapshots.length).toBe(1);
		expect(snapshots[0]).toStrictEqual({ items: [{ id: 1 }] });

		m.addItem(2);
		expect(snapshots.length).toBe(2);
		expect(snapshots[1]).toStrictEqual({ items: [{ id: 1 }, { id: 2 }] });

		off();
	});

	test("applying an unchanged observable array snapshot does not emit", () => {
		class M extends Model {
			items: number[] = observable([1, 2]);
		}

		const m = M.create();
		const snapshot = toSnapshot(m);
		const snapshots: unknown[] = [];
		const stop = onSnapshot(m, (nextSnapshot) => snapshots.push(nextSnapshot));

		applySnapshot(m, snapshot);

		expect(snapshots).toEqual([]);
		stop();
	});

	test("state is included in snapshots", () => {
		class M extends Model {
			items: { value: number }[] = [];

			addItem(value: number) {
				this.items.push({ value });
			}
		}

		const m = M.create();
		m.addItem(1);
		m.addItem(2);

		const snapshot = toSnapshot(m);
		expect(snapshot.items).toEqual([{ value: 1 }, { value: 2 }]);
	});

	test("state can be restored from snapshot", () => {
		class M extends Model {
			items: { value: number }[] = [];
		}

		const m = M.create();
		applySnapshot(m, { items: [{ value: 1 }, { value: 2 }] });

		expect(m.items).toEqual([{ value: 1 }, { value: 2 }]);
		// Items are NOT wrapped (shallow behavior)
		expect(isObservable(m.items[0])).toBe(false);
	});

	test("invalidates changed raw state after in-place hydration without replacing it", () => {
		class M extends Model {
			settings = { theme: "light" };

			@computed get theme() {
				return this.settings.theme;
			}
		}

		const m = M.create();
		const settings = m.settings;
		const snapshots: unknown[] = [];
		const stop = onSnapshot(m, (snapshot) => snapshots.push(snapshot));

		expect(m.theme).toBe("light");

		applySnapshot(m, { settings: { theme: "dark" } });

		expect(m.settings).toBe(settings);
		expect(m.theme).toBe("dark");
		expect(snapshots).toEqual([{ settings: { theme: "dark" } }]);

		applySnapshot(m, { settings: { theme: "dark" } });

		expect(snapshots).toHaveLength(1);
		stop();
	});

	test("state allows structuredClone of values", () => {
		class M extends Model {
			data: { value: number } = { value: 1 };
		}

		const m = M.create();

		// Should NOT throw - values are plain objects
		expect(() => structuredClone(m.data)).not.toThrow();
	});
});
