import {
	Model,
	id,
	modelRef,
	child,
	state,
	toSnapshot,
	applySnapshot,
	onSnapshot,
	effect,
	reaction,
	isObservable,
	observable,
	signal,
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
		// With shallow behavior, use deep equality for Model comparisons
		expect(mp.m).toStrictEqual(mp.mr);
		mp.m.setId();
		expect(mp.m).toStrictEqual(mp.mr);
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
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mc).toStrictEqual(m.mr);
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
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mr).toStrictEqual(m.mc);
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
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mc).toStrictEqual(m.mr);
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
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mc[0]).toStrictEqual(m.mr);
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

describe("child type validation", () => {
	test("rejects non-Model values for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) child: MC;
		}

		const m = M.create();

		expect(() => {
			m.child = "invalid" as unknown as MC;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'child' must be a Model instance, an array of Model instances, or null/undefined. Found: string]`
		);

		expect(() => {
			m.child = 123 as unknown as MC;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'child' must be a Model instance, an array of Model instances, or null/undefined. Found: number]`
		);

		expect(() => {
			m.child = {} as unknown as MC;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'child' must be a Model instance, an array of Model instances, or null/undefined. Found: object]`
		);
	});

	test("allows null and undefined for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) child: MC | null;
		}

		const m = M.create();

		expect(() => {
			m.child = null;
		}).not.toThrow();

		expect(() => {
			m.child = undefined as unknown as MC | null;
		}).not.toThrow();
	});

	test("allows Model instance for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) child: MC;
		}

		const m = M.create();
		const childModel = MC.create();

		expect(() => {
			m.child = childModel;
		}).not.toThrow();
		expect(m.child).toBe(childModel);
	});

	test("rejects array with non-Model items for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) children: MC[];
		}

		const m = M.create();

		expect(() => {
			m.children = ["invalid", "values"] as unknown as MC[];
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'children' must be a Model instance, an array of Model instances, or null/undefined. Found invalid array item: string]`
		);

		expect(() => {
			m.children = [MC.create(), "invalid"] as unknown as MC[];
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'children' must be a Model instance, an array of Model instances, or null/undefined. Found invalid array item: string]`
		);

		expect(() => {
			m.children = [123, 456] as unknown as MC[];
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'children' must be a Model instance, an array of Model instances, or null/undefined. Found invalid array item: number]`
		);
	});

	test("allows array of Model instances for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) children: MC[];
		}

		const m = M.create();
		const children = [MC.create(), MC.create()];

		expect(() => {
			m.children = children;
		}).not.toThrow();
		expect(m.children).toEqual(children);
	});

	test("allows empty array for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) children: MC[];
		}

		const m = M.create();

		expect(() => {
			m.children = [];
		}).not.toThrow();
		expect(m.children).toEqual([]);
	});
});

// `@state` is shallow-reactive (assignment triggers reactivity) and participates in snapshots.
// Values stored in `@state` are not deep-wrapped. Treat plain objects/arrays as immutable, or
// store `observable()` containers / `signal()` values if you need in-place mutation + snapshot updates.
describe("@state (snapshots; shallow by default)", () => {
	test("@state fields are reactive on assignment (property-level)", () => {
		class M extends Model {
			@state title = "a";
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

	test("toSnapshot updates after @state assignment (no stale cache)", () => {
		class M extends Model {
			@state title = "a";
			setTitle(t: string) {
				this.title = t;
			}
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ title: "a" });
		m.setTitle("b");
		expect(toSnapshot(m)).toStrictEqual({ title: "b" });
	});

	test("@state + observable() container mutations update snapshots", () => {
		class M extends Model {
			@state items: { value: number }[] = observable([]);
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

	test("@state + nested observable() containers update snapshots on deep mutation", () => {
		class M extends Model {
			@state data = observable({ nested: observable({ value: 1 }) });
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ data: { nested: { value: 1 } } });
		m.data.nested.value++;
		expect(toSnapshot(m)).toStrictEqual({ data: { nested: { value: 2 } } });
	});

	test("@state + signal() serializes current value and stays up to date", () => {
		class M extends Model {
			@state count = signal(0);
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ count: 0 });
		m.count.value = 1;
		expect(toSnapshot(m)).toStrictEqual({ count: 1 });
	});

	test("raw in-place mutation does NOT trigger onSnapshot; reassignment does", () => {
		class M extends Model {
			@state tags: string[] = [];

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

	test("observable() container in @state triggers onSnapshot on mutation", () => {
		class M extends Model {
			@state items: { id: number }[] = observable([]);

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

	test("state is included in snapshots", () => {
		class M extends Model {
			@state items: { value: number }[] = [];

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
			@state items: { value: number }[] = [];
		}

		const m = M.create();
		applySnapshot(m, { items: [{ value: 1 }, { value: 2 }] });

		expect(m.items).toEqual([{ value: 1 }, { value: 2 }]);
		// Items are NOT wrapped (shallow behavior)
		expect(isObservable(m.items[0])).toBe(false);
	});

	test("state allows structuredClone of values", () => {
		class M extends Model {
			@state data: { value: number } = { value: 1 };
		}

		const m = M.create();

		// Should NOT throw - values are plain objects
		expect(() => structuredClone(m.data)).not.toThrow();
	});
});

describe("snapshot serialization rules (JSON-only)", () => {
	describe("Date serialization", () => {
		test("Date serializes to ISO string in snapshots", () => {
			class M extends Model {
				@state createdAt: Date = new Date("2024-01-15T10:30:00.000Z");
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.createdAt).toBe("2024-01-15T10:30:00.000Z");
			expect(typeof snapshot.createdAt).toBe("string");
		});

		test("Date in nested object serializes to ISO string", () => {
			class M extends Model {
				@state data = { timestamp: new Date("2024-06-20T15:00:00.000Z") };
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({
				timestamp: "2024-06-20T15:00:00.000Z",
			});
		});

		test("Date in array serializes to ISO string", () => {
			class M extends Model {
				@state dates: Date[] = [
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
	});

	describe("Signal serialization", () => {
		test("signals serialize to their current .value in snapshots", () => {
			class M extends Model {
				@state count = signal(42);
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.count).toBe(42);
			expect(typeof snapshot.count).toBe("number");
		});

		test("signal with object value serializes the object", () => {
			class M extends Model {
				@state data = signal({ nested: { value: 123 } });
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({ nested: { value: 123 } });
		});

		test("signal with array value serializes the array", () => {
			class M extends Model {
				@state items = signal([1, 2, 3]);
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.items).toEqual([1, 2, 3]);
		});

		test("signal with Date value serializes to ISO string", () => {
			class M extends Model {
				@state when = signal(new Date("2024-03-15T12:00:00.000Z"));
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.when).toBe("2024-03-15T12:00:00.000Z");
		});
	});

	describe("Non-plain object rejection", () => {
		test("Map in @state throws on snapshot", () => {
			class M extends Model {
				@state data = new Map([["key", "value"]]);
			}

			const m = M.create();

			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support Map at path "data"/
			);
		});

		test("Set in @state throws on snapshot", () => {
			class M extends Model {
				@state items = new Set([1, 2, 3]);
			}

			const m = M.create();

			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support Set at path "items"/
			);
		});

		test("WeakMap in @state throws on snapshot", () => {
			class M extends Model {
				@state cache = new WeakMap();
			}

			const m = M.create();

			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support WeakMap at path "cache"/
			);
		});

		test("WeakSet in @state throws on snapshot", () => {
			class M extends Model {
				@state visited = new WeakSet();
			}

			const m = M.create();

			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support WeakSet at path "visited"/
			);
		});

		test("class instance in @state throws on snapshot", () => {
			class CustomClass {
				value = 42;
			}

			class M extends Model {
				@state instance = new CustomClass();
			}

			const m = M.create();

			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support class instance \(CustomClass\) at path "instance"/
			);
		});

		test("nested Map throws with correct path", () => {
			class M extends Model {
				@state data = { level1: { level2: new Map() } };
			}

			const m = M.create();

			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support Map at path "data\.level1\.level2"/
			);
		});

		test("Map in array throws with correct path", () => {
			class M extends Model {
				@state items: any[] = [{ nested: new Map() }];
			}

			const m = M.create();

			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support Map at path "items\[0\]\.nested"/
			);
		});

		test("RegExp in @state throws on snapshot", () => {
			class M extends Model {
				@state pattern = /test/gi;
			}

			const m = M.create();

			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support RegExp at path "pattern"/
			);
		});

		test("Error in @state throws on snapshot", () => {
			class M extends Model {
				@state lastError = new Error("oops");
			}

			const m = M.create();

			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support Error at path "lastError"/
			);
		});
	});

	describe("Non-JSON primitive rejection", () => {
		test("bigint in @state throws on snapshot", () => {
			class M extends Model {
				@state id = 1n;
			}

			const m = M.create();
			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support bigint at path "id"/
			);
		});

		test("symbol in @state throws on snapshot", () => {
			class M extends Model {
				@state token = Symbol("t");
			}

			const m = M.create();
			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support symbol at path "token"/
			);
		});

		test("function in @state throws on snapshot", () => {
			class M extends Model {
				@state fn = () => 1;
			}

			const m = M.create();
			expect(() => toSnapshot(m)).toThrowError(
				/r-state-tree: snapshots do not support function at path "fn"/
			);
		});
	});

	describe("Valid snapshot values", () => {
		test("plain objects are allowed", () => {
			class M extends Model {
				@state data = { a: 1, b: { c: 2 } };
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({ a: 1, b: { c: 2 } });
		});

		test("arrays are allowed", () => {
			class M extends Model {
				@state items = [1, "two", { three: 3 }];
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.items).toEqual([1, "two", { three: 3 }]);
		});

		test("primitives are allowed", () => {
			class M extends Model {
				@state str = "hello";
				@state num = 42;
				@state bool = true;
				@state nil: null = null;
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
				@state data = Object.create(null);
			}

			const m = M.create();
			m.data.key = "value";
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({ key: "value" });
		});
	});
});
