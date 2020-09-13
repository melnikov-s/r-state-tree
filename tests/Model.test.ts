import {
	observable,
	action,
	computed,
	Model,
	identifier,
	modelRef,
	modelRefs,
	child,
	children,
	state,
	autorun,
	reaction,
	onSnapshot,
	toSnapshot,
	applySnapshot,
} from "../src/index";

test("can create a model", () => {
	class M extends Model {}

	const model = M.create();

	expect(model instanceof Model).toBe(true);
});

test("direct new calls are disallowed", () => {
	class M extends Model {}
	expect(() => new M()).toThrowErrorMatchingInlineSnapshot(
		`"r-state-tree: Can't initialize model directly, use \`M.create()\` instead"`
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

	test("will call modelDidAttach when children are attached", () => {
		let count = 0;

		class CM extends Model {
			modelDidAttach() {
				count++;
			}
		}

		class M extends Model {
			@child cm: CM;

			@action setCM() {
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
			@children cms: CM[] = [];

			@action addCM() {
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

	test("will call modelWillDetach when children are detached", () => {
		let count = 0;

		class CM extends Model {
			modelWillDetach() {
				count++;
			}
		}

		class M extends Model {
			@child cm: CM = CM.create();

			@action clearCM() {
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
			@children cms: CM[] = [CM.create(), CM.create()];

			@action popCM() {
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
			@children cms: CM[] = [CM.create(), CM.create()];

			@action reverse() {
				this.cms = this.cms.slice().reverse();
			}
		}

		const m = M.create();
		expect(count).toBe(2);
		m.reverse();
		expect(count).toBe(2);
	});
});

test("can re-attach an detached model", () => {
	let detachCount = 0;
	let attachCount = 0;

	class CM extends Model {
		@observable state = 0;
		@action incState() {
			this.state++;
		}

		@computed get computed() {
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

		@action clearCM() {
			this._cm = this.cm;
			this.cm = null;
		}

		@action setCM() {
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

		@action addModel(state: number) {
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

		@action setModel() {
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
		@action setModel(mc: MC) {
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
	test("identifiers can only be assigned once after init", () => {
		class M1 extends Model {
			@identifier id = 0;

			constructor() {
				super();
				this.id = 1;
			}
		}

		class M2 extends Model {
			@identifier id;

			constructor() {
				super();
				this.id = 1;
			}

			@action setId() {
				this.id = 2;
			}
		}

		expect(() => M1.create()).not.toThrowError();
		const m = M2.create();
		expect(() => m.setId()).toThrowErrorMatchingInlineSnapshot(
			`"r-state-tree identifier already set."`
		);
	});

	test("identifiers can be assigned in modelDidInit", () => {
		class M extends Model {
			@identifier id;

			modelDidInit() {
				this.id = 1;
			}
		}

		const m = M.create();
		expect(m.id).toBe(1);
	});

	test("identifiers can be re-assigned in a snapshot", () => {
		class M extends Model {
			@identifier id = 1;
			@action badAction() {
				this.id++;
			}
		}

		expect(() => M.create({ id: 1 })).not.toThrowError();
		expect(() => M.create({ id: 2 })).not.toThrowError();
		expect(() => M.create().badAction()).toThrowErrorMatchingInlineSnapshot(
			`"r-state-tree identifier already set."`
		);
	});
});

test("can get the parent of a model", () => {
	class MC extends Model {}
	class M extends Model {
		@child mc: MC = MC.create();
		@child mc2: MC | null = null;
		@children mcs: MC[] = [MC.create(), MC.create()];
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
		@children mcs;

		constructor() {
			super();
			Object.defineProperty(this, "mcs", {
				value: [],
				writable: true,
				configurable: true,
			});
		}

		@action addChild() {
			this.mcs.push(MC.create());
		}
	}

	const m = M.create();
	m.addChild();
	expect(childAttachedCount).toBe(1);
	m.addChild();
	expect(childAttachedCount).toBe(2);
});

describe("model references", () => {
	test("can assing a model to a reference", () => {
		class MC extends Model {
			@identifier id = 0;
		}

		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef mr: MC;

			@action setRef() {
				this.mr = this.mc;
			}
		}

		const m = M.create();
		m.setRef();
		expect(m.mc).toBe(m.mr);
	});

	test("can't assing a model without an identifier to a reference", () => {
		class MC extends Model {}
		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef mr: MC;

			@action setRef() {
				this.mr = this.mc;
			}
		}

		const m = M.create();
		expect(() => m.setRef()).toThrow();
	});

	test("model ref is not available until the referenced model is attached", () => {
		class MC extends Model {
			@identifier id = 0;
		}

		class M extends Model {
			mctemp = MC.create();
			@child mc: MC | null = null;
			@modelRef mr: MC = this.mctemp;

			@action setChild() {
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
			@identifier id = 0;
		}
		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef mr: MC;

			@action setRef() {
				this.mr = this.mc;
			}

			@action clearModel() {
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
			@identifier id;
		}

		class M extends Model {
			@children mc: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@modelRef mr: MC;

			@action setRef() {
				this.mr = this.mc[0];
			}

			@action clearModel() {
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
			@identifier id;
		}
		class M extends Model {
			@children mc: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@modelRef mr: MC;

			@action setModel(index: number) {
				this.mr = index >= 0 ? this.mc[index] : undefined;
			}
		}

		const m = M.create();
		let current;

		autorun(() => (current = m.mr));

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
			@identifier id = 0;
		}
		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef mr: MC;
			_temp: MC;

			@action setRef() {
				this.mr = this.mc;
			}

			@action clearModel() {
				this._temp = this.mc;
				this.mc = null;
			}

			@action resetModel() {
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
			@identifier id = 0;
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

			@action clearModel() {
				temp = this.mc;
				this.mc = null;
			}

			@action resetModel() {
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
			@identifier id;
		}
		class M extends Model {
			@child mc1 = MC.create({ id: 1 });
			@child mc2: MC = MC.create({ id: 2 });
			@modelRefs mr: MC[] = [];
			_temp: MC;

			@action setRef() {
				this.mr = [this.mc1, this.mc2];
			}

			@action clearModel1() {
				this.mc1 = null;
			}

			@action clearModel2() {
				this._temp = this.mc2;
				this.mc2 = null;
			}

			@action restoreModel2() {
				this.mc2 = this._temp;
			}
		}

		const m = M.create();
		m.setRef();
		expect(m.mr).toEqual([m.mc1, m.mc2]);
		m.clearModel1();
		expect(m.mr).toEqual([m.mc2]);
		m.clearModel2();
		expect(m.mr).toEqual([]);
		m.restoreModel2();
		expect(m.mr).toEqual([m.mc2]);
	});

	test("model state will resolve references in the same snapshot (mst-example)", () => {
		class Todo extends Model {
			@identifier id: string;
			@state title: string;
		}

		class Todos extends Model {
			@children(Todo) todos = [];
			@modelRef selectedTodo: Todo | undefined;
			@action empty() {
				this.todos = [];
			}
			@action swap() {
				this.todos = [Todo.create({ id: "47", title: "Get tea" })];
			}
		}

		const storeInstance = Todos.create({
			todos: [
				{
					id: "47",
					title: "Get coffee",
				},
			],
			selectedTodo: { id: "47" },
		});

		expect(storeInstance.selectedTodo.title).toBe("Get coffee");
		storeInstance.swap();
		expect(storeInstance.selectedTodo.title).toBe("Get tea");
		storeInstance.empty();
		expect(storeInstance.selectedTodo).toBe(undefined);
	});
});

describe("model state", () => {
	let id = 0;

	class MCA extends Model {
		@identifier id;
		@state propA = 0;
		@state propB = 0;
		@observable ignored = 0;

		modelDidInit() {
			if (this.id == null) {
				this.id = id++;
			}
		}
	}

	class MCB extends Model {
		@identifier id;
		@state prop = 0;
		@observable ignored = 0;
		@children(MCA) mcas: MCA[] = [MCA.create(), MCA.create()];
		@modelRef mcaRef: MCA = this.mcas[0];

		modelDidInit() {
			if (this.id == null) {
				this.id = id++;
			}
		}
	}

	class M extends Model {
		@state prop = 0;
		@observable ignored = 0;
		@children(MCA) mcas: MCA[] = [];
		@children(MCB) mcbs: MCB[] = [MCB.create(), MCB.create()];
		@child(MCA) mca: MCA = MCA.create();
		anotherIgnored = 0;
		@action inc() {
			this.prop++;
		}
	}

	const modelJSON = {
		prop: 0,
		mcas: [],
		mcbs: [
			{
				id: 2,
				prop: 0,
				mcas: [
					{
						id: 0,
						propA: 0,
						propB: 0,
					},
					{
						id: 1,
						propA: 0,
						propB: 0,
					},
				],
				mcaRef: { id: 0 },
			},
			{
				id: 5,
				prop: 0,
				mcas: [
					{
						id: 3,
						propA: 0,
						propB: 0,
					},
					{
						id: 4,
						propA: 0,
						propB: 0,
					},
				],
				mcaRef: { id: 3 },
			},
		],
		mca: {
			id: 6,
			propA: 0,
			propB: 0,
		},
	};

	beforeEach(() => {
		id = 0;
	});

	test("model state is observable", () => {
		let count = 0;

		const m = M.create();
		autorun(() => {
			count++;
			m.prop;
		});

		m.inc();
		expect(count).toBe(2);
		expect(m.prop).toBe(1);
	});

	test("model state is serializable", () => {
		const m = M.create();
		expect(toSnapshot(m)).toEqual(modelJSON);
	});

	test("model state can be loaded from snapshot", () => {
		const m = M.create(modelJSON);
		expect(toSnapshot(m)).toEqual(modelJSON);
	});

	test("model state loaded from snapshot preserves references", () => {
		const m = M.create(modelJSON);
		expect(m.mcbs[0].mcaRef).toBe(m.mcbs[0].mcas[0]);
	});

	test("can clone model state with Model.create(toSnapshot(model))", () => {
		const m = M.create();
		m.ignored++;
		m.anotherIgnored++;
		const mClone = M.create(toSnapshot(m));
		expect(mClone.ignored).toBe(0);
		expect(mClone.anotherIgnored).toBe(0);
		expect(m).not.toEqual(mClone);

		expect(toSnapshot(m)).toEqual(modelJSON);
		expect(toSnapshot(m)).toEqual(toSnapshot(mClone));
	});

	test("model snapshot produces the same reference if nothing is changed", () => {
		const m = M.create();
		expect(toSnapshot(m)).toBe(toSnapshot(m));
		const oldSnapshot = toSnapshot(m);
		m.inc();
		expect(toSnapshot(m)).not.toBe(oldSnapshot);
	});

	test("can apply snapshot to existing model", () => {
		class M extends Model {
			@state propA = 0;
			@state propB = 0;
		}

		const m = M.create();
		expect(applySnapshot(m, { propA: 1, propB: 1 })).toBe(m);
		expect(m.propA).toBe(1);
		expect(m.propB).toBe(1);
	});

	test("snapshot ids get reconciled for single child model", () => {
		class MC extends Model {
			@identifier id;
		}

		class M extends Model {
			@child(MC) mc: MC;
		}

		const m = M.create();

		applySnapshot(m, { mc: { id: 1 } });
		const mc = m.mc;
		applySnapshot(m, { mc: { id: 1 } });
		expect(mc).toBe(m.mc);
		applySnapshot(m, { mc: { id: 2 } });
		expect(mc).not.toBe(m.mc);
	});

	test("snapshot ids get reconciled for child models", () => {
		class MC extends Model {
			@identifier id;
		}

		class M extends Model {
			@children(MC) mcs: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
		}

		const m = M.create();
		const mcs = m.mcs.slice();
		applySnapshot(m, { mcs: [{ id: 1 }, { id: 0 }, { id: 2 }] });
		expect(m.mcs.length).toBe(3);
		expect(m.mcs[0].id).toBe(1);
		expect(m.mcs[1].id).toBe(0);
		expect(m.mcs[2].id).toBe(2);
		expect(m.mcs[0]).toBe(mcs[1]);
		expect(m.mcs[1]).toBe(mcs[0]);
		applySnapshot(m, { mcs: [{ id: 0 }, { id: 2 }] });
		expect(m.mcs.length).toBe(2);
		expect(m.mcs[0].id).toBe(0);
		expect(m.mcs[1].id).toBe(2);
		expect(m.mcs[0]).toBe(mcs[0]);
		expect(m.mcs[1]).not.toBe(mcs[0]);
		expect(m.mcs[1]).not.toBe(mcs[1]);
	});

	test("will throw if reconciled child id exists on another parent", () => {
		let id = 0;
		class MC extends Model {
			@identifier id;
		}

		class M extends Model {
			@children(MC) mcs: MC[] = [
				MC.create({ id: id++ }),
				MC.create({ id: id++ }),
			];
		}

		class MP extends Model {
			@children(M) ms: M[] = [M.create(), M.create()];
		}

		const mp = MP.create();
		expect(() =>
			applySnapshot(mp.ms[1], { mcs: [{ id: 0 }] })
		).toThrowErrorMatchingInlineSnapshot(
			`"r-state-tree: model with this id already exists on another parent"`
		);
	});

	test("model snapshots accept real model referecens", () => {
		class MC extends Model {
			@identifier prop;
		}
		class M extends Model {
			@child mc: MC;
			@children mcs: MC[];
			@modelRef mr: MC;
			@modelRefs mrs: MC[];
		}

		const mca = MC.create({ prop: 0 });
		const mcb = MC.create({ prop: 1 });
		const mcc = MC.create({ prop: 2 });

		const m = M.create({ mc: mca, mcs: [mcb, mcc], mr: mca, mrs: [mcb] });

		expect(m.mc).toBe(mca);
		expect(m.mcs[0]).toBe(mcb);
		expect(m.mcs[1]).toBe(mcc);
		expect(m.mr).toBe(mca);
		expect(m.mrs[0]).toBe(mcb);
	});

	test("onSnapshotChange", () => {
		let count = 0;
		class MC extends Model {
			@state prop = 0;

			@action action() {
				this.prop++;
			}
		}

		class M extends Model {
			@state propA = 0;
			@state propB = 0;
			@observable obs = 0;
			@child mc: MC = MC.create();

			@action action() {
				this.propA++;
				this.propB++;

				this.mc.action();
			}
		}

		const m = M.create();
		const unsub = onSnapshot(m, (snapshot, model) => {
			expect(model).toBe(m);
			expect(snapshot).toEqual(toSnapshot(m));
			count++;
		});

		m.action();
		expect(count).toBe(1);
		m.mc.action();
		expect(count).toBe(2);
		unsub();
		m.action();
		expect(count).toBe(2);
	});

	test("changing referenced models trigger a snapshot change", () => {
		let id = 0;
		class MC extends Model {
			@identifier id = id++;
		}

		class M extends Model {
			@child mca: MC;
			@child mcb: MC;
			@modelRefs mcrs: MC[];
			@modelRef mcr: MC;

			@action setRef(m: MC) {
				this.mcr = m;
			}
			@action setRefs(ms: MC[]) {
				this.mcrs = ms;
			}
			@action clearMCB() {
				this.mcb = null;
			}
		}

		let count = 0;
		const mca = MC.create();
		const mcb = MC.create();
		const m = M.create({ mcb: mcb, mcrs: [mca], mcr: mca });
		onSnapshot(m, () => {
			count++;
		});
		expect(count).toBe(0);
		m.setRef(m.mcb);
		expect(count).toBe(1);
		m.setRefs([m.mcb]);
		expect(count).toBe(2);
		m.clearMCB();
		expect(count).toBe(3);
		expect(toSnapshot(m)).toEqual({
			mca: undefined,
			mcb: undefined,
			mcr: undefined,
			mcrs: [],
		});
	});
});
