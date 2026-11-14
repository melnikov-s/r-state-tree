import {
	Model,
	id,
	modelRef,
	child,
	transient,
	toSnapshot,
	onSnapshot,
	applySnapshot,
	effect,
	findModelById,
} from "../src/index";

describe("model identifiers", () => {
	test("identifiers can't be set to undefined once assigned", () => {
		class M extends Model {
			@id id = 1;

			clearId() {
				this.id = undefined as any;
			}
		}

		class MP extends Model {
			@child m = M.create();
		}

		const mp = MP.create();
		expect(() => mp.m.clearId()).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree can't clear an id once it has already been set.]`
		);
	});

	test("same id can't be assigned to different models", () => {
		class M extends Model {
			@id id = 0;
		}

		class MP extends Model {
			@child ms = [M.create()];

			add() {
				this.ms.push(M.create());
			}
		}

		const mp = MP.create();
		expect(() => mp.add()).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: id: 0 is already assigned to another model]`
		);
	});

	test("identifiers can be re-assigned after init", () => {
		class M extends Model {
			@id id = 1;

			setId() {
				this.id = 2;
			}
		}

		class MP extends Model {
			@child m = M.create();
			@modelRef(M) mr: M = this.m;
		}

		const mp = MP.create();
		// With shallow behavior, use deep equality for Model comparisons
		expect(mp.m).toStrictEqual(mp.mr);
		mp.m.setId();
		expect(mp.mr).toBe(undefined);
	});

	test("correct id shows up in snapshot after being re-assigned", () => {
		class M extends Model {
			@id myId = 1;
			test = "me";

			setId() {
				this.myId = 2;
			}
		}

		class MP extends Model {
			@child m = M.create();
			@modelRef(M) mr: M = this.m;
		}

		const mp = MP.create();
		const before = toSnapshot(mp);
		const childBefore = toSnapshot(mp.m);
		mp.m.setId();
		expect(toSnapshot(mp)).not.toBe(before);
		expect(toSnapshot(mp.m)).not.toBe(childBefore);
		expect(before.m!.myId).toBe(1);
		expect(childBefore.myId).toBe(1);
		expect(toSnapshot(mp)).toStrictEqual({
			m: { myId: 2, test: "me" },
			mr: { myId: 1 },
		});
	});

	test.each(["assignment", "snapshot"] as const)(
		"identifier %s updates effects, indexes and warmed snapshots atomically",
		(mode) => {
			class Item extends Model {
				@id id = 1;
			}
			class Root extends Model {
				@child(Item) item = Item.create();
				@modelRef(Item) ref: Item = this.item;
			}

			const root = Root.create();
			const item = root.item;
			const before = toSnapshot(root);
			const childBefore = toSnapshot(item);
			const ids: number[] = [];
			const states: unknown[] = [];
			const childSnapshots: unknown[] = [];
			const rootSnapshots: unknown[] = [];
			const stopId = effect(() => {
				ids.push(item.id);
			});
			const stopState = effect(() => {
				states.push({
					id: item.id,
					oldLookup: findModelById(root, Item, 1),
					newLookup: findModelById(root, Item, 2),
					ref: root.ref,
					snapshotId: toSnapshot(root).item!.id,
				});
			});
			const stopChild = onSnapshot(item, (snapshot) =>
				childSnapshots.push(snapshot)
			);
			const stopRoot = onSnapshot(root, (snapshot) =>
				rootSnapshots.push(snapshot)
			);
			const changeId = (id: number) => {
				if (mode === "assignment") item.id = id;
				else applySnapshot(item, { id });
			};

			try {
				changeId(2);
				expect(ids).toEqual([1, 2]);
				expect(states).toEqual([
					{
						id: 1,
						oldLookup: item,
						newLookup: undefined,
						ref: item,
						snapshotId: 1,
					},
					{
						id: 2,
						oldLookup: undefined,
						newLookup: item,
						ref: undefined,
						snapshotId: 2,
					},
				]);
				expect(toSnapshot(item)).toEqual({ id: 2 });
				expect(toSnapshot(root)).toEqual({ item: { id: 2 }, ref: { id: 1 } });
				expect(toSnapshot(item)).not.toBe(childBefore);
				expect(toSnapshot(root)).not.toBe(before);
				expect(childBefore).toEqual({ id: 1 });
				expect(before).toEqual({ item: { id: 1 }, ref: { id: 1 } });
				expect(childSnapshots).toEqual([toSnapshot(item)]);
				expect(rootSnapshots).toEqual([toSnapshot(root)]);

				const after = toSnapshot(root);
				const childAfter = toSnapshot(item);
				changeId(2);
				expect(toSnapshot(root)).toBe(after);
				expect(toSnapshot(item)).toBe(childAfter);
				expect(ids).toEqual([1, 2]);
				expect(states).toHaveLength(2);
				expect(childSnapshots).toHaveLength(1);
				expect(rootSnapshots).toHaveLength(1);
			} finally {
				stopId();
				stopState();
				stopChild();
				stopRoot();
			}
		}
	);

	test("undefined identifiers initialize an own field before assignment", () => {
		class Item extends Model {
			@id id?: number;
		}

		const item = Item.create();
		expect(Object.hasOwn(item, "id")).toBe(true);
		expect(item.id).toBeUndefined();
		expect(toSnapshot(item)).toEqual({ id: undefined });

		item.id = 1;
		expect(item.id).toBe(1);
		expect(toSnapshot(item)).toEqual({ id: 1 });
	});

	test("identifiers can be assigned by a named factory", () => {
		class M extends Model {
			@id id!: any;

			static new() {
				return this.create({ id: 1 });
			}
		}

		const m = M.new();
		expect(m.id).toBe(1);
	});

	test("identifiers can be re-assigned in a snapshot", () => {
		class M extends Model {
			@id id = 1;
			badAction() {
				this.id++;
			}
		}

		expect(() => M.create({ id: 1 })).not.toThrowError();
		expect(() => M.create({ id: 2 })).not.toThrowError();
	});
});

describe("model references", () => {
	test("modelRef requires an explicit model constructor", () => {
		expect(() => {
			class Invalid extends Model {
				@(modelRef as any) ref!: Model;
			}
			return Invalid;
		}).toThrow("@modelRef requires a model constructor");

		class InvalidStatic extends Model {
			ref!: Model;
			static types = { ref: modelRef };
		}
		expect(() => InvalidStatic.create()).toThrow(
			"modelRef requires a model constructor"
		);
	});

	test("modelRef rejects a model outside its declared type", () => {
		class User extends Model {
			@id id = 1;
		}
		class Project extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) user = User.create();
			@child(Project) project = Project.create();
			@modelRef(User) ref!: User;
		}

		const root = Root.create();
		expect(() => (root.ref = root.project as unknown as User)).toThrow(
			"must reference User"
		);
	});

	test("findModelById exposes typed tree-scoped lookup", () => {
		class User extends Model {
			@id id = 1;
		}
		class Project extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) user: User | null = User.create();
			@child(Project) project = Project.create();
		}

		const root = Root.create();
		expect(findModelById(root, User, 1)).toBe(root.user);
		expect(findModelById(root, Project, 1)).toBe(root.project);
		expect(findModelById(root, User, 2)).toBe(undefined);
	});

	test.each(["array", "scalar", "identifier"] as const)(
		"findModelById observes the first identifier via %s",
		(attachment) => {
			class Item extends Model {
				@id id!: number;
			}
			class List extends Model {
				@child(Item) items: Item[] = [];
				@child(Item) item: Item | null = null;
			}

			const list = List.create();
			const item = Item.create();
			if (attachment === "identifier") list.items.push(item);
			const seen: boolean[] = [];
			const stop = effect(() => {
				seen.push(Boolean(findModelById(list, Item, 1)));
			});
			try {
				item.id = 1;
				if (attachment === "array") list.items.push(item);
				if (attachment === "scalar") list.item = item;

				expect(findModelById(list, Item, 1)).toBe(item);
				expect(seen).toEqual([false, true]);
			} finally {
				stop();
			}
		}
	);

	test("typed references observe the first identified child attachment", () => {
		class Item extends Model {
			@id id = 1;
		}
		class List extends Model {
			@child(Item) items: Item[] = [];
			@modelRef(Item) selected?: Item;
			@modelRef(Item) selections: Item[] = [];
		}

		const list = List.create({
			selected: { id: 1 },
			selections: [{ id: 1 }],
		});
		const seen: boolean[] = [];
		const lengths: number[] = [];
		const stopScalar = effect(() => {
			seen.push(Boolean(list.selected));
		});
		const stopArray = effect(() => {
			lengths.push(list.selections.length);
		});
		try {
			const item = Item.create();
			list.items.push(item);
			expect(seen).toEqual([false, true]);
			expect(lengths).toEqual([0, 1]);
			expect(list.selected).toBe(item);
			expect(list.selections).toEqual([item]);

			list.items.pop();
			expect(seen).toEqual([false, true, false]);
			expect(lengths).toEqual([0, 1, 0]);
			list.items.push(item);
			expect(seen).toEqual([false, true, false, true]);
			expect(lengths).toEqual([0, 1, 0, 1]);
		} finally {
			stopScalar();
			stopArray();
		}
	});

	test.each(["direct", "effect"] as const)(
		"findModelById follows nested descendant ancestry in %s lookups",
		(mode) => {
			class Item extends Model {
				@id id = 1;
			}
			class Leaf extends Model {}
			class Branch extends Model {
				@child(Leaf) leaf = Leaf.create();
			}
			class Root extends Model {
				@child(Item) item = Item.create();
				@child(Branch) branch: Branch | null = null;
			}

			const first = Root.create();
			const second = Root.create();
			const branch = Branch.create();
			const leaf = branch.leaf;
			let resolved: Item | undefined;
			const lookup = () => findModelById(leaf, Item, 1);
			const stop =
				mode === "effect"
					? effect(() => {
							resolved = lookup();
						})
					: () => {};
			const read = mode === "effect" ? () => resolved : lookup;
			try {
				expect(read()).toBe(undefined);
				first.branch = branch;
				expect(read()).toBe(first.item);
				first.branch = null;
				expect(read()).toBe(undefined);
				second.branch = branch;
				expect(read()).toBe(second.item);
				second.branch = null;
				expect(read()).toBe(undefined);
			} finally {
				stop();
			}
		}
	);

	test("findModelById excludes the tree root but includes an attached supplied model", () => {
		class Item extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@id id = 1;
			@child(Item) item = Item.create();
		}

		const detached = Item.create();
		expect(findModelById(detached, Item, 1)).toBe(undefined);
		const root = Root.create();
		expect(findModelById(root, Root, 1)).toBe(undefined);
		expect(findModelById(root.item, Root, 1)).toBe(undefined);
		expect(findModelById(root.item, Item, 1)).toBe(root.item);
	});

	test("findModelById tracks id mutation and detachment reactively", () => {
		class User extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) user: User | null = User.create();
		}

		const root = Root.create();
		const user = root.user!;
		let byOne: User | undefined;
		let byTwo: User | undefined;
		const dispose = effect(() => {
			byOne = findModelById(root, User, 1);
			byTwo = findModelById(root, User, 2);
		});

		expect(byOne).toBe(user);
		expect(byTwo).toBe(undefined);
		user.id = 2;
		expect(byOne).toBe(undefined);
		expect(byTwo).toBe(user);
		root.user = null;
		expect(byTwo).toBe(undefined);
		dispose();
	});

	test("ids and typed references are namespaced by exact model type", () => {
		class User extends Model {
			@id id = 1;
		}
		class Project extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) users = [User.create()];
			@child(Project) projects = [Project.create()];
			@modelRef(User) user!: User;
			@modelRef(Project) project!: Project;
			@modelRef(User) userList: User[] = [];

			setRefs() {
				this.user = this.users[0];
				this.project = this.projects[0];
				this.userList = [this.users[0]];
			}
		}

		const root = Root.create();
		root.setRefs();
		expect(root.user).toBe(root.users[0]);
		expect(root.project).toBe(root.projects[0]);
		expect(root.userList).toEqual([root.users[0]]);
	});

	test("failed same-type id mutation preserves both mappings", () => {
		class User extends Model {
			@id id!: number;
		}
		class Root extends Model {
			@child(User) users = [User.create({ id: 1 }), User.create({ id: 2 })];
			@modelRef(User) first: User = this.users[0];
			@modelRef(User) second: User = this.users[1];
		}

		const root = Root.create();
		expect(() => (root.users[0].id = 2)).toThrow();
		expect(root.users[0].id).toBe(1);
		expect(root.first).toBe(root.users[0]);
		expect(root.second).toBe(root.users[1]);
	});

	test("typed reference reacts when an identifier changes", () => {
		class User extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) user = User.create();
			@modelRef(User) ref: User = this.user;
		}

		const root = Root.create();
		let resolved: User | undefined;
		const dispose = effect(() => {
			resolved = root.ref;
		});
		expect(resolved).toBe(root.user);
		root.user.id = 2;
		expect(resolved).toBe(undefined);
		dispose();
	});

	test("snapshot reconciliation uses the declared child type with overlapping ids", () => {
		class User extends Model {
			@id id!: number;
			name = "";
		}
		class Project extends Model {
			@id id!: number;
		}
		class Root extends Model {
			@child(User) users = [User.create({ id: 1, name: "old" })];
			@child(Project) projects = [Project.create({ id: 1 })];
		}

		const root = Root.create();
		const user = root.users[0];
		applySnapshot(root, { users: [{ id: 1, name: "new" }] });
		expect(root.users[0]).toBe(user);
		expect(root.users[0].name).toBe("new");
	});

	test("snapshot loading rejects duplicate ids of the same child type", () => {
		class User extends Model {
			@id id!: number;
		}
		class Root extends Model {
			@child(User) users: User[] = [];
		}

		const root = Root.create();
		expect(() =>
			applySnapshot(root, { users: [{ id: 1 }, { id: 1 }] })
		).toThrow("duplicate ids");
		expect(root.users).toEqual([]);
	});

	test("typed references do not resolve an overlapping id from another model type", () => {
		class User extends Model {
			@id id = 1;
		}
		class Project extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(Project) projects = [Project.create()];
			@child(User) users = [User.create()];
			@modelRef(User) ref: User = this.users[0];
		}

		const root = Root.create();
		expect(root.ref).toBe(root.users[0]);
	});

	test("failed attachment rolls back the child collection", () => {
		class User extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) users = [User.create()];
		}

		const root = Root.create();
		const original = root.users[0];
		const duplicate = User.create();

		expect(() => root.users.push(duplicate)).toThrow();
		expect(root.users).toEqual([original]);
		expect(original.parent).toBe(root);
		expect(duplicate.parent).toBe(null);
	});

	test("failed snapshot application rolls back changes across child properties", () => {
		class User extends Model {
			@id id!: number;
		}
		class Root extends Model {
			@child(User) first: User[] = [];
			@child(User) second: User[] = [];
		}

		const root = Root.create();
		expect(() =>
			applySnapshot(root, {
				first: [{ id: 1 }],
				second: [{ id: 1 }],
			})
		).toThrow("already assigned");
		expect(root.first).toEqual([]);
		expect(root.second).toEqual([]);
	});

	test("failed snapshot application does not notify snapshot observers", () => {
		class User extends Model {
			@id id!: number;
		}
		class Root extends Model {
			value = 0;
			@child(User) first: User[] = [];
			@child(User) second: User[] = [];
		}

		const root = Root.create();
		const observedValues: number[] = [];
		const stop = onSnapshot(root, (snapshot) => {
			observedValues.push(snapshot.value!);
		});

		try {
			expect(() =>
				applySnapshot(root, {
					value: 99,
					first: [{ id: 1 }],
					second: [{ id: 1 }],
				})
			).toThrow("already assigned");

			expect(toSnapshot(root)).toEqual({
				value: 0,
				first: [],
				second: [],
			});
			expect(observedValues).toEqual([]);
		} finally {
			stop();
		}
	});

	test("singular snapshot reconciliation uses the declared child type", () => {
		class User extends Model {
			@id id = 1;
			name = "";
		}
		class Project extends Model {
			@id id = 1;
			name = "";
		}
		class Root extends Model {
			@child(User) item: User = Project.create() as unknown as User;
		}

		const root = Root.create();
		applySnapshot(root, { item: { id: 1, name: "hydrated" } });
		expect(root.item).toBeInstanceOf(User);
		expect(root.item.name).toBe("hydrated");
	});

	test("references react when their owning model is detached and reparented", () => {
		class User extends Model {
			@id id = 1;
		}
		class Holder extends Model {
			@modelRef(User) ref!: User;

			setRef(user: User) {
				this.ref = user;
			}
		}
		class Root extends Model {
			@child(User) user = User.create();
			@child(Holder) holder: Holder | null = null;
		}

		const first = Root.create();
		const second = Root.create();
		const holder = Holder.create();
		first.holder = holder;
		holder.setRef(first.user);

		let resolved: User | undefined;
		const dispose = effect(() => {
			resolved = holder.ref;
		});
		expect(resolved).toBe(first.user);
		first.holder = null;
		expect(resolved).toBe(undefined);
		second.holder = holder;
		expect(resolved).toBe(second.user);
		dispose();
	});

	test("can assign a model to a reference", () => {
		class MC extends Model {
			@id id = 0;
		}

		class M extends Model {
			@child(MC) mc: MC = MC.create();
			@modelRef(MC) mr!: MC;

			setRef() {
				this.mr = this.mc;
			}
		}

		const m = M.create();
		m.setRef();
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mc).toStrictEqual(m.mr);
	});

	test("can't assing a model without an id to a reference", () => {
		class MC extends Model {}
		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef(MC) mr!: MC;

			setRef() {
				this.mr = this.mc;
			}
		}

		const m = M.create();
		expect(() => m.setRef()).toThrow();
	});

	test("model ref is not available until the referenced model is attached", () => {
		class MC extends Model {
			@id id = 1;
		}

		class M extends Model {
			@transient mctemp = MC.create({ id: 1 });
			@child mc: MC | null = null;
			@modelRef(MC) mr: MC = this.mctemp as any;

			setChild() {
				this.mc = this.mctemp;
			}
		}

		const m = M.create();
		expect(m.mr).toBe(undefined);
		m.setChild();
		expect(m.mr).toStrictEqual(m.mc);
	});

	test("model ref will become undefined when model is detached", () => {
		class MC extends Model {
			@id id = 0;
		}
		class M extends Model {
			@child(MC) mc: MC | null = MC.create();
			@modelRef(MC) mr!: MC | null;

			setRef() {
				this.mr = this.mc;
			}

			clearModel() {
				this.mc = null;
			}
		}

		const m = M.create();
		expect(m.mr).toBe(undefined);
		m.setRef();
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mc).toStrictEqual(m.mr);
		m.clearModel();
		expect(m.mr).toBe(undefined);
	});

	test("model ref will become undefined when model is detached (array)", () => {
		class MC extends Model {
			@id id: any;
		}

		class M extends Model {
			@child mc: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@modelRef(MC) mr!: MC;

			setRef() {
				this.mr = this.mc[0];
			}

			clearModel() {
				this.mc = [];
			}
		}

		const m = M.create();
		m.setRef();
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mc[0]).toStrictEqual(m.mr);
		m.clearModel();
		expect(m.mr).toBe(undefined);
	});

	test("model ref is reactive", () => {
		class MC extends Model {
			@id id: any;
		}
		class M extends Model {
			@child mc: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@modelRef(MC) mr!: MC;

			setModel(index: number) {
				this.mr = (index >= 0 ? this.mc[index] : undefined) as MC;
			}
		}

		const m = M.create();
		let current;

		effect(() => {
			current = m.mr;
		});

		expect(current).toBe(undefined);
		m.setModel(0);
		// With shallow behavior, use deep equality for Model comparisons
		expect(current).toStrictEqual(m.mc[0]);
		m.setModel(1);
		expect(current).toStrictEqual(m.mc[1]);
		m.setModel(-1);
		expect(current).toBe(undefined);
	});

	test("model ref is restored when model is re-attached", () => {
		class MC extends Model {
			@id id = 0;
		}
		class M extends Model {
			@child(MC) mc: MC | null = MC.create();
			@modelRef(MC) mr!: MC | null;
			_temp!: MC | null;

			setRef() {
				this.mr = this.mc;
			}

			clearModel() {
				this._temp = this.mc;
				this.mc = null;
			}

			resetModel() {
				this.mc = this._temp;
			}
		}

		const m = M.create();
		m.setRef();
		m.clearModel();
		expect(m.mr).toBe(undefined);
		expect(m.mc).toBe(null);
		m.resetModel();
		expect(m.mc).not.toBe(null);
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mr).toStrictEqual(m.mc);
	});

	test("model ref is NOT restored when model is re-attached to a another tree root", () => {
		let temp: MC | null = null;

		class MC extends Model {
			@id id = 0;
		}
		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef(MC) mr!: MC | null;
			setRef: boolean = false;

			clearModel() {
				temp = this.mc;
				this.mc = null as any;
			}

			resetModel() {
				this.mc = temp as any;
			}
		}

		const m1 = M.create({ setRef: true });
		const m2 = M.create();

		m1.clearModel();
		expect(m1.mr).toBe(undefined);
		expect(m1.mc).toBe(null);
		m2.resetModel();
		expect(m1.mr).toBe(undefined);
		expect(m1.mc).toBe(null);
	});
	test("model refs can be an array", () => {
		class MC extends Model {
			@id id: any;
		}
		class M extends Model {
			@child(MC) mc1: MC | null = MC.create({ id: 1 });
			@child(MC) mc2: MC | null = MC.create({ id: 2 });
			@modelRef(MC) mr: MC[] = [];
			_temp!: MC | null;

			setRef() {
				this.mr = [this.mc1!, this.mc2!];
			}

			clearModel1() {
				this.mc1 = null;
			}

			clearModel2() {
				this._temp = this.mc2;
				this.mc2 = null;
			}

			restoreModel2() {
				this.mc2 = this._temp;
			}
		}

		const m = M.create();
		m.setRef();
		expect(m.mr).toEqual([m.mc1, m.mc2]);
		m.clearModel1();
		expect(m.mr).toEqual([m.mc2]); // Filters out undefined
		m.clearModel2();
		expect(m.mr).toEqual([]); // Filters out all undefined
		m.restoreModel2();
		expect(m.mr).toEqual([m.mc2]); // Only valid models
	});
});
