import { createElement, Suspense } from "react";
import { renderToString } from "react-dom/server";

import { createStore, mount, Store } from "../src";
import { observer, StoreProvider, useStore } from "../src/react";
import { activationFixture } from "./react-activation.fixture";

class ServerStore extends Store<{ value: string }> {
	get value() {
		return this.props.value;
	}
}

it("renders on the server without browser globals", () => {
	const store = mount(createStore(ServerStore, { value: "server" }));
	const View = observer(function View() {
		return createElement("span", null, useStore(ServerStore).value);
	});

	expect(typeof window).toBe("undefined");
	expect(
		renderToString(createElement(StoreProvider, { store }, createElement(View)))
	).toBe("<span>server</span>");

	store[Symbol.dispose]();
});

it.each(["success", "error", "suspend"] as const)(
	"disposes request-scoped render-activated resources in finally (SSR %s)",
	(outcome) => {
		const f = activationFixture("request");
		const failure = new Error("SSR failed after reading the child");
		const pending = new Promise<void>(() => {});
		const View = observer(function View() {
			const value = useStore(f.RootStore).resource.value;
			expect(f.resources).toEqual({
				constructed: 1,
				started: 1,
				active: 1,
				cleaned: 0,
			});
			if (outcome === "error") throw failure;
			if (outcome === "suspend") throw pending;
			return createElement("span", null, value);
		});
		const renderRequest = () => {
			try {
				return renderToString(
					createElement(
						StoreProvider,
						{ store: f.store },
						// A failing request must not turn into Suspense fallback HTML.
						outcome === "error"
							? createElement(View)
							: createElement(
									Suspense,
									{ fallback: "waiting" },
									createElement(View)
								)
					)
				);
			} finally {
				// SSR completion/failure does not stop Store resources.
				f.store[Symbol.dispose]();
			}
		};

		try {
			expect(typeof window).toBe("undefined");
			expect(f.resources).toEqual({
				constructed: 0,
				started: 0,
				active: 0,
				cleaned: 0,
			});
			if (outcome === "error") {
				expect(renderRequest).toThrow(failure);
			} else {
				const html = renderRequest();
				expect(html).toContain(
					outcome === "success" ? "<span>request</span>" : "waiting"
				);
			}
			expect(f.store.signal.aborted).toBe(true);
			expect(f.resources).toEqual({
				constructed: 1,
				started: 1,
				active: 0,
				cleaned: 1,
			});
			f.store[Symbol.dispose]();
			expect(f.resources.cleaned).toBe(1);
		} finally {
			f.store[Symbol.dispose]();
		}
	}
);

it("isolates resources between SSR requests and disposes only the request owner", () => {
	const first = activationFixture("first request");
	const second = activationFixture("second request");
	function renderRequest(f: ReturnType<typeof activationFixture>) {
		const View = observer(function View() {
			return createElement("span", null, useStore(f.RootStore).resource.value);
		});
		return renderToString(
			createElement(StoreProvider, { store: f.store }, createElement(View))
		);
	}

	try {
		expect(renderRequest(first)).toBe("<span>first request</span>");
		expect(first.resources.active).toBe(1);
		expect(second.resources.constructed).toBe(0);
		expect(renderRequest(second)).toBe("<span>second request</span>");
		expect(second.resources.active).toBe(1);
		const firstChild = first.store.resource;
		const secondChild = second.store.resource;
		expect(firstChild).not.toBe(secondChild);

		first.store[Symbol.dispose]();
		expect(firstChild.signal.aborted).toBe(true);
		expect(first.resources).toEqual({
			constructed: 1,
			started: 1,
			active: 0,
			cleaned: 1,
		});
		expect(secondChild.signal.aborted).toBe(false);
		expect(second.resources).toEqual({
			constructed: 1,
			started: 1,
			active: 1,
			cleaned: 0,
		});
		second.store[Symbol.dispose]();
		expect(secondChild.signal.aborted).toBe(true);
		expect(second.resources).toEqual({
			constructed: 1,
			started: 1,
			active: 0,
			cleaned: 1,
		});
	} finally {
		first.store[Symbol.dispose]();
		second.store[Symbol.dispose]();
	}
});
