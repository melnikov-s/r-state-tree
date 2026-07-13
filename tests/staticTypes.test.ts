import {
	Model,
	Store,
	applySnapshot,
	createStore,
	createContext,
	computed,
	child,
	id,
	mount,
	state,
	toSnapshot,
} from "../src/index";

test("static types config works for models", () => {
	class M extends Model {
		id = 1;
		title = "a";
		static types: any = {
			id,
			title: state,
		};
	}

	const m = M.create({ id: 2, title: "b" });
	expect(m.id).toBe(2);
	expect(m.title).toBe("b");
	expect(toSnapshot(m)).toEqual({ id: 2, title: "b" });
});

test("static types takes precedence over decorator metadata for the same key", () => {
	class M extends Model {
		@state x = 0;
		static types: any = {
			x: id,
		};
	}

	const m = M.create({ x: 1 });
	expect(toSnapshot(m)).toEqual({ x: 1 });

	applySnapshot(m, { x: 2 });
	expect(m.x).toBe(2);
});

test("configuration merges across inheritance (base decorators + derived static types)", () => {
	class Child extends Model {
		@id id = 0;
		@state name = "";
	}

	class Base extends Model {
		@id id = 0;
	}

	class Derived extends Base {
		child = Child.create();
		static types: any = {
			child: child(Child),
		};
	}

	const d = Derived.create({ id: 1, child: { id: 2, name: "x" } });
	expect(d.id).toBe(1);
	expect(d.child.id).toBe(2);
	expect(d.child.name).toBe("x");
	expect(toSnapshot(d)).toEqual({ id: 1, child: { id: 2, name: "x" } });

	applySnapshot(d, { id: 3, child: { id: 4, name: "y" } });
	expect(d.id).toBe(3);
	expect(d.child.id).toBe(4);
	expect(d.child.name).toBe("y");
});

test("models can be passed as ordinary typed props", () => {
	class User extends Model {
		@id id = 0;
		@state name = "";
	}

	class Profile extends Store<{ user: User }> {}

	const user = User.create({ id: 1, name: "Ada" });
	const store = mount(createStore(Profile, { user }));
	expect(store.props.user.name).toBe("Ada");
});

test("static types works for store child getters", () => {
	class ChildStore extends Store {
		x = 1;
	}

	class Root extends Store {
		get child() {
			return createStore(ChildStore);
		}
		static types: any = {
			child,
		};
	}

	const root = mount(createStore(Root));
	expect(root.child.x).toBe(1);
});

test("static types works with context consumption (getter stays passthrough)", () => {
	const Ctx = createContext("a");

	class Root extends Store {
		[Ctx.provide]() {
			return "b";
		}

		get child() {
			return createStore(ChildStore);
		}
		static types: any = {
			child,
		};
	}

	class ChildStore extends Store {
		get v() {
			return Ctx.consume(this);
		}
		static types: any = {
			v: computed,
		};
	}

	const root = mount(createStore(Root));
	expect(root.child.v).toBe("b");
});
