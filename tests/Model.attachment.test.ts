import { Model, child, computed, reaction } from "../src/index";

test("parent reactions observe detach and reattach transitions", () => {
	const transitions: Array<[Model | null, Model | null]> = [];

	class Item extends Model {}

	class Parent extends Model {
		@child item: Item | null = null;
	}

	const item = Item.create();
	const stop = reaction(
		() => item.parent,
		(next, previous) => transitions.push([next, previous])
	);
	const first = Parent.create();
	const second = Parent.create();
	first.item = item;
	first.item = null;
	second.item = item;

	expect(transitions).toEqual([
		[first, null],
		[null, first],
		[second, null],
	]);
	expect(() => item[Symbol.dispose]()).toThrow(/attached child/);
	second[Symbol.dispose]();
	expect(() => {
		first.item = item;
	}).toThrow(/disposed model/);
	stop();
});

describe("model attachment", () => {
	test("the initial snapshot is loaded before create returns", () => {
		class M extends Model {
			prop = 0;
		}

		const m = M.create({ prop: 1 });
		expect(m.prop).toBe(1);
	});

	test("named factories accept domain-specific creation parameters", () => {
		class M extends Model {
			prop = 0;
			static fromValue(prop: number) {
				return this.create({ prop });
			}
		}

		expect(M.fromValue(1).prop).toBe(1);
	});

	test("snapshot loading is batched", () => {
		class M extends Model {
			count = 0;
		}

		const m = M.create({ count: 1 });
		expect(m.count).toBe(1);
	});

	test("models can be created without a snapshot", () => {
		class M extends Model {
			prop = 0;
		}

		const m = M.create();
		expect(m.prop).toBe(0);
	});

	test("parent reactions observe children attached after creation", () => {
		class CM extends Model {}

		class M extends Model {
			@child cm!: CM;

			setCM() {
				this.cm = CM.create();
			}
		}

		const m = M.create();
		const observedModel = CM.create();
		const parents: Array<Model | null> = [];
		const stop = reaction(
			() => observedModel.parent,
			(parent) => parents.push(parent)
		);
		m.cm = observedModel;
		expect(parents).toEqual([m]);
		stop();
	});

	test("parent reactions observe children added to a list", () => {
		class CM extends Model {}

		class M extends Model {
			@child cms: CM[] = [];

			addCM() {
				this.cms.push(CM.create());
			}
		}

		const m = M.create();
		m.addCM();
		m.addCM();
		expect(m.cms).toHaveLength(2);
		m.cms.forEach((child) => expect(child.parent).toBe(m));
	});

	test("parent reactions observe an initialized child", () => {
		class CM extends Model {}

		class M extends Model {
			@child cm: CM = CM.create();
		}

		const m = M.create();
		expect(m.cm).toBeInstanceOf(CM);
		expect(m.cm.parent).toBe(m);
	});

	test("parent reactions observe initialized child arrays", () => {
		class CM extends Model {}

		class M extends Model {
			@child cms: CM[] = [CM.create(), CM.create()];
		}

		const m = M.create();
		expect(m.cms.length).toBe(2);
		m.cms.forEach((child) => expect(child.parent).toBe(m));
	});

	test("parent reactions observe child detachment", () => {
		class CM extends Model {}

		class M extends Model {
			@child cm: CM | null = CM.create();

			clearCM() {
				this.cm = null;
			}
		}

		const m = M.create();
		const observedModel = m.cm!;
		m.clearCM();
		expect(observedModel.parent).toBe(null);
	});

	test("parent reactions observe children removed from a list", () => {
		class CM extends Model {}

		class M extends Model {
			@child cms: CM[] = [CM.create(), CM.create()];

			popCM() {
				this.cms.pop();
			}
		}

		const m = M.create();
		const children = [...m.cms];
		m.popCM();
		m.popCM();
		children.forEach((child) => expect(child.parent).toBe(null));
	});

	test("re-ordering preserves attachment", () => {
		class CM extends Model {}

		class M extends Model {
			@child cms: CM[] = [CM.create(), CM.create()];

			reverse() {
				this.cms = this.cms.slice().reverse();
			}
		}

		const m = M.create();
		const children = [...m.cms];
		m.reverse();
		expect(m.cms).toEqual(children.reverse());
		m.cms.forEach((child) => expect(child.parent).toBe(m));
	});

	test("external reactions observe attachment", () => {
		class CM extends Model {}

		class M extends Model {
			@child cm!: CM;
			setCM() {
				this.cm = CM.create();
			}
		}

		const m = M.create();
		const observedModel = CM.create();
		const parents: Array<Model | null> = [];
		const stop = reaction(
			() => observedModel.parent,
			(parent) => parents.push(parent)
		);
		m.cm = observedModel;
		expect(parents).toEqual([m]);
		stop();
	});

	test("external reactions receive the previous parent on detachment", () => {
		class CM extends Model {}

		class M extends Model {
			@child cm: CM | null = CM.create();
			_temp!: CM;
			clearCM() {
				this._temp = this.cm!;
				this.cm = null;
			}
		}

		const m = M.create();
		const observedModel = m.cm!;
		const transitions: Array<[Model | null, Model | null]> = [];
		const stop = reaction(
			() => observedModel.parent,
			(parent, previousParent) => transitions.push([parent, previousParent])
		);
		m.clearCM();
		expect(transitions).toEqual([[null, m]]);
		stop();
	});
});

test("can re-attach an detached model", () => {
	class CM extends Model {
		state = 0;
		incState() {
			this.state++;
		}

		get computed() {
			return this.state * 2;
		}
	}

	class M extends Model {
		@child cm!: CM | null;
		_cm: CM | null = null;

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
	const observedModel = m.cm!;
	const transitions: Array<[Model | null, Model | null]> = [];
	const stop = reaction(
		() => observedModel.parent,
		(parent, previousParent) => transitions.push([parent, previousParent])
	);
	m.cm!.incState();
	expect(m.cm!.computed).toBe(2);
	m.clearCM();
	m.setCM();
	expect(transitions).toEqual([
		[null, m],
		[m, null],
	]);
	expect(m.cm!.computed).toBe(2);
	m.cm!.incState();
	expect(m.cm!.computed).toBe(4);
	stop();
});

test("can have a child model", () => {
	class MC extends Model {
		state = 0;
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
	expect(m.mc!.state).toBe(1);
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
		@child mc!: MC;
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
	class MC extends Model {}

	class M extends Model {
		@child mcs!: any;

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
	expect(m.mcs[0].parent).toBe(m);
	m.addChild();
	expect(m.mcs[1].parent).toBe(m);
});

describe("child type validation", () => {
	test("rejects non-Model values for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) child!: MC;
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
			@child(MC) child!: MC | null;
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
			@child(MC) child!: MC;
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
			@child(MC) children!: MC[];
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
			@child(MC) children!: MC[];
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
			@child(MC) children!: MC[];
		}

		const m = M.create();

		expect(() => {
			m.children = [];
		}).not.toThrow();
		expect(m.children).toEqual([]);
	});
});
