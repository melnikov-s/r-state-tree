import {
	Store,
	child,
	createStore,
	mount,
	Model,
	reaction,
	effect,
	observable,
	computed,
	createContext,
} from "../src/index";

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
		const UserContext = createContext<{ name: string }>();

		class C extends Store {
			get user() {
				return UserContext.consume(this);
			}
		}

		const c = mount(createStore(C));
		expect(c.user).toBe(undefined);
	});

	test("treats an explicit undefined argument as a supplied default", () => {
		const UserContext = createContext<{ name: string } | undefined>(undefined);

		class C extends Store {
			get user() {
				return UserContext.consume(this);
			}
		}

		const c = mount(createStore(C));
		expect(c.user).toBe(undefined);
		expect(UserContext.defaultValue).toBe(undefined);
	});

	test("rejects consuming context from a model at runtime", () => {
		const ThemeContext = createContext("light");
		const model = Model.create();
		const unsafeConsume = ThemeContext.consume as (value: unknown) => string;

		expect(() => unsafeConsume(model)).toThrow(
			"r-state-tree: Context can only be consumed by Stores"
		);
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

	test.each(["light", undefined])(
		"early context reads recover after attachment (fallback: %s)",
		(fallback) => {
			const ThemeContext =
				fallback === undefined
					? createContext<string>()
					: createContext(fallback);
			const seen: Array<string | undefined> = [];

			class ChildStore extends Store {
				initialTheme = ThemeContext.consume(this);
				initialComputedTheme = this.theme;
				stop = this.effect(() => {
					seen.push(this.theme);
				});

				@computed get theme() {
					return ThemeContext.consume(this);
				}
			}

			class ParentStore extends Store {
				theme = "dark";

				[ThemeContext.provide]() {
					return this.theme;
				}

				@child get c() {
					return createStore(ChildStore);
				}
			}

			const parent = mount(createStore(ParentStore));
			const childStore = parent.c;
			expect(childStore.initialTheme).toBe(fallback);
			expect(childStore.initialComputedTheme).toBe(fallback);
			expect(ThemeContext.consume(childStore)).toBe("dark");
			expect(childStore.theme).toBe("dark");
			expect(seen).toEqual(["dark"]);

			parent.theme = "blue";
			expect(ThemeContext.consume(childStore)).toBe("blue");
			expect(childStore.theme).toBe("blue");
			expect(seen).toEqual(["dark", "blue"]);
			parent[Symbol.dispose]();
		}
	);

	test("early context reads in realized descendants recover during tree mounting", () => {
		const ThemeContext = createContext("light");
		const seen: string[] = [];

		class LeafStore extends Store {
			initialTheme = this.theme;
			stop = this.effect(() => {
				seen.push(this.theme);
			});

			@computed get theme() {
				return ThemeContext.consume(this);
			}
		}

		class BranchStore extends Store {
			@child get leaf() {
				return createStore(LeafStore);
			}

			initialTheme = this.leaf.theme;
		}

		class RootStore extends Store {
			theme = "dark";

			[ThemeContext.provide]() {
				return this.theme;
			}

			@child get branch() {
				return createStore(BranchStore);
			}

			initialTheme = this.branch.leaf.theme;
		}

		const root = mount(createStore(RootStore));
		expect(root.initialTheme).toBe("light");
		expect(root.branch.initialTheme).toBe("light");
		expect(root.branch.leaf.initialTheme).toBe("light");
		expect(root.branch.leaf.theme).toBe("dark");
		expect(seen).toEqual(["dark"]);
		root.theme = "blue";
		expect(root.branch.leaf.theme).toBe("blue");
		expect(seen).toEqual(["dark", "blue"]);
		root[Symbol.dispose]();
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
