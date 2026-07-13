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
	updateStore,
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

test("createStore requires required props and preserves optional props", () => {
	class EmptyStore extends Store<Record<string, never>> {}
	createStore(EmptyStore);
	createStore(EmptyStore, {});
	class OptionalStore extends Store<{ label?: string }> {}
	createStore(OptionalStore);
	createStore(OptionalStore, { label: "Example" });

	interface ResourceProps {
		resourceId: string;
		rootModel: Model;
		label?: string;
	}

	class ResourceStore extends Store<ResourceProps> {}
	const rootModel = Model.create();

	createStore(ResourceStore, { resourceId: "1", rootModel });
	createStore(ResourceStore, {
		resourceId: "1",
		rootModel,
		label: "Example",
	});
	createStore(ResourceStore, { resourceId: "1", rootModel, key: "1" });

	// @ts-expect-error required creation props cannot be omitted
	createStore(ResourceStore);
	// @ts-expect-error all required creation props must be supplied
	createStore(ResourceStore, {});
	// @ts-expect-error resourceId is required even when other props are supplied
	createStore(ResourceStore, { rootModel });
	// @ts-expect-error rootModel is required even when optional props are supplied
	createStore(ResourceStore, { resourceId: "1", label: "Example" });

	class PatchStore extends Store<{ id: string; label?: string }> {}
	const store = mount(createStore(PatchStore, { id: "1" }));
	updateStore(store, { label: "Updated" });
	expect(store.props.label).toBe("Updated");
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
