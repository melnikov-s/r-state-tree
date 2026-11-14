import {
	Model,
	id,
	modelRef,
	child,
	toSnapshot,
	applySnapshot,
	reaction,
} from "../src/index";

describe("runtime type switching", () => {
	describe("child property switching", () => {
		test("can switch from single child to array of children", () => {
			class MC extends Model {
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];

				setSingle() {
					this.items = MC.create({ value: 1 });
				}

				setArray() {
					this.items = [MC.create({ value: 2 }), MC.create({ value: 3 })];
				}
			}

			const m = M.create();

			// Start with single
			m.setSingle();
			const oldItem = m.items as MC;
			expect(Array.isArray(m.items)).toBe(false);
			expect((m.items as MC).value).toBe(1);
			expect(oldItem.parent).toBe(m);

			// Switch to array
			m.setArray();
			expect(Array.isArray(m.items)).toBe(true);
			expect((m.items as MC[]).length).toBe(2);
			expect((m.items as MC[])[0].value).toBe(2);
			expect((m.items as MC[])[1].value).toBe(3);
			expect(oldItem.parent).toBe(null);
			(m.items as MC[]).forEach((item) => expect(item.parent).toBe(m));
		});

		test("can switch from array of children to single child", () => {
			class MC extends Model {
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];

				setSingle() {
					this.items = MC.create({ value: 1 });
				}

				setArray() {
					this.items = [MC.create({ value: 2 }), MC.create({ value: 3 })];
				}
			}

			const m = M.create();

			// Start with array
			m.setArray();
			const oldItems = [...(m.items as MC[])];
			expect(Array.isArray(m.items)).toBe(true);
			expect((m.items as MC[]).length).toBe(2);
			oldItems.forEach((item) => expect(item.parent).toBe(m));

			// Switch to single
			m.setSingle();
			expect(Array.isArray(m.items)).toBe(false);
			expect((m.items as MC).value).toBe(1);
			expect((m.items as MC).parent).toBe(m);
			oldItems.forEach((item) => expect(item.parent).toBe(null));
		});

		test("switching child types is reactive", () => {
			class MC extends Model {
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];

				setSingle() {
					this.items = MC.create({ value: 1 });
				}

				setArray() {
					this.items = [MC.create({ value: 2 }), MC.create({ value: 3 })];
				}
			}

			const m = M.create();
			let reactionCount = 0;
			let currentValue: MC | MC[];

			reaction(
				() => m.items,
				(value) => {
					currentValue = value;
					reactionCount++;
				}
			);

			expect(reactionCount).toBe(0);

			m.setSingle();
			expect(reactionCount).toBe(1);
			expect(Array.isArray(currentValue!)).toBe(false);

			m.setArray();
			expect(reactionCount).toBe(2);
			expect(Array.isArray(currentValue!)).toBe(true);
		});

		test("parent references are correct after switching", () => {
			class MC extends Model {
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];
			}

			const m = M.create();

			// Start with single
			m.items = MC.create({ value: 1 });
			expect((m.items as MC).parent).toBe(m);

			// Switch to array
			m.items = [MC.create({ value: 2 }), MC.create({ value: 3 })];
			expect((m.items as MC[])[0].parent).toBe(m);
			expect((m.items as MC[])[1].parent).toBe(m);

			// Switch back to single
			m.items = MC.create({ value: 4 });
			expect((m.items as MC).parent).toBe(m);
		});
	});

	describe("modelRef property switching", () => {
		test("can switch from single modelRef to array of modelRefs", () => {
			class MC extends Model {
				@id id!: any;
				value = 0;
			}

			class M extends Model {
				@child(MC) children: MC[] = [];
				@modelRef(MC) refs!: MC | MC[];

				addChild(id: number, value: number) {
					this.children.push(MC.create({ id, value }));
				}

				setSingleRef(index: number) {
					this.refs = this.children[index];
				}

				setArrayRefs(indices: number[]) {
					this.refs = indices.map((i) => this.children[i]);
				}
			}

			const m = M.create();
			m.addChild(1, 10);
			m.addChild(2, 20);
			m.addChild(3, 30);

			// Start with single ref
			m.setSingleRef(0);
			expect(Array.isArray(m.refs)).toBe(false);
			expect((m.refs as MC).id).toBe(1);

			// Switch to array refs
			m.setArrayRefs([1, 2]);
			expect(Array.isArray(m.refs)).toBe(true);
			expect((m.refs as MC[]).length).toBe(2);
			expect((m.refs as MC[])[0].id).toBe(2);
			expect((m.refs as MC[])[1].id).toBe(3);
		});

		test("can switch from array of modelRefs to single modelRef", () => {
			class MC extends Model {
				@id id!: any;
				value = 0;
			}

			class M extends Model {
				@child(MC) children: MC[] = [];
				@modelRef(MC) refs!: MC | MC[];

				addChild(id: number, value: number) {
					this.children.push(MC.create({ id, value }));
				}

				setSingleRef(index: number) {
					this.refs = this.children[index];
				}

				setArrayRefs(indices: number[]) {
					this.refs = indices.map((i) => this.children[i]);
				}
			}

			const m = M.create();
			m.addChild(1, 10);
			m.addChild(2, 20);
			m.addChild(3, 30);

			// Start with array refs
			m.setArrayRefs([0, 1]);
			expect(Array.isArray(m.refs)).toBe(true);
			expect((m.refs as MC[]).length).toBe(2);

			// Switch to single ref
			m.setSingleRef(2);
			expect(Array.isArray(m.refs)).toBe(false);
			expect((m.refs as MC).id).toBe(3);
		});

		test("switching modelRef types is reactive", () => {
			class MC extends Model {
				@id id!: any;
				value = 0;
			}

			class M extends Model {
				@child(MC) children: MC[] = [];
				@modelRef(MC) refs!: MC | MC[];

				addChild(id: number, value: number) {
					this.children.push(MC.create({ id, value }));
				}

				setSingleRef(index: number) {
					this.refs = this.children[index];
				}

				setArrayRefs(indices: number[]) {
					this.refs = indices.map((i) => this.children[i]);
				}
			}

			const m = M.create();
			m.addChild(1, 10);
			m.addChild(2, 20);

			let reactionCount = 0;
			let currentValue: MC | MC[];

			reaction(
				() => m.refs,
				(value) => {
					currentValue = value;
					reactionCount++;
				}
			);

			expect(reactionCount).toBe(0);

			m.setSingleRef(0);
			expect(reactionCount).toBe(1);
			expect(Array.isArray(currentValue!)).toBe(false);

			m.setArrayRefs([0, 1]);
			expect(reactionCount).toBe(2);
			expect(Array.isArray(currentValue!)).toBe(true);
		});
	});

	describe("snapshot compatibility with type switching", () => {
		test("snapshots work correctly when switching child types", () => {
			class MC extends Model {
				@id id!: any;
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];
			}

			const m = M.create();

			// Test single child snapshot
			m.items = MC.create({ id: 1, value: 10 });
			let snapshot = toSnapshot(m);
			expect(snapshot.items).toEqual({ id: 1, value: 10 });

			// Switch to array and test snapshot
			m.items = [
				MC.create({ id: 2, value: 20 }),
				MC.create({ id: 3, value: 30 }),
			];
			snapshot = toSnapshot(m);
			expect(snapshot.items).toEqual([
				{ id: 2, value: 20 },
				{ id: 3, value: 30 },
			]);

			// Switch back to single and test snapshot
			m.items = MC.create({ id: 4, value: 40 });
			snapshot = toSnapshot(m);
			expect(snapshot.items).toEqual({ id: 4, value: 40 });
		});

		test("can load snapshot with different type than current", () => {
			class MC extends Model {
				@id id!: any;
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];
			}

			const m = M.create();

			// Start with single
			m.items = MC.create({ id: 1, value: 10 });
			expect(Array.isArray(m.items)).toBe(false);

			// Load snapshot with array
			applySnapshot(m, {
				items: [
					{ id: 2, value: 20 },
					{ id: 3, value: 30 },
				],
			});
			expect(Array.isArray(m.items)).toBe(true);
			expect((m.items as unknown as MC[]).length).toBe(2);
			expect((m.items as unknown as MC[])[0].value).toBe(20);

			// Load snapshot with single
			applySnapshot(m, {
				items: { id: 4, value: 40 },
			});
			expect(Array.isArray(m.items)).toBe(false);
			expect((m.items as MC).value).toBe(40);
		});
	});
});
