// @vitest-environment jsdom

import {
	act,
	Component,
	createElement,
	StrictMode,
	Suspense,
	useEffect,
	type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";

import { observer, StoreProvider, useStore } from "../src/react";
import { activationFixture } from "./react-activation.fixture";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const inactive = { constructed: 0, started: 0, active: 0, cleaned: 0 };
const active = { constructed: 1, started: 1, active: 1, cleaned: 0 };
const disposed = { constructed: 1, started: 1, active: 0, cleaned: 1 };

function setup() {
	const fixture = activationFixture();
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);

	return {
		...fixture,
		container,
		render(view: ReactNode) {
			root.render(createElement(StoreProvider, { store: fixture.store }, view));
		},
		unmount() {
			act(() => root.unmount());
		},
		cleanup() {
			act(() => root.unmount());
			container.remove();
			fixture.store[Symbol.dispose]();
		},
	};
}

it("keeps a render-activated child alive after rendering throws before commitment", () => {
	const f = setup();
	const failure = new Error("render failed after reading the child");
	const caught: unknown[] = [];
	let commits = 0;
	class ErrorBoundary extends Component<
		{ children?: ReactNode },
		{ failed: boolean }
	> {
		state = { failed: false };
		static getDerivedStateFromError() {
			return { failed: true };
		}
		componentDidCatch(error: unknown) {
			caught.push(error);
		}
		render() {
			return this.state.failed ? "failed" : this.props.children;
		}
	}
	const View = observer(function View() {
		useEffect(() => {
			commits++;
		}, []);
		void useStore(f.RootStore).resource.value;
		// Activation has already happened, before the render can fail.
		expect(f.resources).toEqual(active);
		throw failure;
	});
	// React reports caught render errors in development.
	const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});

	try {
		expect(f.resources).toEqual(inactive);
		act(() =>
			f.render(createElement(ErrorBoundary, null, createElement(View)))
		);
		expect(caught).toEqual([failure]);
		expect(commits).toBe(0);
		expect(f.container.textContent).toBe("failed");
		expect(f.resources).toEqual(active);

		f.unmount();
		expect(f.store.signal.aborted).toBe(false);
		expect(f.resources).toEqual(active);
		f.store[Symbol.dispose]();
		f.store[Symbol.dispose]();
		expect(f.resources).toEqual(disposed);
	} finally {
		diagnostic.mockRestore();
		f.cleanup();
	}
});

it.each(["retry", "abandon"] as const)(
	"keeps a render-activated child owned by the Store across Suspense (%s)",
	async (outcome) => {
		const f = setup();
		let ready = false;
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		let commits = 0;
		const View = observer(function View() {
			useEffect(() => {
				commits++;
			}, []);
			const value = useStore(f.RootStore).resource.value;
			expect(f.resources).toEqual(active);
			if (!ready) throw pending;
			return createElement("span", null, value);
		});

		try {
			expect(f.resources).toEqual(inactive);
			await act(async () => {
				f.render(
					createElement(Suspense, { fallback: "waiting" }, createElement(View))
				);
			});
			expect(f.container.textContent).toBe("waiting");
			expect(commits).toBe(0);
			expect(f.resources).toEqual(active);
			const child = f.store.resource;

			if (outcome === "retry") {
				await act(async () => {
					ready = true;
					release();
					await pending;
				});
				expect(f.container.textContent).toBe("child");
				expect(commits).toBe(1);
				expect(f.store.resource).toBe(child);
				expect(f.resources).toEqual(active);
			}

			f.unmount();
			if (outcome === "abandon") {
				await act(async () => {
					ready = true;
					release();
					await pending;
				});
				expect(commits).toBe(0);
			}
			expect(child.signal.aborted).toBe(false);
			expect(f.resources).toEqual(active);
			f.store[Symbol.dispose]();
			expect(child.signal.aborted).toBe(true);
			expect(f.resources).toEqual(disposed);
		} finally {
			f.cleanup();
		}
	}
);

it("does not reacquire lazy child resources during Strict Mode replay", () => {
	const f = setup();
	const View = observer(function View() {
		return createElement("span", null, useStore(f.RootStore).resource.value);
	});

	try {
		expect(f.resources).toEqual(inactive);
		act(() => f.render(createElement(StrictMode, null, createElement(View))));
		expect(f.container.textContent).toBe("child");
		expect(f.resources).toEqual(active);
		f.unmount();
		expect(f.resources).toEqual(active);
		f.store[Symbol.dispose]();
		expect(f.resources).toEqual(disposed);
	} finally {
		f.cleanup();
	}
});
