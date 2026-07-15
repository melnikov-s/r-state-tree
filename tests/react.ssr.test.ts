import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { createStore, mount, Store } from "../src";
import { observer, StoreProvider, useStore } from "../src/react";

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
