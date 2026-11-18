import { expect, test, vi } from "vitest";
import {
	applySnapshot,
	child,
	createStore,
	Model,
	mount,
	snapshot,
	Store,
	toSnapshot,
} from "../src/index.js";

test("applySnapshot loads a Model that has an ordinary Type method", () => {
	class Counter extends Model {
		n = 1;
		Type() {
			return "counter";
		}
	}
	const model = Counter.create();

	expect(applySnapshot(model, { n: 2 })).toBe(model);
	expect(model.n).toBe(2);
	expect(model.Type()).toBe("counter");
	expect(toSnapshot(model)).toEqual({ n: 2 });
});

test("pending snapshots are consumed once and mounted Stores hydrate in place", () => {
	class Counter extends Store {
		@snapshot n = 1;
	}
	const pending = createStore(Counter, { key: "counter" });
	expect(Object.keys(pending)).toEqual(["Type", "props", "key"]);

	expect(applySnapshot(pending, { state: { n: 2 } })).toBe(pending);
	using mounted = mount(pending);
	expect(mounted).toBeInstanceOf(Counter);
	expect(mounted.key).toBe("counter");
	expect(mounted.n).toBe(2);

	expect(applySnapshot(mounted, { state: { n: 3 } })).toBe(mounted);
	expect(toSnapshot(mounted)).toEqual({ state: { n: 3 } });
	using reused = mount(pending);
	expect(reused).not.toBe(mounted);
	expect(reused.n).toBe(1);
});

test("structural Store descriptors work at mount and in configured child getters", () => {
	class Counter extends Store {
		@snapshot n = 1;
	}
	const pending = {
		Type: Counter,
		props: { label: "child" },
		key: "child",
	} as unknown as Counter;
	class Root extends Store {
		static types = { counter: child };
		get counter() {
			return pending;
		}
	}

	using root = mount(createStore(Root));
	expect(root.counter).toBeInstanceOf(Counter);
	expect(root.counter.props.label).toBe("child");

	expect(applySnapshot(pending, { state: { n: 4 } })).toBe(pending);
	using mounted = mount(pending);
	expect(mounted.n).toBe(4);
});

test("invalid public targets fail without invoking a descriptor lookalike", () => {
	const Type = vi.fn(function () {});
	const fakeDescriptor = { Type, props: {} } as unknown as Store;
	const fakeModel = Object.create(Model.prototype) as Model;
	using mounted = mount(createStore(Store));

	expect(() => mount(fakeDescriptor)).toThrow(/mount.*Store descriptor/);
	expect(() => mount(mounted)).toThrow(/mount.*Store descriptor/);
	expect(() => applySnapshot(fakeDescriptor, {})).toThrow(
		/applySnapshot.*Model.*Store/
	);
	expect(() => applySnapshot(fakeModel, {})).toThrow(
		/applySnapshot.*Model.*Store/
	);
	expect(() => applySnapshot(null as unknown as Model, {})).toThrow(
		/applySnapshot.*Model.*Store/
	);
	expect(Type).not.toHaveBeenCalled();
});
