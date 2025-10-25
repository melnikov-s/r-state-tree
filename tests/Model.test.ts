import {
	Model,
	identifier,
	modelRef,
	modelRefs,
	child,
	children,
	state,
	onSnapshot,
	toSnapshot,
	applySnapshot,
	SnapshotDiff,
	createEffect,
	createReaction,
	runInBatch,
	createSignal,
	createComputed,
	observable,
	createContext,
} from "../src/index";

import { onSnapshotDiff } from "../src/api";

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
			@children cms: CM[] = [];

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
			@children cms: CM[] = [CM.create(), CM.create()];

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
			@children cms: CM[] = [CM.create(), CM.create()];

			reverse() {
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
	createReaction(
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
			@identifier id = 1;

			clearId() {
				this.id = undefined;
			}
		}

		class MP extends Model {
			@child m = M.create();
			@modelRef mr = this.m;
		}

		const mp = MP.create();
		expect(() => mp.m.clearId()).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree can't clear an identifier once it has already been set.]`
		);
	});

	test("same identifier can't be assigned to different models", () => {
		class M extends Model {
			@identifier id = 0;
		}

		class MP extends Model {
			@children ms = [M.create()];

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
			@identifier id = 1;

			setId() {
				this.id = 2;
			}
		}

		class MP extends Model {
			@child m = M.create();
			@modelRef mr = this.m;
		}

		const mp = MP.create();
		expect(mp.m).toBe(mp.mr);
		mp.m.setId();
		expect(mp.m).toBe(mp.mr);
	});

	test("correct identifier shows up in snapshot after being re-assigned", () => {
		class M extends Model {
			@identifier myId = 1;
			@state test = "me";

			setId() {
				this.myId = 2;
			}
		}

		class MP extends Model {
			@child m = M.create();
			@modelRef mr = this.m;
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

describe("model references", () => {
	test("can assign a model to a reference", () => {
		class MC extends Model {
			@identifier id = 0;
		}

		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef mr: MC;

			setRef() {
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

			setRef() {
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
			@identifier id = 0;
		}
		class M extends Model {
			@child mc: MC = MC.create();
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
			@identifier id;
		}

		class M extends Model {
			@children mc: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
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
			@identifier id;
		}
		class M extends Model {
			@children mc: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@modelRef mr: MC;

			setModel(index: number) {
				this.mr = index >= 0 ? this.mc[index] : undefined;
			}
		}

		const m = M.create();
		let current;

		createEffect(() => (current = m.mr));

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
			@identifier id;
		}
		class M extends Model {
			@child mc1 = MC.create({ id: 1 });
			@child mc2: MC = MC.create({ id: 2 });
			@modelRefs mr: MC[] = [];
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
			empty() {
				this.todos = [];
			}
			swap() {
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
		ignored = 0;

		modelDidInit() {
			if (this.id == null) {
				this.id = id++;
			}
		}
	}

	class MCB extends Model {
		@identifier id;
		@state prop = 0;
		ignored = 0;
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
		ignored = 0;
		@children(MCA) mcas: MCA[] = [];
		@children(MCB) mcbs: MCB[] = [MCB.create(), MCB.create()];
		@child(MCA) mca: MCA = MCA.create();
		anotherIgnored = 0;
		inc() {
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
		createEffect(() => {
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

	test("loading snapshot for model property is observable", () => {
		let count = 0;
		class M extends Model {
			@state prop = 0;
			load() {
				applySnapshot(m, { prop: 1 });
			}
		}

		const m = M.create();

		createEffect(() => {
			m.prop;
			count++;
		});

		m.load();
		expect(count).toBe(2);
	});

	test("loading snapshot for model ref is observable", () => {
		let count = 0;
		let id = 0;
		class MC extends Model {
			@identifier id = id++;
		}
		class M extends Model {
			@children mcs = [MC.create(), MC.create()];
			@modelRef mc = null;
			load() {
				applySnapshot(m, { mc: { id: 0 } });
			}
		}

		const m = M.create();

		createEffect(() => {
			m.mc;
			count++;
		});

		m.load();
		expect(count).toBe(2);
	});

	test("loading snapshot for model refs is observable", () => {
		let count = 0;
		let id = 0;
		class MC extends Model {
			@identifier id = id++;
		}
		class M extends Model {
			@children mcs = [MC.create(), MC.create()];
			@modelRefs mc = [];
			load() {
				applySnapshot(m, { mc: [{ id: 0 }, { id: 1 }] });
			}
		}

		const m = M.create();

		createEffect(() => {
			m.mc;
			count++;
		});

		m.load();
		expect(count).toBe(2);
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
			@children(MC) mcs = [MC.create({ id: 0 }), MC.create({ id: 1 })];
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
		class MC extends Model {
			@identifier id;
		}

		class M extends Model {
			@children(MC) mcs: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
		}

		class MP extends Model {
			@children(M) ms: M[] = [M.create(), M.create()];
		}

		expect(() => MP.create()).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: id: 0 is already assigned to another model]`
		);
	});

	test("will throw if reconciled child id exists on same parent but differnt child models", () => {
		class MC extends Model {
			@identifier id;
		}

		class M extends Model {
			@children(MC) ms1: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@children(MC) ms2: MC[] = [MC.create({ id: 2 }), MC.create({ id: 3 })];
		}

		const m = M.create();
		expect(() =>
			applySnapshot(m, { ms2: [{ id: 0 }] })
		).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree duplicate ids detected after snapshot was loaded]`
		);
	});

	test("can swap models with different positions", () => {
		class MC extends Model {
			@identifier id;
		}

		class M extends Model {
			@children(MC) ms1: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@children(MC) ms2: MC[] = [MC.create({ id: 2 }), MC.create({ id: 3 })];
		}

		const m = M.create();
		expect(() =>
			applySnapshot(m, {
				ms1: [{ id: 2 }, { id: 3 }],
				ms2: [{ id: 0 }, { id: 1 }],
			})
		).not.toThrowError();
		expect(toSnapshot(m)).toStrictEqual({
			ms1: [{ id: 2 }, { id: 3 }],
			ms2: [{ id: 0 }, { id: 1 }],
		});
	});

	test("can add and remove model with an id", () => {
		class MC extends Model {
			@identifier id;
		}

		class M extends Model {
			@children(MC) ms: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			act() {
				const mc = this.ms.pop();
				this.ms.unshift(mc);
			}
		}

		class MS extends Model {
			@child(M) m: M = M.create();
		}

		const ms = MS.create();
		expect(() => ms.m.act()).not.toThrow();
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

			action() {
				this.prop++;
			}
		}

		class M extends Model {
			@state propA = 0;
			@state propB = 0;
			obs = 0;
			@child mc: MC = MC.create();

			action() {
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

			setRef(m: MC) {
				this.mcr = m;
			}
			setRefs(ms: MC[]) {
				this.mcrs = ms;
			}
			clearMCB() {
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

	describe("Snapshot diffs", () => {
		test("onSnapshotDiff applying undo/redo", () => {
			class MC extends Model {
				@state prop = 0;

				action() {
					this.prop++;
				}
			}

			class M extends Model {
				@state propA = 0;
				@state propB = 0;
				obs = 0;
				@child(MC) mc: MC = MC.create();
				@children(MC) mcs: MC[] = [MC.create(), MC.create({ prop: 1 })];

				action() {
					this.propA++;
					this.propB++;

					this.mc.action();
				}

				action2() {
					this.mcs.push(MC.create({ prop: 2 }));
				}

				action3() {
					const [first, middle, last] = this.mcs;
					this.mcs = [last, middle, first];
				}
			}

			const snapshots: SnapshotDiff[] = [];
			const m = M.create();
			onSnapshotDiff(m, (snapshot, model) => {
				expect(model).toBe(m);
				snapshots.push(snapshot);
			});

			const originalSnapshot = toSnapshot(m);

			m.action();
			m.mc.action();
			m.action2();
			m.action3();

			const modifiedSnapshot = toSnapshot(m);

			runInBatch(() =>
				snapshots.reverse().forEach((snapshot) => {
					applySnapshot(m, snapshot.undo);
				})
			);

			expect(toSnapshot(m)).toStrictEqual(originalSnapshot);

			runInBatch(() =>
				snapshots.reverse().forEach((snapshot) => {
					applySnapshot(m, snapshot.redo);
				})
			);

			expect(toSnapshot(m)).toStrictEqual(modifiedSnapshot);
		});

		test("onSnapshotDiff with child using identifiers", () => {
			class MC extends Model {
				@identifier id = 0;
				@state prop = 0;
				@state anotherProp = 0;
			}

			class M extends Model {
				@child(MC) mc: MC = MC.create();

				action() {
					this.mc = MC.create({ id: 1 });
					this.mc.prop = 1;
				}
			}

			const snapshots: SnapshotDiff[] = [];

			const m = M.create();

			onSnapshotDiff(m, (snapshot, model) => {
				expect(model).toBe(m);
				snapshots.push(snapshot);
			});

			m.action();
			expect(snapshots).toStrictEqual([
				{
					undo: {
						mc: {
							id: 0,
							prop: 0,
						},
					},
					redo: {
						mc: {
							id: 1,
							prop: 1,
						},
					},
				},
			]);

			const oldRef = m.mc;
			runInBatch(() => applySnapshot(m, snapshots[0].undo));
			expect(m.mc.id).toBe(0);
			expect(m.mc).not.toBe(oldRef);
			expect(oldRef.parent).toBe(null);
			expect(toSnapshot(m.mc)).toStrictEqual({
				anotherProp: 0,
				id: 0,
				prop: 0,
			});
		});
	});
});

describe("model context", () => {
	test("can create and consume context with default value", () => {
		const ThemeContext = createContext<"light" | "dark">("light");

		class C extends Model {
			get theme() {
				return ThemeContext.consume(this);
			}
		}

		const c = C.create();
		expect(c.theme).toBe("light");
	});

	test("can create and consume context without default value", () => {
		const UserContext = createContext<{ name: string } | null>();

		class C extends Model {
			get user() {
				return UserContext.consume(this);
			}
		}

		const c = C.create();
		expect(c.user).toBe(undefined);
	});

	test("context flows down from parent to child", () => {
		const ThemeContext = createContext<"light" | "dark">("light");

		class ChildModel extends Model {
			get theme() {
				return ThemeContext.consume(this);
			}
		}

		class ParentModel extends Model {
			theme = "dark" as const;

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child c = ChildModel.create();
		}

		const parent = ParentModel.create();
		expect(parent.c.theme).toBe("dark");
	});

	test("context flows down multiple levels", () => {
		const ThemeContext = createContext<string>("light");

		class GrandChildModel extends Model {
			get theme() {
				return ThemeContext.consume(this);
			}
		}

		class ChildModel extends Model {
			@child gc = GrandChildModel.create();
		}

		class ParentModel extends Model {
			theme = "dark";

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child c = ChildModel.create();
		}

		const parent = ParentModel.create();
		expect(parent.c.gc.theme).toBe("dark");
	});

	test("child can override parent context", () => {
		const ThemeContext = createContext<string>("light");

		class Child extends Model {
			theme = "blue";

			[ThemeContext.provide]() {
				return this.theme;
			}

			get currentTheme() {
				return ThemeContext.consume(this);
			}
		}

		class Parent extends Model {
			theme = "dark";

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child c = Child.create();
		}

		const parent = Parent.create();
		expect(parent.c.currentTheme).toBe("blue");
	});

	test("multiple independent contexts don't collide", () => {
		const ThemeContext = createContext<string>("light");
		const UserContext = createContext<string>("guest");

		class Child extends Model {
			get theme() {
				return ThemeContext.consume(this);
			}

			get user() {
				return UserContext.consume(this);
			}
		}

		class Parent extends Model {
			theme = "dark";
			user = "admin";

			[ThemeContext.provide]() {
				return this.theme;
			}

			[UserContext.provide]() {
				return this.user;
			}

			@child c = Child.create();
		}

		const parent = Parent.create();
		expect(parent.c.theme).toBe("dark");
		expect(parent.c.user).toBe("admin");
	});

	test("context is reactive", () => {
		const ThemeContext = createContext<string>("light");
		let count = 0;

		class Child extends Model {
			get theme() {
				return ThemeContext.consume(this);
			}
		}

		class Parent extends Model {
			theme = "dark";

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child c = Child.create();

			changeTheme() {
				this.theme = "blue";
			}
		}

		const parent = Parent.create();

		createEffect(() => {
			parent.c.theme;
			count++;
		});

		expect(count).toBe(1);
		expect(parent.c.theme).toBe("dark");
		parent.changeTheme();
		expect(count).toBe(2);
		expect(parent.c.theme).toBe("blue");
	});

	test("context with array of children", () => {
		const ThemeContext = createContext<string>("light");

		class Child extends Model {
			value = 0;

			get theme() {
				return ThemeContext.consume(this);
			}
		}

		class Parent extends Model {
			theme = "dark";

			[ThemeContext.provide]() {
				return this.theme;
			}

			@children cs = [Child.create(), Child.create()];
		}

		const parent = Parent.create();
		expect(parent.cs[0].theme).toBe("dark");
		expect(parent.cs[1].theme).toBe("dark");
	});

	test("detached model uses default context", () => {
		const ThemeContext = createContext<string>("light");

		class Child extends Model {
			get theme() {
				return ThemeContext.consume(this);
			}
		}

		class Parent extends Model {
			theme = "dark";

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child c: Child = Child.create();
			detachedChild: Child | null = null;

			detachChild() {
				this.detachedChild = this.c;
				this.c = null;
			}
		}

		const parent = Parent.create();
		expect(parent.c.theme).toBe("dark");
		parent.detachChild();
		expect(parent.detachedChild!.theme).toBe("light");
	});

	test("re-attached model gets parent context", () => {
		const ThemeContext = createContext<string>("light");

		class Child extends Model {
			get theme() {
				return ThemeContext.consume(this);
			}
		}

		class Parent extends Model {
			theme = "dark";

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child c: Child | null = Child.create();
			savedChild: Child | null = null;

			detachChild() {
				this.savedChild = this.c;
				this.c = null;
			}

			reattachChild() {
				this.c = this.savedChild;
				this.savedChild = null;
			}
		}

		const parent = Parent.create();
		const myChild = parent.c;
		expect(myChild!.theme).toBe("dark");
		parent.detachChild();
		expect(myChild!.theme).toBe("light");
		parent.reattachChild();
		expect(parent.c).toBe(myChild);
		expect(myChild!.theme).toBe("dark");
	});

	test("model attached to different parent gets new context", () => {
		const ThemeContext = createContext<string>("light");

		class Child extends Model {
			get theme() {
				return ThemeContext.consume(this);
			}
		}

		class Parent extends Model {
			theme: string;

			constructor() {
				super();
				this.theme = "dark";
			}

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child c: Child | null = null;

			attachChild(child: Child) {
				this.c = child;
			}
		}

		const parent1 = Parent.create();
		parent1.theme = "dark";
		const parent2 = Parent.create();
		parent2.theme = "blue";

		const myChild = Child.create();
		parent1.attachChild(myChild);
		expect(myChild.theme).toBe("dark");

		parent1.c = null;
		parent2.attachChild(myChild);
		expect(myChild.theme).toBe("blue");
	});

	test("context in detached array element uses default", () => {
		const ThemeContext = createContext<string>("light");

		class Child extends Model {
			@identifier id: number;

			get theme() {
				return ThemeContext.consume(this);
			}
		}

		class Parent extends Model {
			theme = "dark";

			[ThemeContext.provide]() {
				return this.theme;
			}

			@children cs: Child[] = [
				Child.create({ id: 0 }),
				Child.create({ id: 1 }),
			];

			removeFirst() {
				this.cs.shift();
			}
		}

		const parent = Parent.create();
		const firstChild = parent.cs[0];
		expect(firstChild.theme).toBe("dark");
		parent.removeFirst();
		expect(firstChild.theme).toBe("light");
	});

	test("context can use computed values", () => {
		const CountContext = createContext<number>(0);

		class Child extends Model {
			get count() {
				return CountContext.consume(this);
			}
		}

		class Parent extends Model {
			value = 1;

			get doubleValue() {
				return this.value * 2;
			}

			[CountContext.provide]() {
				return this.doubleValue;
			}

			@child c = Child.create();

			increment() {
				this.value++;
			}
		}

		const parent = Parent.create();
		expect(parent.c.count).toBe(2);
		parent.increment();
		expect(parent.c.count).toBe(4);
	});

	test("context can depend on child values", () => {
		const ValueContext = createContext<number>(0);

		class Child extends Model {
			value = 5;
		}

		class GrandChild extends Model {
			get contextValue() {
				return ValueContext.consume(this);
			}
		}

		class Parent extends Model {
			@child c1 = Child.create();
			@child c2 = GrandChild.create();

			[ValueContext.provide]() {
				return this.c1.value;
			}
		}

		const parent = Parent.create();
		expect(parent.c2.contextValue).toBe(5);
	});

	test("context reactivity with reaction", () => {
		const ThemeContext = createContext<string>("light");
		let reactionCount = 0;
		let currentTheme: string | undefined;

		class Child extends Model {
			get theme() {
				return ThemeContext.consume(this);
			}
		}

		class Parent extends Model {
			theme = "dark";

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child c = Child.create();

			changeTheme(newTheme: string) {
				this.theme = newTheme;
			}
		}

		const parent = Parent.create();

		createReaction(
			() => parent.c.theme,
			(theme) => {
				currentTheme = theme;
				reactionCount++;
			}
		);

		expect(reactionCount).toBe(0);
		parent.changeTheme("blue");
		expect(reactionCount).toBe(1);
		expect(currentTheme).toBe("blue");
		parent.changeTheme("green");
		expect(reactionCount).toBe(2);
		expect(currentTheme).toBe("green");
	});

	test("context with complex types", () => {
		type User = { name: string; role: string };
		const UserContext = createContext<User | null>(null);

		class Child extends Model {
			get user() {
				return UserContext.consume(this);
			}
		}

		class Parent extends Model {
			user: User = { name: "Admin", role: "admin" };

			[UserContext.provide]() {
				return this.user;
			}

			@child c = Child.create();

			updateUser(user: User) {
				this.user = user;
			}
		}

		const parent = Parent.create();
		expect(parent.c.user).toEqual({ name: "Admin", role: "admin" });
		parent.updateUser({ name: "User", role: "user" });
		expect(parent.c.user).toEqual({ name: "User", role: "user" });
	});

	test("multiple contexts can coexist without interference", () => {
		const Context1 = createContext<string>("default1");
		const Context2 = createContext<number>(0);
		const Context3 = createContext<boolean>(false);

		class Child extends Model {
			get val1() {
				return Context1.consume(this);
			}
			get val2() {
				return Context2.consume(this);
			}
			get val3() {
				return Context3.consume(this);
			}
		}

		class Parent extends Model {
			[Context1.provide]() {
				return "provided1";
			}
			[Context2.provide]() {
				return 42;
			}
			[Context3.provide]() {
				return true;
			}

			@child c = Child.create();
		}

		const parent = Parent.create();
		expect(parent.c.val1).toBe("provided1");
		expect(parent.c.val2).toBe(42);
		expect(parent.c.val3).toBe(true);
	});

	test("context not provided by nearest ancestor uses default", () => {
		const Context1 = createContext<string>("default1");
		const Context2 = createContext<string>("default2");

		class GrandChild extends Model {
			get val1() {
				return Context1.consume(this);
			}
			get val2() {
				return Context2.consume(this);
			}
		}

		class Child extends Model {
			[Context1.provide]() {
				return "from-child";
			}

			@child gc = GrandChild.create();
		}

		class Parent extends Model {
			[Context1.provide]() {
				return "from-parent";
			}
			[Context2.provide]() {
				return "from-parent-2";
			}

			@child c = Child.create();
		}

		const parent = Parent.create();
		// Context1 should come from Child (nearest ancestor)
		expect(parent.c.gc.val1).toBe("from-child");
		// Context2 should come from Parent (skips Child)
		expect(parent.c.gc.val2).toBe("from-parent-2");
	});
});
