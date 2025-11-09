import {
	Model,
	id,
	modelRef,
	child,
	state,
	toSnapshot,
	applySnapshot,
	effect,
	reaction,
} from "../src/index";

test("can create a model", () => {
	class M extends Model {}

	const model = M.create();

	expect(model instanceof Model).toBe(true);
});

test("direct new calls are disallowed", () => {
	class M extends Model {}
	expect(() => new M()).toThrowErrorMatchingInlineSnapshot(
		`[Error: r-state-tree: Can't initialize model directly, use \`M.create()\` instead]`
	);
});

describe("model lifecylce", () => {
	test("modelDidInit is executed when a model is created", () => {
		class M extends Model {
			count = 0;
			@state prop = 0;
			modelDidInit() {
				expect(this.prop).toBe(1);
				this.count++;
			}
		}

		const m = M.create({ prop: 1 });
		expect(m.count).toBe(1);
	});

	test("modelDidInit has the initial paramters passed into create", () => {
		const snapshot = { prop: 1 };
		const paramA = {};
		const paramB = {};
		class M extends Model {
			count = 0;
			@state prop = 0;
			modelDidInit(s, a, b) {
				expect(s).toBe(snapshot);
				expect(a).toBe(paramA);
				expect(b).toBe(paramB);
				expect(this.prop).toBe(1);
				this.count++;
			}
		}

		const m = M.create(snapshot, paramA, paramB);
		expect(m.count).toBe(1);
	});

	test("modelDidInit is executed in an action", () => {
		class M extends Model {
			@state count = 0;
			modelDidInit() {
				this.count++;
			}
		}

		const m = M.create();
		expect(m.count).toBe(1);
	});

	test("modelDidInit can be called without snapshot", () => {
		let called = false;
		class M extends Model {
			@state prop = 0;
			modelDidInit(snapshot) {
				expect(snapshot).toBe(undefined);
				called = true;
			}
		}

		const m = M.create();
		expect(called).toBe(true);
		expect(m.prop).toBe(0);
	});

	test("will call modelDidAttach when children are attached", () => {
		let count = 0;

		class CM extends Model {
			modelDidAttach() {
				count++;
			}
		}

		class M extends Model {
			@child cm: CM;

			setCM() {
				this.cm = CM.create();
			}
		}

		const m = M.create();
		expect(count).toBe(0);
		m.setCM();
		expect(count).toBe(1);
	});

	test("will call modelDidAttach on children that are attached (delayed list)", () => {
		let count = 0;

		class CM extends Model {
			modelDidAttach() {
				count++;
			}
		}

		class M extends Model {
			@child cms: CM[] = [];

			addCM() {
				this.cms.push(CM.create());
			}
		}

		const m = M.create();
		expect(count).toBe(0);
		m.addCM();
		expect(count).toBe(1);
		m.addCM();
		expect(count).toBe(2);
	});

	test("will call modelDidAttach when model is initialized as a child", () => {
		let attachCount = 0;

		class CM extends Model {
			modelDidAttach() {
				attachCount++;
			}
		}

		class M extends Model {
			@child cm: CM = CM.create();
		}

		const m = M.create();
		expect(attachCount).toBe(1);
		expect(m.cm).toBeInstanceOf(CM);
	});

	test("will call modelDidAttach when model is initialized as a child (array)", () => {
		let attachCount = 0;

		class CM extends Model {
			modelDidAttach() {
				attachCount++;
			}
		}

		class M extends Model {
			@child cms: CM[] = [CM.create(), CM.create()];
		}

		const m = M.create();
		expect(attachCount).toBe(2);
		expect(m.cms.length).toBe(2);
	});

	test("will call modelWillDetach when children are detached", () => {
		let count = 0;

		class CM extends Model {
			modelWillDetach() {
				count++;
			}
		}

		class M extends Model {
			@child cm: CM = CM.create();

			clearCM() {
				this.cm = null;
			}
		}

		const m = M.create();
		expect(count).toBe(0);
		m.clearCM();
		expect(count).toBe(1);
	});

	test("will call modelWillDetach when children are detached (delayed list)", () => {
		let count = 0;

		class CM extends Model {
			modelWillDetach() {
				count++;
			}
		}

		class M extends Model {
			@child cms: CM[] = [CM.create(), CM.create()];

			popCM() {
				this.cms.pop();
			}
		}

		const m = M.create();
		expect(count).toBe(0);
		m.popCM();
		expect(count).toBe(1);
		m.popCM();
		expect(count).toBe(2);
	});

	test("will not trigger lifecycle methods when re-ordering", () => {
		let count = 0;

		class CM extends Model {
			modelWillDetach() {
				count++;
			}

			modelDidAttach() {
				count++;
			}
		}

		class M extends Model {
			@child cms: CM[] = [CM.create(), CM.create()];

			reverse() {
				this.cms = this.cms.slice().reverse();
			}
		}

		const m = M.create();
		expect(count).toBe(2);
		m.reverse();
		expect(count).toBe(2);
	});

	test("modelDidAttach is executed in an action", () => {
		class CM extends Model {
			@state count = 0;
			modelDidAttach() {
				this.count++;
			}
		}

		class M extends Model {
			@child cm: CM;
			setCM() {
				this.cm = CM.create();
			}
		}

		const m = M.create();
		m.setCM();
		expect(m.cm.count).toBe(1);
	});

	test("modelWillDetach is executed in an action", () => {
		class CM extends Model {
			@state count = 0;
			modelWillDetach() {
				this.count++;
			}
		}

		class M extends Model {
			@child cm: CM = CM.create();
			_temp: CM;
			clearCM() {
				this._temp = this.cm;
				this.cm = null;
			}
		}

		const m = M.create();
		expect(m.cm.count).toBe(0);
		m.clearCM();
		expect(m._temp.count).toBe(1);
	});
});

test("can re-attach an detached model", () => {
	let detachCount = 0;
	let attachCount = 0;

	class CM extends Model {
		state = 0;
		incState() {
			this.state++;
		}

		get computed() {
			return this.state * 2;
		}

		modelDidAttach() {
			attachCount++;
		}

		modelWillDetach() {
			detachCount++;
		}
	}

	class M extends Model {
		@child cm: CM;
		_cm: CM = null;

		clearCM() {
			this._cm = this.cm;
			this.cm = null;
		}

		setCM() {
			this.cm = this._cm || CM.create();
			this._cm = null;
		}
	}

	const m = M.create();
	m.setCM();
	m.cm.incState();
	expect(m.cm.computed).toBe(2);
	expect(attachCount).toBe(1);
	expect(detachCount).toBe(0);
	m.clearCM();
	expect(attachCount).toBe(1);
	expect(detachCount).toBe(1);
	m.setCM();
	expect(attachCount).toBe(2);
	expect(detachCount).toBe(1);
	expect(m.cm.computed).toBe(2);
	m.cm.incState();
	expect(m.cm.computed).toBe(4);
});

test("can have a child model", () => {
	class MC extends Model {
		@state state = 0;
	}

	class M extends Model {
		@child mc: MC | null = null;

		addModel(state: number) {
			this.mc = MC.create({ state });
		}
	}

	const m = M.create();
	expect(m.mc).toBe(null);
	m.addModel(1);
	expect(m.mc).toBeInstanceOf(MC);
	expect(m.mc.state).toBe(1);
});

test("child models are reactive properties", () => {
	class M extends Model {
		@child mc: M | null = null;

		setModel() {
			this.mc = M.create();
		}
	}

	const m = M.create();
	let count = 0;
	reaction(
		() => m.mc,
		() => count++
	);
	m.setModel();
	expect(count).toBe(1);
	m.setModel();
	expect(count).toBe(2);
});

test("model can initialzie child model", () => {
	class MC extends Model {}
	class M extends Model {
		@child mc: MC = MC.create();
	}

	const m = M.create();
	expect(m.mc).toBeInstanceOf(MC);
});

test("child model can't be placed in multiple locations in the tree", () => {
	class MC extends Model {}
	class M extends Model {
		@child mc: MC;
		setModel(mc: MC) {
			this.mc = mc;
		}
	}

	const mc = MC.create();
	const m1 = M.create();
	const m2 = M.create();
	m1.setModel(mc);
	expect(() => m2.setModel(mc)).toThrow();
});

describe("model identifiers", () => {
	test("identifiers can't be set to undefined once assigned", () => {
		class M extends Model {
			@id id = 1;

			clearId() {
				this.id = undefined;
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
			@modelRef mr: M = this.m;
		}

		const mp = MP.create();
		expect(mp.m).toBe(mp.mr);
		mp.m.setId();
		expect(mp.m).toBe(mp.mr);
	});

	test("correct id shows up in snapshot after being re-assigned", () => {
		class M extends Model {
			@id myId = 1;
			@state test = "me";

			setId() {
				this.myId = 2;
			}
		}

		class MP extends Model {
			@child m = M.create();
			@modelRef mr: M = this.m;
		}

		const mp = MP.create();
		mp.m.setId();
		expect(toSnapshot(mp)).toStrictEqual({
			m: { myId: 2, test: "me" },
			mr: { myId: 2 },
		});
	});

	test("identifiers can be assigned in modelDidInit", () => {
		class M extends Model {
			@id id;

			modelDidInit() {
				this.id = 1;
			}
		}

		const m = M.create();
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

test("can get the parent of a model", () => {
	class MC extends Model {}
	class M extends Model {
		@child mc: MC = MC.create();
		@child mc2: MC | null = null;
		@child mcs: MC[] = [MC.create(), MC.create()];
	}

	const m = M.create();
	expect(m.parent).toBe(null);
	expect(m.mc.parent).toBe(m);
	expect(m.mcs.length).toBe(2);
	m.mcs.forEach((mc) => expect(mc.parent).toBe(m));
	m.mc2 = MC.create();
	expect(m.mc2.parent).toBe(m);
	m.mcs.push(MC.create());
	expect(m.mcs[m.mcs.length - 1].parent).toBe(m);
});

test("children models can be set with Object.defineProperty", () => {
	let childAttachedCount = 0;
	class MC extends Model {
		modelDidAttach() {
			childAttachedCount++;
		}
	}

	class M extends Model {
		@child mcs;

		constructor() {
			super();
			this.mcs = [];
			Object.defineProperty(this, "mcs", {
				value: [],
				writable: true,
				configurable: true,
			});
		}

		addChild() {
			this.mcs.push(MC.create());
		}
	}

	const m = M.create();
	m.addChild();
	expect(childAttachedCount).toBe(1);
	m.addChild();
	expect(childAttachedCount).toBe(2);
});

describe("runtime type switching", () => {
	describe("child property switching", () => {
		test("can switch from single child to array of children", () => {
			let attachCount = 0;
			let detachCount = 0;

			class MC extends Model {
				@state value = 0;

				modelDidAttach() {
					attachCount++;
				}

				modelWillDetach() {
					detachCount++;
				}
			}

			class M extends Model {
				@child(MC) items: MC | MC[];

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
			expect(Array.isArray(m.items)).toBe(false);
			expect((m.items as MC).value).toBe(1);
			expect(attachCount).toBe(1);
			expect(detachCount).toBe(0);

			// Switch to array
			m.setArray();
			expect(Array.isArray(m.items)).toBe(true);
			expect((m.items as MC[]).length).toBe(2);
			expect((m.items as MC[])[0].value).toBe(2);
			expect((m.items as MC[])[1].value).toBe(3);
			expect(attachCount).toBe(3); // 1 from single + 2 from array
			expect(detachCount).toBe(1); // single was detached
		});

		test("can switch from array of children to single child", () => {
			let attachCount = 0;
			let detachCount = 0;

			class MC extends Model {
				@state value = 0;

				modelDidAttach() {
					attachCount++;
				}

				modelWillDetach() {
					detachCount++;
				}
			}

			class M extends Model {
				@child(MC) items: MC | MC[];

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
			expect(Array.isArray(m.items)).toBe(true);
			expect((m.items as MC[]).length).toBe(2);
			expect(attachCount).toBe(2);
			expect(detachCount).toBe(0);

			// Switch to single
			m.setSingle();
			expect(Array.isArray(m.items)).toBe(false);
			expect((m.items as MC).value).toBe(1);
			expect(attachCount).toBe(3); // 2 from array + 1 from single
			expect(detachCount).toBe(2); // both array items detached
		});

		test("switching child types is reactive", () => {
			class MC extends Model {
				@state value = 0;
			}

			class M extends Model {
				@child(MC) items: MC | MC[];

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
				@state value = 0;
			}

			class M extends Model {
				@child(MC) items: MC | MC[];
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
				@id id;
				@state value = 0;
			}

			class M extends Model {
				@child(MC) children: MC[] = [];
				@modelRef refs: MC | MC[];

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
				@id id;
				@state value = 0;
			}

			class M extends Model {
				@child(MC) children: MC[] = [];
				@modelRef refs: MC | MC[];

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
				@id id;
				@state value = 0;
			}

			class M extends Model {
				@child(MC) children: MC[] = [];
				@modelRef refs: MC | MC[];

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
				@id id;
				@state value = 0;
			}

			class M extends Model {
				@child(MC) items: MC | MC[];
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
				@id id;
				@state value = 0;
			}

			class M extends Model {
				@child(MC) items: MC | MC[];
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

describe("model references", () => {
	test("can assign a model to a reference", () => {
		class MC extends Model {
			@id id = 0;
		}

		class M extends Model {
			@child(MC) mc: MC = MC.create();
			@modelRef mr: MC;

			setRef() {
				this.mr = this.mc;
			}
		}

		const m = M.create();
		m.setRef();
		expect(m.mc).toBe(m.mr);
	});

	test("can't assing a model without an id to a reference", () => {
		class MC extends Model {}
		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef mr: MC;

			setRef() {
				this.mr = this.mc;
			}
		}

		const m = M.create();
		expect(() => m.setRef()).toThrow();
	});

	test("model ref is not available until the referenced model is attached", () => {
		class MC extends Model {
			@id id = 0;
		}

		class M extends Model {
			mctemp = MC.create();
			@child mc: MC | null = null;
			@modelRef mr: MC = this.mctemp;

			setChild() {
				this.mc = this.mctemp;
			}
		}

		const m = M.create();
		expect(m.mr).toBe(undefined);
		m.setChild();
		expect(m.mr).toBe(m.mc);
	});

	test("model ref will become undefined when model is detached", () => {
		class MC extends Model {
			@id id = 0;
		}
		class M extends Model {
			@child(MC) mc: MC = MC.create();
			@modelRef mr: MC;

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
		expect(m.mc).toBe(m.mr);
		m.clearModel();
		expect(m.mr).toBe(undefined);
	});

	test("model ref will become undefined when model is detached (array)", () => {
		class MC extends Model {
			@id id;
		}

		class M extends Model {
			@child mc: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@modelRef mr: MC;

			setRef() {
				this.mr = this.mc[0];
			}

			clearModel() {
				this.mc = [];
			}
		}

		const m = M.create();
		m.setRef();
		expect(m.mc[0]).toBe(m.mr);
		m.clearModel();
		expect(m.mr).toBe(undefined);
	});

	test("model ref is reactive", () => {
		class MC extends Model {
			@id id;
		}
		class M extends Model {
			@child mc: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@modelRef mr: MC;

			setModel(index: number) {
				this.mr = index >= 0 ? this.mc[index] : undefined;
			}
		}

		const m = M.create();
		let current;

		effect(() => {
			current = m.mr;
		});

		expect(current).toBe(undefined);
		m.setModel(0);
		expect(current).toBe(m.mc[0]);
		m.setModel(1);
		expect(current).toBe(m.mc[1]);
		m.setModel(-1);
		expect(current).toBe(undefined);
	});

	test("model ref is restored when model is re-attached", () => {
		class MC extends Model {
			@id id = 0;
		}
		class M extends Model {
			@child(MC) mc: MC = MC.create();
			@modelRef mr: MC;
			_temp: MC;

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
		expect(m.mr).toBe(m.mc);
	});

	test("model ref is NOT restored when model is re-attached to a another tree root", () => {
		let temp: MC | null = null;

		class MC extends Model {
			@id id = 0;
		}
		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef mr: MC;
			@state setRef: boolean = false;

			modelDidAttach() {
				if (this.setRef) {
					this.mr = this.mc;
				}
			}

			clearModel() {
				temp = this.mc;
				this.mc = null;
			}

			resetModel() {
				this.mc = temp;
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
			@id id;
		}
		class M extends Model {
			@child(MC) mc1 = MC.create({ id: 1 });
			@child(MC) mc2: MC = MC.create({ id: 2 });
			@modelRef mr: MC[] = [];
			_temp: MC;

			setRef() {
				this.mr = [this.mc1, this.mc2];
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
