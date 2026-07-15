// @vitest-environment jsdom

import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { createStore, mount, Store, updateStore } from "../src";
import {
	observer,
	StoreProvider,
	useOptionalStore,
	useStore,
} from "../src/react";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class TestStore extends Store<{ value: string; unrelated: number }> {
	get value() {
		return this.props.value;
	}

	get unrelated() {
		return this.props.unrelated;
	}
}

class SpecializedTestStore extends TestStore {}

function realize(
	value: string,
	unrelated = 0,
	Type: typeof TestStore = TestStore
) {
	return mount(createStore(Type, { value, unrelated }));
}

function render(element: ReactNode) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);

	act(() => {
		root.render(element);
	});

	return { container, root };
}

function unmount(root: Root, container: HTMLElement) {
	act(() => {
		root.unmount();
	});
	container.remove();
}

describe("r-state-tree/react", () => {
	it("rerenders when a reactive value read during rendering changes", () => {
		const store = realize("first");
		let renders = 0;
		const View = observer(function View({ store }: { store: TestStore }) {
			renders++;
			return createElement("span", null, store.value);
		});
		const { container, root } = render(createElement(View, { store }));
		const initialRenders = renders;

		expect(container.textContent).toBe("first");
		act(() => updateStore(store, { value: "second" }));
		expect(container.textContent).toBe("second");
		expect(renders).toBeGreaterThan(initialRenders);

		unmount(root, container);
		store[Symbol.dispose]();
	});

	it("does not rerender for unrelated reactive changes", () => {
		const store = realize("first");
		let renders = 0;
		const View = observer(function View({ store }: { store: TestStore }) {
			renders++;
			return createElement("span", null, store.value);
		});
		const { container, root } = render(createElement(View, { store }));
		const initialRenders = renders;

		act(() => updateStore(store, { unrelated: 1 }));
		expect(container.textContent).toBe("first");
		expect(renders).toBe(initialRenders);

		unmount(root, container);
		store[Symbol.dispose]();
	});

	it("returns the nearest Store of the exact provided type", () => {
		const outer = realize("outer");
		const inner = realize("inner");
		const Consumer = () =>
			createElement("span", null, useStore(TestStore).value);
		const { container, root } = render(
			createElement(
				StoreProvider,
				{ store: outer },
				createElement(Consumer),
				createElement(StoreProvider, { store: inner }, createElement(Consumer))
			)
		);

		expect(container.textContent).toBe("outerinner");

		unmount(root, container);
		outer[Symbol.dispose]();
		inner[Symbol.dispose]();
	});

	it("does not use subclass providers for base-class lookup", () => {
		const store = realize("specialized", 0, SpecializedTestStore);
		const Consumer = () => {
			const specialized = useStore(SpecializedTestStore);
			const base = useOptionalStore(TestStore);
			return createElement(
				"span",
				null,
				`${specialized.value}:${base === null ? "missing" : "base"}`
			);
		};
		const { container, root } = render(
			createElement(StoreProvider, { store }, createElement(Consumer))
		);

		expect(container.textContent).toBe("specialized:missing");

		unmount(root, container);
		store[Symbol.dispose]();
	});

	it("throws a descriptive error when a Store is missing", () => {
		const Consumer = () =>
			createElement("span", null, useStore(TestStore).value);

		expect(() => renderToString(createElement(Consumer))).toThrow(
			"r-state-tree/react: No StoreProvider found for TestStore"
		);
	});

	it("returns null when an optional Store is missing", () => {
		const Consumer = () =>
			createElement(
				"span",
				null,
				useOptionalStore(TestStore) === null ? "missing" : "present"
			);
		const { container, root } = render(createElement(Consumer));

		expect(container.textContent).toBe("missing");
		unmount(root, container);
	});

	it("does not implicitly provide Store-valued component props", () => {
		const store = realize("prop");
		const Consumer = () =>
			createElement(
				"span",
				null,
				useOptionalStore(TestStore) === null ? "missing" : "provided"
			);
		const Boundary = observer(function Boundary({
			store: _store,
		}: {
			store: TestStore;
		}) {
			return createElement(Consumer);
		});
		const { container, root } = render(createElement(Boundary, { store }));

		expect(container.textContent).toBe("missing");

		unmount(root, container);
		store[Symbol.dispose]();
	});

	it("does not dispose a Store when its provider unmounts", () => {
		const store = realize("provided");
		const { container, root } = render(
			createElement(StoreProvider, { store }, createElement("span"))
		);

		expect(store.signal.aborted).toBe(false);
		unmount(root, container);
		expect(store.signal.aborted).toBe(false);

		store[Symbol.dispose]();
		expect(store.signal.aborted).toBe(true);
	});

	it("keeps multiple observed component instances isolated", () => {
		const first = realize("first");
		const second = realize("second");
		const renders = new Map<TestStore, number>();
		const View = observer(function View({ store }: { store: TestStore }) {
			renders.set(store, (renders.get(store) ?? 0) + 1);
			return createElement("span", null, store.value);
		});
		const { container, root } = render(
			createElement(
				"div",
				null,
				createElement(View, { store: first }),
				createElement(View, { store: second })
			)
		);
		const firstRenders = renders.get(first);
		const secondRenders = renders.get(second);

		act(() => updateStore(first, { value: "updated" }));
		expect(container.textContent).toBe("updatedsecond");
		expect(renders.get(first)).toBeGreaterThan(firstRenders!);
		expect(renders.get(second)).toBe(secondRenders);

		unmount(root, container);
		first[Symbol.dispose]();
		second[Symbol.dispose]();
	});

	it("is safe under React Strict Mode", () => {
		const store = realize("first");
		const View = observer(function View() {
			return createElement("span", null, store.value);
		});
		const { container, root } = render(
			createElement(StrictMode, null, createElement(View))
		);

		act(() => updateStore(store, { value: "second" }));
		expect(container.textContent).toBe("second");
		unmount(root, container);
		expect(store.signal.aborted).toBe(false);

		store[Symbol.dispose]();
	});
});
