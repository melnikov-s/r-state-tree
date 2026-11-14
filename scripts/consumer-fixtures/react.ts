import { createElement, type ReactNode } from "react";
import { Store, createStore } from "r-state-tree";
import {
	observer,
	StoreProvider,
	useStore,
	useOptionalStore,
} from "r-state-tree/react";

class Counter extends Store {
	count = 42;
}

const View = observer(function View() {
	const required: Counter = useStore(Counter);
	const optional: Counter | null = useOptionalStore(Counter);
	return createElement("span", null, required.count, optional?.count);
});
const store = createStore(Counter);
const app: ReactNode = createElement(
	StoreProvider,
	{ store },
	createElement(View)
);
store[Symbol.dispose]();
void app;
