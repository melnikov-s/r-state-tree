import {
	Store,
	child,
	createStore,
	mount,
	Model,
	updateStore,
	reaction,
	effect,
	observable,
	computed,
} from "../src/index";

test("can update store props with updateStore", () => {
	class S extends Store<any> {}

	const store = mount(createStore(S, { myProp: 1 }));
	expect(store.props.myProp).toBe(1);
	updateStore(store, { myProp: 2 });
	expect(store.props.myProp).toBe(2);
});

test("can use interface as props without index signature", () => {
	interface PageStoreProps {
		pageId: string;
		title?: string;
	}

	class PageStore extends Store<PageStoreProps> {
		get displayTitle() {
			return this.props.title || `Page ${this.props.pageId}`;
		}
	}

	interface TTSStoreProps {
		voice?: string;
		pageStore: PageStore;
	}

	class TTSStore extends Store<TTSStoreProps> {
		get voiceName() {
			return this.props.voice || "default";
		}
	}

	const pageStore = mount(createStore(PageStore, { pageId: "home" }));

	const ttsStore = mount(
		createStore(TTSStore, {
			voice: "nova",
			pageStore,
			key: "tts-1",
		})
	);

	expect(ttsStore.props.voice).toBe("nova");
	expect(ttsStore.props.pageStore).toBe(pageStore);
	expect(ttsStore.props.pageStore.props.pageId).toBe("home");
	expect(ttsStore.voiceName).toBe("nova");
	expect(pageStore.displayTitle).toBe("Page home");
});

test("can access props in constructor", () => {
	class S extends Store<any> {
		prop = {};
		@child get child() {
			return createStore(C, { prop: this.prop });
		}
	}
	class C extends Store<any> {
		prop = this.props.prop;
	}

	const s = mount(createStore(S));
	expect(s.child.prop).toBe(s.prop);
});

test("can access models from props in constructor", () => {
	class M extends Model {}
	class S extends Store<any> {
		model = M.create();
		@child get child() {
			return createStore(C, { model: this.model });
		}
	}
	class C extends Store<any> {
		prop: any;
		constructor(propsValue: any) {
			super(propsValue);
			this.prop = this.props.model;
		}
	}

	const s = mount(createStore(S));
	expect(s.child.prop).toBe(s.model);
});

test("props are reactive", () => {
	let propsCounter = 0;

	class S extends Store<any> {
		state = observable({ value: 0 });
		get value() {
			return this.state.value;
		}
		set value(v) {
			this.state.value = v;
		}

		inc() {
			this.state.value++;
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

test("when props change only those computed methods that are directly affected are triggered", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}

		@computed get values() {
			return [this.props.values];
		}
	}

	class S extends Store<any> {
		state = observable({ value: 0, values: [0] });
		get value() {
			return this.state.value;
		}
		set value(v) {
			this.state.value = v;
		}
		get values() {
			return this.state.values;
		}
		set values(v) {
			this.state.values = v;
		}

		@child get c() {
			return createStore(C, {
				value: this.state.value,
				values: this.state.values,
			});
		}

		inc() {
			this.value++;
		}
	}

	let count = 0;
	const s = mount(createStore(S));
	let result;
	effect(() => (result = s.c.value));
	effect(() => {
		s.c.values;
		count++;
	});

	expect(count).toBe(1);
	expect(result).toBe(0);
	s.inc();
	expect(result).toBe(1);
	expect(count).toBe(1);
});

test("models can be passed as regular store props", () => {
	class M extends Model {}
	class S extends Store<{ m: M }> {}

	const m = M.create();
	const s = mount(createStore(S, { m }));
	expect(s.props.m).toBe(m);
});

test("model arrays can be passed as regular store props", () => {
	class M extends Model {}
	class S extends Store<{ ms: M[] }> {}

	const ms = [M.create(), M.create()];
	const s = mount(createStore(S, { ms }));
	expect(s.props.ms).toEqual(ms);
});

test("models on the store can be updated", () => {
	class M1 extends Model {
		state = 0;
	}
	class M2 extends Model {
		state = 0;
	}

	class CS extends Store<{ m: M1 | M2 }> {}

	class S extends Store<any> {
		_state = observable({ active: false });
		get state() {
			return this._state.active;
		}
		set state(v) {
			this._state.active = v;
		}

		switchModel() {
			this.state = !this.state;
		}

		@child get cs() {
			return createStore(CS, {
				m: this.state ? this.props.m2 : this.props.m1,
			});
		}
	}

	const m1 = M1.create();
	const m2 = M2.create();
	const s = mount(createStore(S, { m1, m2 }));
	expect(s.cs.props.m).toBe(m1);
	s.switchModel();
	expect(s.cs.props.m).toBe(m2);
});

test("models on the store are reactive", () => {
	let count = 0;

	class M1 extends Model {
		state = 0;
	}
	class M2 extends Model {
		state = 0;
	}

	class CS extends Store<{ m: M1 | M2; m1: M1 }> {
		@computed get models() {
			return [this.props.m1];
		}
	}

	class S extends Store<any> {
		_state = observable({ active: false });
		get state() {
			return this._state.active;
		}
		set state(v) {
			this._state.active = v;
		}

		switchModel() {
			this.state = !this.state;
		}

		@child get cs() {
			return createStore(CS, {
				m: this.state ? this.props.m1 : this.props.m2,
				m1: this.props.m1,
			});
		}
	}

	const m1 = M1.create();
	const m2 = M2.create();
	const s = mount(createStore(S, { m1, m2 }));

	reaction(
		() => s.cs.props.m,
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

test("store properties are observable and trigger effects when changed", () => {
	class S extends Store<any> {
		state = observable({ value: 0 });
		get value() {
			return this.state.value;
		}
		set value(v) {
			this.state.value = v;
		}

		increment() {
			this.value++;
		}
	}

	const store = mount(createStore(S));
	let observedValue: number | undefined;
	const observedValues: number[] = [];

	effect(() => {
		observedValue = store.value;
		observedValues.push(observedValue);
	});

	expect(observedValue).toBe(0);

	store.increment();
	expect(observedValue).toBe(1);

	store.increment();
	expect(observedValue).toBe(2);

	store.value = 10;
	expect(observedValue).toBe(10);

	// Verify all expected values were observed (may have duplicates due to getter re-runs)
	expect(observedValues).toContain(0);
	expect(observedValues).toContain(1);
	expect(observedValues).toContain(2);
	expect(observedValues).toContain(10);
});

test("store reference properties are observable", () => {
	class Child extends Store<any> {
		state = observable({ name: "initial" });
		get name() {
			return this.state.name;
		}
		set name(v) {
			this.state.name = v;
		}
	}

	class Parent extends Store<any> {
		state = observable({ childRef: null as Child | null });
		get childRef() {
			return this.state.childRef;
		}
		set childRef(v) {
			this.state.childRef = v;
		}

		setChild(child: Child) {
			this.childRef = child;
		}
	}

	const child1 = mount(createStore(Child));
	const child2 = mount(createStore(Child));
	child2.name = "child2";

	const parent = mount(createStore(Parent));

	let effectRunCount = 0;
	let observedRef: Child | null = null;

	effect(() => {
		observedRef = parent.childRef;
		effectRunCount++;
	});

	expect(effectRunCount).toBe(1);
	expect(observedRef).toBe(null);

	parent.setChild(child1);
	expect(effectRunCount).toBe(2);
	expect(observedRef).toBe(child1);

	parent.setChild(child2);
	expect(effectRunCount).toBe(3);
	expect(observedRef).toBe(child2);
	expect((observedRef as any)?.name).toBe("child2");
});

test("plain store properties are observable", () => {
	class S extends Store<any> {
		count = 0;

		increment() {
			this.count++;
		}
	}

	const store = mount(createStore(S));
	let effectRunCount = 0;
	let observedCount: number | undefined;

	effect(() => {
		observedCount = store.count;
		effectRunCount++;
	});

	expect(effectRunCount).toBe(1);
	expect(observedCount).toBe(0);

	store.increment();
	expect(effectRunCount).toBe(2);
	expect(observedCount).toBe(1);

	store.count = 10;
	expect(effectRunCount).toBe(3);
	expect(observedCount).toBe(10);
});

test("store dynamic observable properties", async () => {
	class Child extends Store<any> {
		map = observable(new Map());

		@computed get valueGetter() {
			return this.map.get("value");
		}
	}

	class S extends Store<any> {
		@child get child() {
			return createStore(Child);
		}

		@computed get valueGetter() {
			return this.child.valueGetter;
		}
	}

	const s = mount(createStore(S));
	let count = 0;
	effect(() => {
		count++;
		s.valueGetter;
	});
	expect(count).toBe(1);
	s.child.map.set("value", 1);
	expect(count).toBe(2);
});

describe("Accessor + Decorators Regression", () => {
	test("models remain accessible through regular props", () => {
		class RootModel extends Model {
			// no state needed
		}
		class S extends Store<{ root: RootModel }> {
			get ok() {
				return this.props.root instanceof RootModel;
			}
		}

		const root = RootModel.create({});
		const s = mount(createStore(S, { root }));
		expect(s.ok).toBe(true);
		expect(s.props.root).toBe(root);
	});

	test("Store @child getter still returns a mounted child store instance", () => {
		class Child extends Store {
			count = 0;
			inc() {
				this.count++;
			}
		}
		class Parent extends Store {
			@child get child(): any {
				return createStore(Child, { key: "child" });
			}
		}

		const p = mount(createStore(Parent)) as any;
		const seen: number[] = [];
		const dispose = effect(() => {
			seen.push(p.child.count);
		});
		expect(seen[0]).toBe(0);
		p.child.inc();
		expect(seen.at(-1)).toBe(1);
		dispose();
	});

	test("Undecorated accessor on Store is NOT treated as observable property (should not hide missing metadata bugs)", () => {
		class S extends Store {
			_x = 1;
			get x() {
				return this._x;
			}
			set x(v: number) {
				this._x = v;
			}
		}

		const s = mount(createStore(S)) as any;
		let runs = 0;
		const dispose = effect(() => {
			// If the accessor itself is treated as an observable "field", this can become reactive twice.
			// We want it to be "transparent": reactive ONLY because of its dependencies (like _x),
			// but NOT tracked as a discrete observable property itself.
			void s.x;
			runs++;
		});
		expect(runs).toBe(1);
		s.x = 2;
		// Expect 2: re-runs once because _x changed, but NOT twice.
		expect(runs).toBe(2);
		dispose();
	});
});
