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
	autorun,
	reaction,
} from "../src/index";

test("can create a model", () => {
	class M extends Model {}

	const model = new M();

	expect(model instanceof Model).toBe(true);
});

test("modelDidAttach is executed in an action", () => {
	class M extends Model {
		@observable count = 0;
		modelDidAttach() {
			this.count++;
		}
	}

	expect(() => new M()).not.toThrow();
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
			this.cm = new CM();
		}
	}

	const m = new M();
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
			this.cms.push(new CM());
		}
	}

	const m = new M();
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
		@child cm: CM = new CM();

		@action clearCM() {
			this.cm = null;
		}
	}

	const m = new M();
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
		@children cms: CM[] = [new CM(), new CM()];

		@action popCM() {
			this.cms.pop();
		}
	}

	const m = new M();
	expect(count).toBe(0);
	m.popCM();
	expect(count).toBe(1);
	m.popCM();
	expect(count).toBe(2);
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
			this.cm = this._cm || new CM();
			this._cm = null;
		}
	}

	const m = new M();
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
		@observable state = 0;

		constructor(state) {
			super();
			this.state = state;
		}
	}

	class M extends Model {
		@child mc: MC | null = null;

		@action addModel(state: number) {
			this.mc = new MC(state);
		}
	}

	const m = new M();
	expect(m.mc).toBe(null);
	m.addModel(1);
	expect(m.mc).toBeInstanceOf(MC);
	expect(m.mc.state).toBe(1);
});

test("child models are reactive properties", () => {
	class M extends Model {
		@child mc: M | null = null;

		@action setModel() {
			this.mc = new M();
		}
	}

	const m = new M();
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
		@child mc: MC = new MC();
	}

	const m = new M();
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

	const mc = new MC();
	const m1 = new M();
	const m2 = new M();
	m1.setModel(mc);
	expect(() => m2.setModel(mc)).toThrow();
});

test("identifiers can only be assigned once", () => {
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

	expect(() => new M1()).toThrow();
	const m = new M2();
	expect(() => m.setId()).toThrow();
});

test("can assing a model to a reference", () => {
	class MC extends Model {
		@identifier id = 0;
	}

	class M extends Model {
		@child mc: MC = new MC();
		@modelRef mr: MC;

		@action setRef() {
			this.mr = this.mc;
		}
	}

	const m = new M();
	m.setRef();
	expect(m.mc).toBe(m.mr);
});

test("can't assing a model without an identifier to a reference", () => {
	class MC extends Model {}
	class M extends Model {
		@child mc: MC = new MC();
		@modelRef mr: MC;

		@action setRef() {
			this.mr = this.mc;
		}
	}

	const m = new M();
	expect(() => m.setRef()).toThrow();
});

test("model ref is not available until the referenced model is attached", () => {
	class MC extends Model {
		@identifier id = 0;
	}

	class M extends Model {
		mctemp = new MC();
		@child mc: MC | null = null;
		@modelRef mr: MC = this.mctemp;

		@action setChild() {
			this.mc = this.mctemp;
		}
	}

	const m = new M();
	expect(m.mr).toBe(undefined);
	m.setChild();
	expect(m.mr).toBe(m.mc);
});

test("model ref will become undefined when model is detached", () => {
	class MC extends Model {
		@identifier id = 0;
	}
	class M extends Model {
		@child mc: MC = new MC();
		@modelRef mr: MC;

		@action setRef() {
			this.mr = this.mc;
		}

		@action clearModel() {
			this.mc = null;
		}
	}

	const m = new M();
	expect(m.mr).toBe(undefined);
	m.setRef();
	expect(m.mc).toBe(m.mr);
	m.clearModel();
	expect(m.mr).toBe(undefined);
});

test("model ref will become undefined when model is detached (array)", () => {
	class MC extends Model {
		@identifier id;
		constructor(id) {
			super();
			this.id = id;
		}
	}

	class M extends Model {
		@children mc: MC[] = [new MC(0), new MC(1)];
		@modelRef mr: MC;

		@action setRef() {
			this.mr = this.mc[0];
		}

		@action clearModel() {
			this.mc = [];
		}
	}

	const m = new M();
	m.setRef();
	expect(m.mc[0]).toBe(m.mr);
	m.clearModel();
	expect(m.mr).toBe(undefined);
});

test("model ref is reactive", () => {
	class MC extends Model {
		@identifier id;
		constructor(id) {
			super();
			this.id = id;
		}
	}
	class M extends Model {
		@children mc: MC[] = [new MC(0), new MC(1)];
		@modelRef mr: MC;

		@action setModel(index: number) {
			this.mr = index >= 0 ? this.mc[index] : undefined;
		}
	}

	const m = new M();
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
		@child mc: MC = new MC();
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

	const m = new M();
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
		@child mc: MC = new MC();
		@modelRef mr: MC;
		private setRef: boolean = false;

		constructor(setRef = false) {
			super();
			this.setRef = setRef;
		}

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

	const m1 = new M(true);
	const m2 = new M();

	m1.clearModel();
	expect(m1.mr).toBe(undefined);
	expect(m1.mc).toBe(null);
	m2.resetModel();
	expect(m1.mr).toBe(undefined);
	expect(m1.mc).toBe(null);
});

test("can get the parent of a model", () => {
	class MC extends Model {}
	class M extends Model {
		@child mc: MC = new MC();
		@child mc2: MC | null = null;
		@children mcs: MC[] = [new MC(), new MC()];
	}

	const m = new M();
	expect(m.parent).toBe(null);
	expect(m.mc.parent).toBe(m);
	expect(m.mcs.length).toBe(2);
	m.mcs.forEach((mc) => expect(mc.parent).toBe(m));
	m.mc2 = new MC();
	expect(m.mc2.parent).toBe(m);
	m.mcs.push(new M());
	expect(m.mcs[m.mcs.length - 1].parent).toBe(m);
});

test("model refs can be an array", () => {
	class MC extends Model {
		@identifier id;
		constructor(id) {
			super();
			this.id = id;
		}
	}
	class M extends Model {
		@child mc1: MC = new MC(1);
		@child mc2: MC = new MC(2);
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

	const m = new M();
	m.setRef();
	expect(m.mr).toEqual([m.mc1, m.mc2]);
	m.clearModel1();
	expect(m.mr).toEqual([m.mc2]);
	m.clearModel2();
	expect(m.mr).toEqual([]);
	m.restoreModel2();
	expect(m.mr).toEqual([m.mc2]);
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
			this.mcs.push(new MC());
		}
	}

	const m = new M();
	m.addChild();
	expect(childAttachedCount).toBe(1);
	m.addChild();
	expect(childAttachedCount).toBe(2);
});
