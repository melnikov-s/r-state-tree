/* eslint-disable @typescript-eslint/no-explicit-any */
import {
	Store,
	child,
	createStore,
	mount,
	unmount,
	Model,
	model,
	updateStore,
	reaction,
	effect,
	observable,
	computed,
	createContext,
} from "../src/index";

test("can mount a store", () => {
	class S extends Store<any> {}

	const store = mount(createStore(S, { myProp: 1 }));

	expect(store instanceof Store).toBe(true);
	expect(store.props.myProp).toBe(1);
});

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
			models: { someModel: null },
			key: "tts-1",
		})
	);

	expect(ttsStore.props.voice).toBe("nova");
	expect(ttsStore.props.pageStore).toBe(pageStore);
	expect(ttsStore.props.pageStore.props.pageId).toBe("home");
	expect(ttsStore.voiceName).toBe("nova");
	expect(pageStore.displayTitle).toBe("Page home");
});

test("can create a child store", () => {
	class S extends Store<any> {
		@child
		get c() {
			return createStore(C, { prop: 0 });
		}
	}
	class C extends Store<any> {}

	const s = mount(createStore(S));

	expect(s.c).toBeInstanceOf(C);
	expect(s.c.props.prop).toBe(0);
});

test("child store can be null", () => {
	class S extends Store<any> {
		state = observable({ mounted: true });
		get mounted() {
			return this.state.mounted;
		}
		set mounted(v) {
			this.state.mounted = v;
		}

		@child
		get c() {
			return this.mounted ? createStore(C, { prop: 0 }) : null;
		}

		unmountChild() {
			this.mounted = false;
		}
	}
	class C extends Store<any> {}
	const s = mount(createStore(S));
	expect(s.c).toBeInstanceOf(C);
	s.unmountChild();
	expect(s.c).toBe(null);
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
			return createStore(C, { models: { model: this.model } });
		}
	}
	class C extends Store<any> {
		@model model;
		prop;
		constructor(props) {
			super(props);
			this.prop = this.model;
		}
	}

	const s = mount(createStore(S));
	expect(s.child.prop).toBe(s.model);
});

test("can create an array of child stores", () => {
	class S extends Store<any> {
		@child
		get cs() {
			return types.map((Type, i) => createStore(Type, { prop: i }));
		}
	}
	class C extends Store<any> {}
	class C1 extends Store<any> {}
	class C2 extends Store<any> {}

	const types = [C, C1, C2];

	const s = mount(createStore(S));
	expect(Array.isArray(s.cs));
	s.cs.forEach((c, i) => {
		expect(c).toBeInstanceOf(types[i]);
		expect(c.props.prop).toBe(i);
	});
});

test("updates an array of stores", () => {
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
		get cs() {
			return types.map((Type, i) =>
				createStore(Type, { prop: this.value + i })
			);
		}
	}
	class C extends Store<any> {}
	class C1 extends Store<any> {}
	class C2 extends Store<any> {}

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
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		values = observable([]);
		add() {
			this.values.push(this.values.length);
		}
		@child get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	effect(() => {
		s.c.length;
		count++;
	});

	s.add();
	expect(count).toBe(2);
	s.add();
	expect(count).toBe(3);
});

test("child store can be retrieved during an action", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		state = observable({ value: false });
		get value() {
			return this.state.value;
		}
		set value(v) {
			this.state.value = v;
		}
		add() {
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

	effect(() => {
		s.c;
	});

	s.add();
	expect(count).toBe(1);
});

test("children stores can be retrieved during an action", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		values = observable([]);
		add() {
			count++;
			this.values.push(this.values.length);
			expect(this.c.length).toBe(this.values.length);
		}
		@child get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	effect(() => {
		s.c.length;
	});

	s.add();
	expect(count).toBe(1);
});

test("child stores do not trigger listeners when only props change", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		state = observable({ values: [1, 2] });
		get values() {
			return this.state.values;
		}
		set values(v) {
			this.state.values = v;
		}

		changeValues() {
			this.state.values = this.state.values.map((v) => v + 1);
		}
		@child get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	effect(() => {
		s.c.length;
		count++;
	});

	expect(s.c.map((c) => c.value)).toEqual([1, 2]);
	s.changeValues();
	expect(count).toBe(1);
	expect(s.c.map((c) => c.value)).toEqual([2, 3]);
});

test("child stores are reactive", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		values = observable([]);
		add() {
			this.values.push(this.values.length);
		}
		@child get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	effect(() => {
		s.c.length;
		count++;
	});

	s.add();
	expect(count).toBe(2);
	s.add();
	expect(count).toBe(3);
});

test("child stores with keys", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		keys = observable([1, 2, 3]);
		@child get cs() {
			return this.keys.map((value) => createStore(C, { value, key: value }));
		}
		reverse() {
			this.keys.reverse();
		}
	}

	const s = mount(createStore(S));
	const stores = s.cs.slice();
	expect(stores.length).toBe(3);
	let count = 0;
	effect(() => {
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

test("will call `storeDidMount` when a root store mounts", () => {
	let count = 0;

	class S extends Store<any> {
		storeDidMount() {
			count++;
		}
	}

	mount(createStore(S));
	expect(count).toBe(1);
});

test("storeDidMount is executed in an action", () => {
	class S extends Store<any> {
		state = observable({ count: 0 });
		get count() {
			return this.state.count;
		}
		set count(v) {
			this.state.count = v;
		}
		storeDidMount() {
			this.state.count++;
		}
	}

	let s;
	expect(() => (s = mount(createStore(S)))).not.toThrow();
	expect(s.count).toBe(1);
});

test("will call `storeWillUnmount` when a root store unmounts", () => {
	let count = 0;

	class S extends Store<any> {
		storeWillUnmount() {
			count++;
		}
	}

	const s = mount(createStore(S));
	expect(count).toBe(0);
	unmount(s);
	expect(count).toBe(1);
});

test("storeWillUnmount is executed in an action", () => {
	class S extends Store<any> {
		state = observable({ count: 0 });
		get count() {
			return this.state.count;
		}
		set count(v) {
			this.state.count = v;
		}
		storeWillUnmount() {
			this.state.count++;
		}
	}

	const s = mount(createStore(S));
	expect(s.count).toBe(0);
	unmount(s);
	expect(s.count).toBe(1);
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

test("models on the store can be accessed", () => {
	class M extends Model {}
	class S extends Store<any> {
		@model m: M;
	}

	const m = M.create();
	const s = mount(createStore(S, { models: { m } }));
	expect(s.m).toBe(m);
});

test("models on the store default to null", () => {
	class M extends Model {}
	class S extends Store<any> {
		@model m: M;
	}

	const s = mount(createStore(S));
	expect(s.m).toBe(null);
});

test("models on the store are read only", () => {
	class M extends Model {}
	class S extends Store<any> {
		@model m: M;
	}

	const s = mount(createStore(S));
	expect(() => (s.m = M.create())).toThrow();
});

test("models on the store can't have an initializer", () => {
	class M extends Model {}
	class S extends Store<any> {
		@model m: M = M.create();
	}

	expect(() => mount(createStore(S))).toThrow();
});

test("models on the store can be an array", () => {
	class M extends Model {}
	class S extends Store<any> {
		@model ms: M[];
	}

	const models = [M.create(), M.create()];
	const s = mount(createStore(S, { models: { ms: models } }));
	expect(s.ms).toEqual(models);
});

test("models on the store can be updated", () => {
	class M1 extends Model {
		state = 0;
	}
	class M2 extends Model {
		state = 0;
	}

	class CS extends Store<any> {
		@model m: M1 | M2;
	}

	class S extends Store<any> {
		_state = observable({ active: false });
		get state() {
			return this._state.active;
		}
		set state(v) {
			this._state.active = v;
		}

		@model m1: M1;
		@model m2: M2;

		switchModel() {
			this.state = !this.state;
		}

		@child get cs() {
			return createStore(CS, {
				models: { m: this.state ? this.m2 : this.m1 },
			});
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
		state = 0;
	}
	class M2 extends Model {
		state = 0;
	}

	class CS extends Store<any> {
		@model m: M1 | M2;
		@model m1: M1;

		@computed get models() {
			return [this.m1];
		}
	}

	class S extends Store<any> {
		@model m1: M1;
		@model m2: M2;

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
	class S extends Store<any> {}

	expect(() => new S({})).toThrow();
});

test("can setup a reaction in a store", () => {
	class S extends Store<any> {
		state = observable({ prop: 0, count: 0 });
		get prop() {
			return this.state.prop;
		}
		set prop(v) {
			this.state.prop = v;
		}
		get count() {
			return this.state.count;
		}
		set count(v) {
			this.state.count = v;
		}
		unsub;

		storeDidMount() {
			this.unsub = this.reaction(
				() => this.prop,
				() => this.count++
			);
		}
		inc() {
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
	class C extends Store<any> {
		storeDidMount() {
			this.reaction(
				() => this.props.prop,
				() => this.props.countUp()
			);
		}
	}

	class S extends Store<any> {
		// Refactoring multiple observables
		state = observable({ mounted: true, prop: 0, count: 0 });
		get mounted() {
			return this.state.mounted;
		}
		set mounted(v) {
			this.state.mounted = v;
		}
		get prop() {
			return this.state.prop;
		}
		set prop(v) {
			this.state.prop = v;
		}
		get count() {
			return this.state.count;
		}
		set count(v) {
			this.state.count = v;
		}

		@child get c() {
			return this.mounted
				? createStore(C, {
						inc: this.inc.bind(this),
						prop: this.prop,
						countUp: () => this.count++,
				  })
				: null;
		}

		inc() {
			this.prop++;
		}

		unMountChild() {
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

describe("store context", () => {
	test("can create and consume context with default value", () => {
		const ThemeContext = createContext<"light" | "dark">("light");

		class C extends Store {
			get theme() {
				return ThemeContext.consume(this);
			}
		}

		const c = mount(createStore(C));
		expect(c.theme).toBe("light");
	});

	test("can create and consume context without default value", () => {
		const UserContext = createContext<{ name: string } | null>();

		class C extends Store {
			get user() {
				return UserContext.consume(this);
			}
		}

		const c = mount(createStore(C));
		expect(c.user).toBe(undefined);
	});

	test("context flows down from parent to child store", () => {
		const ThemeContext = createContext<"light" | "dark">("light");

		class ChildStore extends Store<any> {
			@computed get theme() {
				return ThemeContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			theme = "dark" as const;

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child
			get c() {
				return createStore(ChildStore);
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.c.theme).toBe("dark");
	});

	test("context flows down multiple levels", () => {
		const ThemeContext = createContext<string>("light");

		class GrandChildStore extends Store<any> {
			@computed get theme() {
				return ThemeContext.consume(this);
			}
		}

		class ChildStore extends Store<any> {
			@child
			get gc() {
				return createStore(GrandChildStore);
			}
		}

		class ParentStore extends Store<any> {
			state = observable({ theme: "dark" });
			get theme() {
				return this.state.theme;
			}
			set theme(v) {
				this.state.theme = v;
			}

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child
			get c() {
				return createStore(ChildStore);
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.c.gc.theme).toBe("dark");
	});

	test("child can override parent context", () => {
		const ThemeContext = createContext<string>("light");

		class ChildStore extends Store<any> {
			theme = "blue";

			[ThemeContext.provide]() {
				return this.theme;
			}

			@computed get currentTheme() {
				return ThemeContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			state = observable({ theme: "dark" });
			get theme() {
				return this.state.theme;
			}
			set theme(v) {
				this.state.theme = v;
			}

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child
			get c() {
				return createStore(ChildStore);
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.c.currentTheme).toBe("blue");
	});

	test("multiple independent contexts don't collide", () => {
		const ThemeContext = createContext<string>("light");
		const UserContext = createContext<string>("guest");

		class ChildStore extends Store<any> {
			@computed get theme() {
				return ThemeContext.consume(this);
			}

			@computed get user() {
				return UserContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			state = observable({ theme: "dark", user: "admin" });
			get theme() {
				return this.state.theme;
			}
			set theme(v) {
				this.state.theme = v;
			}
			get user() {
				return this.state.user;
			}
			set user(v) {
				this.state.user = v;
			}

			[ThemeContext.provide]() {
				return this.theme;
			}

			[UserContext.provide]() {
				return this.user;
			}

			@child
			get c() {
				return createStore(ChildStore);
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.c.theme).toBe("dark");
		expect(parent.c.user).toBe("admin");
	});

	test("context is reactive", () => {
		const ThemeContext = createContext<string>("light");
		let count = 0;

		class ChildStore extends Store<any> {
			@computed get theme() {
				return ThemeContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			state = observable({ theme: "dark" });
			get theme() {
				return this.state.theme;
			}
			set theme(v) {
				this.state.theme = v;
			}

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child
			get c() {
				return createStore(ChildStore);
			}

			changeTheme() {
				this.theme = "blue";
			}
		}

		const parent = mount(createStore(ParentStore));

		effect(() => {
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

		class ChildStore extends Store<any> {
			@computed get theme() {
				return ThemeContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			state = observable({ theme: "dark", items: [0, 1] });
			get theme() {
				return this.state.theme;
			}
			set theme(v) {
				this.state.theme = v;
			}
			get items() {
				return this.state.items;
			}
			set items(v) {
				this.state.items = v;
			}

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child
			get cs() {
				return this.items.map(() => createStore(ChildStore));
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.cs[0].theme).toBe("dark");
		expect(parent.cs[1].theme).toBe("dark");
	});

	test("unmounted child store uses default context", () => {
		const ThemeContext = createContext<string>("light");

		class ChildStore extends Store<any> {
			@computed get theme() {
				return ThemeContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			state = observable({ theme: "dark", mounted: true });
			get theme() {
				return this.state.theme;
			}
			set theme(v) {
				this.state.theme = v;
			}
			get mounted() {
				return this.state.mounted;
			}
			set mounted(v) {
				this.state.mounted = v;
			}

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child
			get c() {
				return this.mounted ? createStore(ChildStore) : null;
			}

			unmountChild() {
				this.mounted = false;
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.c!.theme).toBe("dark");
		parent.unmountChild();
		expect(parent.c).toBe(null);
	});

	test("re-mounted child store gets parent context", () => {
		const ThemeContext = createContext<string>("light");

		class ChildStore extends Store<any> {
			@computed get theme() {
				return ThemeContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			state = observable({ theme: "dark", mounted: true });
			get theme() {
				return this.state.theme;
			}
			set theme(v) {
				this.state.theme = v;
			}
			get mounted() {
				return this.state.mounted;
			}
			set mounted(v) {
				this.state.mounted = v;
			}

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child
			get c() {
				return this.mounted ? createStore(ChildStore) : null;
			}

			unmountChild() {
				this.mounted = false;
			}

			remountChild() {
				this.mounted = true;
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.c!.theme).toBe("dark");
		parent.unmountChild();
		expect(parent.c).toBe(null);
		parent.remountChild();
		expect(parent.c!.theme).toBe("dark");
	});

	test("context can use computed values", () => {
		const CountContext = createContext<number>(0);

		class ChildStore extends Store<any> {
			@computed get count() {
				return CountContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			@computed get doubleValue() {
				return this.value * 2;
			}

			[CountContext.provide]() {
				return this.doubleValue;
			}

			state = observable({ value: 1 });
			get value() {
				return this.state.value;
			}
			set value(v) {
				this.state.value = v;
			}

			@child
			get c() {
				return createStore(ChildStore);
			}

			increment() {
				this.state.value++;
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.c.count).toBe(2);
		parent.increment();
		expect(parent.c.count).toBe(4);
	});

	test("context can depend on child values", () => {
		const ValueContext = createContext<number>(0);

		class ChildStore1 extends Store<any> {
			state = observable({ value: 5 });
			get value() {
				return this.state.value;
			}
			set value(v) {
				this.state.value = v;
			}
		}

		class ChildStore2 extends Store<any> {
			@computed get contextValue() {
				return ValueContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			@child
			get c1() {
				return createStore(ChildStore1);
			}

			@child
			get c2() {
				return createStore(ChildStore2);
			}

			[ValueContext.provide]() {
				return this.c1.value;
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.c2.contextValue).toBe(5);
	});

	test("context reactivity with reaction", () => {
		const ThemeContext = createContext<string>("light");
		let reactionCount = 0;
		let currentTheme: string | undefined;

		class ChildStore extends Store<any> {
			@computed get theme() {
				return ThemeContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			[ThemeContext.provide]() {
				return this.theme;
			}

			@child
			get c() {
				return createStore(ChildStore);
			}

			state = observable({ theme: "light" });
			get theme() {
				return this.state.theme;
			}
			set theme(v) {
				this.state.theme = v;
			}

			changeTheme(newTheme: string) {
				this.theme = newTheme;
			}
		}

		const parent = mount(createStore(ParentStore));

		reaction(
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

		class ChildStore extends Store<any> {
			@computed get user() {
				return UserContext.consume(this);
			}
		}

		class ParentStore extends Store<any> {
			state = observable({ user: { name: "Admin", role: "admin" } });
			get user() {
				return this.state.user;
			}
			set user(v: User) {
				this.state.user = v;
			}

			[UserContext.provide]() {
				return this.user;
			}

			@child
			get c() {
				return createStore(ChildStore);
			}

			updateUser(user: User) {
				this.user = user;
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.c.user).toEqual({ name: "Admin", role: "admin" });
		parent.updateUser({ name: "User", role: "user" });
		expect(parent.c.user).toEqual({ name: "User", role: "user" });
	});

	test("multiple contexts can coexist without interference", () => {
		const Context1 = createContext<string>("default1");
		const Context2 = createContext<number>(0);
		const Context3 = createContext<boolean>(false);

		class ChildStore extends Store<any> {
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

		class ParentStore extends Store<any> {
			[Context1.provide]() {
				return "provided1";
			}
			[Context2.provide]() {
				return 42;
			}
			[Context3.provide]() {
				return true;
			}

			@child
			get c() {
				return createStore(ChildStore);
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.c.val1).toBe("provided1");
		expect(parent.c.val2).toBe(42);
		expect(parent.c.val3).toBe(true);
	});

	test("context not provided by nearest ancestor uses default", () => {
		const Context1 = createContext<string>("default1");
		const Context2 = createContext<string>("default2");

		class GrandChildStore extends Store<any> {
			get val1() {
				return Context1.consume(this);
			}
			get val2() {
				return Context2.consume(this);
			}
		}

		class ChildStore extends Store<any> {
			[Context1.provide]() {
				return "from-child";
			}

			@child
			get gc() {
				return createStore(GrandChildStore);
			}
		}

		class ParentStore extends Store<any> {
			[Context1.provide]() {
				return "from-parent";
			}
			[Context2.provide]() {
				return "from-parent-2";
			}

			@child
			get c() {
				return createStore(ChildStore);
			}
		}

		const parent = mount(createStore(ParentStore));
		// Context1 should come from Child (nearest ancestor)
		expect(parent.c.gc.val1).toBe("from-child");
		// Context2 should come from Parent (skips Child)
		expect(parent.c.gc.val2).toBe("from-parent-2");
	});
});

describe("recursive mount diagnostics", () => {
	class SharedModel extends Model {}

	class RecursiveStore extends Store<{ models: { shared: SharedModel } }> {
		@model shared!: SharedModel;

		storeDidMount() {
			// Access the child during mount to trigger recursive creation
			this.loop;
		}

		@child get loop() {
			return createStore(RecursiveStore, { models: { shared: this.shared } });
		}
	}

	const mountRecursiveStore = () =>
		mount(
			createStore(RecursiveStore, {
				models: { shared: SharedModel.create() },
			})
		);

	test("recursive mount surfaces circular creation error instead of stack overflow", () => {
		expect(mountRecursiveStore).toThrowError(
			/detected circular store\/model creation/
		);
	});

	test("circular mount error reports guidance to break recursion", () => {
		try {
			mountRecursiveStore();
		} catch (error) {
			if (error instanceof Error) {
				expect(error.message).toContain(
					"detected circular store/model creation"
				);
				expect(error.message).toContain("RecursiveStore");
				expect(error.message).toContain("models: shared");
				expect(error.message).toContain("storeDidMount");
				return;
			}
			throw error;
		}
		throw new Error("expected recursive mount to throw");
	});
});

describe("child type validation", () => {
	test("rejects non-StoreElement values for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get c() {
				return "invalid" as unknown as ReturnType<typeof createStore<C>>;
			}
		}

		const s = mount(createStore(S));
		expect(() => {
			s.c;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'c' must be a StoreElement ({ Type, props, key }), an array of StoreElements, or null/undefined. Found: string]`
		);
	});

	test("rejects invalid StoreElement objects", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get c() {
				return { Type: "not a function" } as unknown as ReturnType<
					typeof createStore<C>
				>;
			}
		}

		const s = mount(createStore(S));
		expect(() => {
			s.c;
		}).toThrow();
	});

	test("allows null for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get c() {
				return null;
			}
		}

		const s = mount(createStore(S));
		expect(s.c).toBe(null);
	});

	test("allows undefined for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get c() {
				return undefined as unknown as ReturnType<typeof createStore<C>> | null;
			}
		}

		const s = mount(createStore(S));
		expect(s.c).toBe(null);
	});

	test("allows valid StoreElement for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get c() {
				return createStore(C, { prop: 1 });
			}
		}

		const s = mount(createStore(S));
		expect(s.c).toBeInstanceOf(C);
		expect(s.c!.props.prop).toBe(1);
	});

	test("rejects array with non-StoreElement items for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get cs() {
				return ["invalid", "values"] as unknown as ReturnType<
					typeof createStore<C>
				>[];
			}
		}

		const s = mount(createStore(S));
		expect(() => {
			s.cs;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'cs' must be a StoreElement ({ Type, props, key }), an array of StoreElements, or null/undefined. Found invalid array item: string]`
		);
	});

	test("rejects array with invalid StoreElement objects", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get cs() {
				return [
					createStore(C, { prop: 1 }),
					{ Type: "not a function" },
				] as unknown as ReturnType<typeof createStore<C>>[];
			}
		}

		const s = mount(createStore(S));
		expect(() => {
			s.cs;
		}).toThrow();
	});

	test("allows array of StoreElements for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get cs() {
				return [createStore(C, { prop: 1 }), createStore(C, { prop: 2 })];
			}
		}

		const s = mount(createStore(S));
		expect(Array.isArray(s.cs)).toBe(true);
		expect(s.cs!.length).toBe(2);
		expect(s.cs![0]).toBeInstanceOf(C);
		expect(s.cs![1]).toBeInstanceOf(C);
	});

	test("allows empty array for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get cs() {
				return [];
			}
		}

		const s = mount(createStore(S));
		expect(Array.isArray(s.cs)).toBe(true);
		expect(s.cs!.length).toBe(0);
	});

	test("validates child property when it changes reactively", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			state = observable({ shouldReturnInvalid: false });
			get shouldReturnInvalid() {
				return this.state.shouldReturnInvalid;
			}
			set shouldReturnInvalid(v) {
				this.state.shouldReturnInvalid = v;
			}

			@child get c() {
				if (this.state.shouldReturnInvalid) {
					return "invalid" as unknown as ReturnType<typeof createStore<C>>;
				}
				return createStore(C, { prop: 1 });
			}
		}

		const s = mount(createStore(S));
		expect(s.c).toBeInstanceOf(C);

		expect(() => {
			s.shouldReturnInvalid = true;
			s.c;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'c' must be a StoreElement ({ Type, props, key }), an array of StoreElements, or null/undefined. Found: string]`
		);
	});
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
	expect(observedRef?.name).toBe("child2");
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
	test("Store @model is still resolved via props.models (not as an observable field)", () => {
		class RootModel extends Model {
			// no state needed
		}
		class S extends Store<{ models: { root: RootModel } }> {
			@model root!: RootModel;
			// Accessing root must not throw and must return the model from props
			get ok() {
				return this.root instanceof RootModel;
			}
		}

		const root = RootModel.create({});
		const s = mount(createStore(S, { models: { root } }));
		expect(s.ok).toBe(true);
		expect(s.root).toBe(root);
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
		let seen: number[] = [];
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
