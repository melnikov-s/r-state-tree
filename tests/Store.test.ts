import {
	observable,
	action,
	computed,
	Store,
	child,
	children,
	createStore,
	mount,
	autorun,
	Model,
	model,
	reaction,
	updateStore,
} from "../src/index";

test("can mount a store", () => {
	class S extends Store {}

	const store = mount(createStore(S, { myProp: 1 }));

	expect(store instanceof Store).toBe(true);
	expect(store.props.myProp).toBe(1);
});

test("can update store props with updateStore", () => {
	class S extends Store {}

	const store = mount(createStore(S, { myProp: 1 }));
	expect(store.props.myProp).toBe(1);
	updateStore(store, { myProp: 2 });
	expect(store.props.myProp).toBe(2);
});

test("can create a child store", () => {
	class S extends Store {
		@child
		get c() {
			return createStore(C, { prop: 0 });
		}
	}
	class C extends Store {}

	const s = mount(createStore(S));

	expect(s.c).toBeInstanceOf(C);
	expect(s.c.props.prop).toBe(0);
});

test("child store can be null", () => {
	class S extends Store {
		@observable mounted = true;
		@child
		get c() {
			return this.mounted ? createStore(C, { prop: 0 }) : null;
		}

		@action unmountChild() {
			this.mounted = false;
		}
	}
	class C extends Store {}
	const s = mount(createStore(S));
	expect(s.c).toBeInstanceOf(C);
	s.unmountChild();
	expect(s.c).toBe(null);
});

test("can create an array of child stores", () => {
	class S extends Store {
		@children
		get cs() {
			return types.map((Type, i) => createStore(Type, { prop: i }));
		}
	}
	class C extends Store {}
	class C1 extends Store {}
	class C2 extends Store {}

	const types = [C, C1, C2];

	const s = mount(createStore(S));
	expect(Array.isArray(s.cs));
	s.cs.forEach((c, i) => {
		expect(c).toBeInstanceOf(types[i]);
		expect(c.props.prop).toBe(i);
	});
});

test("updates an array of stores", () => {
	class S extends Store {
		@observable
		value = 0;

		@action
		inc() {
			this.value++;
		}

		@children
		get cs() {
			return types.map((Type, i) =>
				createStore(Type, { prop: this.value + i })
			);
		}
	}
	class C extends Store {}
	class C1 extends Store {}
	class C2 extends Store {}

	const types = [C, C1, C2];

	const s = mount(createStore(S));
	const equals = (v) => expect(s.cs.map((c) => c.props.prop)).toEqual(v);
	equals([0, 1, 2]);
	s.inc();
	equals([1, 2, 3]);
	s.inc();
	equals([2, 3, 4]);
});

test("child stores are reactive", () => {
	class C extends Store {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store {
		@observable values = [];
		@action add() {
			this.values.push(this.values.length);
		}
		@children get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	autorun(() => {
		s.c.length;
		count++;
	});

	s.add();
	expect(count).toBe(2);
	s.add();
	expect(count).toBe(3);
});

test("child store can be retrieved during an action", () => {
	class C extends Store {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store {
		@observable value = false;
		@action add() {
			count++;
			this.value = true;
			expect(this.c).toBeInstanceOf(C);
		}
		@child get c() {
			return this.value ? createStore(C, { value: this.value }) : null;
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	autorun(() => {
		s.c;
	});

	s.add();
	expect(count).toBe(1);
});

test("children stores can be retrieved during an action", () => {
	class C extends Store {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store {
		@observable values = [];
		@action add() {
			count++;
			this.values.push(this.values.length);
			expect(this.c.length).toBe(this.values.length);
		}
		@children get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	autorun(() => {
		s.c.length;
	});

	s.add();
	expect(count).toBe(1);
});

test("child stores do not trigger listeners when only props change", () => {
	class C extends Store {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store {
		@observable values = [1, 2];
		@action changeValues() {
			this.values = this.values.map((v) => v + 1);
		}
		@children get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	autorun(() => {
		s.c.length;
		count++;
	});

	expect(s.c.map((c) => c.value)).toEqual([1, 2]);
	s.changeValues();
	expect(count).toBe(1);
	expect(s.c.map((c) => c.value)).toEqual([2, 3]);
});

test("child stores are reactive", () => {
	class C extends Store {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store {
		@observable values = [];
		@action add() {
			this.values.push(this.values.length);
		}
		@children get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	autorun(() => {
		s.c.length;
		count++;
	});

	s.add();
	expect(count).toBe(2);
	s.add();
	expect(count).toBe(3);
});

test("child stores with keys", () => {
	class C extends Store {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store {
		@observable keys = [1, 2, 3];
		@children get cs() {
			return this.keys.map((value) => createStore(C, { value, key: value }));
		}
		@action reverse() {
			this.keys.reverse();
		}
	}

	const s = mount(createStore(S));
	const stores = s.cs.slice();
	expect(stores.length).toBe(3);
	let count = 0;
	autorun(() => {
		count++;
		s.cs;
	});
	expect(count).toBe(1);
	s.reverse();
	expect(count).toBe(2);
	expect(stores[0]).toBe(s.cs[2]);
	expect(stores[1]).toBe(s.cs[1]);
	expect(stores[2]).toBe(s.cs[0]);
});

test("props are reactive", () => {
	let propsCounter = 0;

	class S extends Store {
		@observable
		value = 0;

		@action
		inc() {
			this.value++;
		}

		@child
		get c() {
			propsCounter++;
			return createStore(S, {
				value: this.value + this.props.value,
			});
		}
	}

	const s = mount(createStore(S, { value: 0 }));
	expect(s.c.c.c.props.value).toEqual(0);
	expect(propsCounter).toBe(3);
	s.c.c.c.props.value; // call getter
	expect(propsCounter).toBe(3);
	s.c.inc();
	expect(s.c.c.c.props.value).toEqual(1);
	expect(propsCounter).toBe(5);
	s.c.c.c.props.value; // call getter
	expect(propsCounter).toBe(5);
});

test("will call `storeDidMount` when a root store mounts", () => {
	let count = 0;

	class S extends Store {
		storeDidMount() {
			count++;
		}
	}

	mount(createStore(S));
	expect(count).toBe(1);
});

test("storeDidMount is executed in an action", () => {
	class S extends Store {
		@observable count = 0;
		storeDidMount() {
			this.count++;
		}
	}

	let s;
	expect(() => (s = mount(createStore(S)))).not.toThrow();
	expect(s.count).toBe(1);
});

test("when props change only those computed methods that are directly affected are triggered", () => {
	class C extends Store {
		@computed
		get value() {
			return this.props.value;
		}

		@computed
		get values() {
			return [this.props.values];
		}
	}

	class S extends Store {
		@observable value = 0;
		@observable values = [0];

		@child get c() {
			return createStore(C, { value: this.value, values: this.values });
		}

		@action
		inc() {
			this.value++;
		}
	}

	let count = 0;
	const s = mount(createStore(S));
	let result;
	autorun(() => (result = s.c.value));
	autorun(() => {
		s.c.values;
		count++;
	});

	expect(count).toBe(1);
	expect(result).toBe(0);
	s.inc();
	expect(result).toBe(1);
	expect(count).toBe(1);
});

test("context test", () => {
	class C extends Store {
		@computed
		get value() {
			const context = this.context;
			return context.value;
		}

		@computed
		get values() {
			return [this.context.values];
		}
	}

	let provideCount = 0;

	class S extends Store {
		@observable value = 0;
		@observable values = [0];

		provideContext() {
			provideCount++;
			return {
				value: this.value,
				values: this.values,
			};
		}

		@child get c() {
			return createStore(C);
		}

		@action
		inc() {
			this.value++;
		}
	}

	let count = 0;
	const s = mount(createStore(S));
	let result;
	autorun(() => (result = s.c.value));
	autorun(() => {
		s.c.values;
		count++;
	});

	expect(provideCount).toBe(1);
	expect(count).toBe(1);
	expect(result).toBe(0);
	s.inc();
	expect(result).toBe(1);
	expect(count).toBe(1);
	expect(provideCount).toBe(2);
	expect(s.c.value).toBe(1);
});

test("context can use child store values", () => {
	class CS1 extends Store {
		@observable value = {};
	}
	class CS2 extends Store {}

	class S extends Store {
		provideContext() {
			return {
				value: this.cs1.value,
			};
		}

		@child get cs1() {
			return createStore(CS1);
		}

		@child get cs2() {
			return createStore(CS2);
		}
	}

	const s = mount(createStore(S));
	expect(s.cs2.context.value).toBe(s.cs1.value);
});

test("context can use child store values (children)", () => {
	class CS1 extends Store {
		@observable value = {};
	}
	class CS2 extends Store {}

	class S extends Store {
		provideContext() {
			return {
				value: this.css[0].value,
			};
		}

		@children get css() {
			return [createStore(CS1)];
		}

		@child get cs2() {
			return createStore(CS2);
		}
	}

	const s = mount(createStore(S));
	expect(s.cs2.context.value).toBe(s.css[0].value);
});

test("models on the store can be accessed", () => {
	class M extends Model {}
	class S extends Store {
		@model m: M;
	}

	const m = M.create();
	const s = mount(createStore(S, { models: { m } }));
	expect(s.m).toBe(m);
});

test("models on the store default to null", () => {
	class M extends Model {}
	class S extends Store {
		@model m: M;
	}

	const s = mount(createStore(S));
	expect(s.m).toBe(null);
});

test("models on the store are read only", () => {
	class M extends Model {}
	class S extends Store {
		@model m: M;
	}

	const s = mount(createStore(S));
	expect(() => (s.m = M.create())).toThrow();
});

test("models on the store can't have an initializer", () => {
	class M extends Model {}
	class S extends Store {
		@model m: M = M.create();
	}

	expect(() => mount(createStore(S))).toThrow();
});

test("models on the store can be an array", () => {
	class M extends Model {}
	class S extends Store {
		@model ms: M[];
	}

	const models = [M.create(), M.create()];
	const s = mount(createStore(S, { models: { ms: models } }));
	expect(s.ms).toEqual(models);
});

test("models on the store can be updated", () => {
	class M1 extends Model {
		@observable state = 0;
	}
	class M2 extends Model {
		@observable state = 0;
	}

	class CS extends Store {
		@model m: M1 | M2;
	}

	class S extends Store {
		@observable state = false;
		@model m1: M1;
		@model m2: M2;

		@action switchModel() {
			this.state = !this.state;
		}

		@child get cs() {
			return createStore(CS, { models: { m: this.state ? this.m2 : this.m1 } });
		}
	}

	const m1 = M1.create();
	const m2 = M2.create();
	const s = mount(createStore(S, { models: { m1, m2 } }));
	expect(s.cs.m).toBe(m1);
	s.switchModel();
	expect(s.cs.m).toBe(m2);
});
test("models on the store are reactive", () => {
	let count = 0;

	class M1 extends Model {
		@observable state = 0;
	}
	class M2 extends Model {
		@observable state = 0;
	}

	class CS extends Store {
		@model m: M1 | M2;
		@model m1: M1;

		@computed get models() {
			return [this.m1];
		}
	}

	class S extends Store {
		@observable state = false;
		@model m1: M1;
		@model m2: M2;

		@action switchModel() {
			this.state = !this.state;
		}

		@child get cs() {
			return createStore(CS, {
				models: { m: this.state ? this.m1 : this.m2, m1: this.m1 },
			});
		}
	}

	const m1 = M1.create();
	const m2 = M2.create();
	const s = mount(createStore(S, { models: { m1, m2 } }));

	reaction(
		() => s.cs.m,
		() => count++
	);

	// should never trigger
	reaction(
		() => s.cs.models,
		() => count++
	);

	expect(count).toBe(0);
	s.switchModel();
	expect(count).toBe(1);
	s.switchModel();
	expect(count).toBe(2);
});

test("can't initianialize store directly", () => {
	class S extends Store {}

	expect(() => new S()).toThrow();
});

test("can setup a reaction in a store", () => {
	class S extends Store {
		@observable prop = 0;
		count = 0;
		unsub;

		storeDidMount() {
			this.unsub = this.reaction(
				() => this.prop,
				() => this.count++
			);
		}
		@action inc() {
			this.prop++;
		}
	}

	const s = mount(createStore(S));
	expect(s.count).toBe(0);
	s.inc();
	expect(s.count).toBe(1);
	s.inc();
	expect(s.count).toBe(2);
	s.unsub();
	s.inc();
	expect(s.count).toBe(2);
});

test("reaction in a store will auto unsub after store is unmounted ", () => {
	class C extends Store {
		storeDidMount() {
			this.reaction(
				() => this.props.prop,
				() => this.props.countUp()
			);
		}
	}

	class S extends Store {
		@observable mounted = true;
		@observable prop = 0;
		count = 0;

		@child get c() {
			return this.mounted
				? createStore(C, {
						inc: this.inc.bind(this),
						prop: this.prop,
						countUp: () => this.count++,
				  })
				: null;
		}

		@action inc() {
			this.prop++;
		}

		@action unMountChild() {
			this.mounted = false;
		}
	}

	const s = mount(createStore(S));
	expect(s.count).toBe(0);
	expect(s.c).toBeTruthy(); // mounts the store
	s.inc();
	expect(s.count).toBe(1);
	s.inc();
	expect(s.count).toBe(2);
	s.unMountChild();
	expect(s.c).toBe(null);
	s.inc();
	expect(s.count).toBe(2);
});
