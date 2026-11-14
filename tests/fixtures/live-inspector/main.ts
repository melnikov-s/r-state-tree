/// <reference types="vite/client" />
import {
	Store,
	Model,
	child,
	computed,
	createStore,
	mount,
	effect,
	createContext,
} from "../../../src/index";
import {
	createInspector,
	connectViteInspector,
} from "../../../devtools/src/devtools";
import { token } from "virtual:r-state-tree-inspector";

let mounts = 0;
let providerReads = 0;
const DemoContext = createContext<{ label: string; count: number }>({
	label: "Default services",
	count: 0,
});
class Leaf extends Store {
	value = "Hello from an initialized child";
	contextLabel() {
		return DemoContext.consume(this).label;
	}
	constructor(props: Leaf["props"]) {
		super(props);
		this.effect(() => {
			mounts++;
			return () => {
				mounts--;
			};
		});
	}
}
class Counter extends Store<{
	title: string;
	onAdd: (amount: number) => number;
	onRename: (title: string) => string;
}> {
	static types = {
		lazy: child,
		broken: child,
		double: computed,
		mountedChildren: computed,
		contextReads: computed,
	};
	count = 1;
	[DemoContext.provide]() {
		providerReads++;
		return { label: "Counter services", count: this.count };
	}
	get contextReads() {
		return providerReads;
	}
	settings = {
		title: "Counter",
		enabled: true,
		density: "comfortable",
		step: 1,
	};
	password = "fixture-secret-never-transport";
	configure(
		title: string,
		enabled: boolean,
		density: "compact" | "comfortable",
		step = 1
	) {
		this.settings = { title, enabled, density, step };
		return this.settings.title;
	}
	async add(amount: number) {
		await Promise.resolve();
		if (this.signal.aborted) return this.count;
		// Concurrent calls intentionally add independent deltas; no result replaces state.
		this.count += amount;
		return this.count;
	}
	fail() {
		this.count++;
		throw new Error("fixture-error-never-transport");
	}
	get double() {
		return this.count * 2;
	}
	get lazy() {
		return createStore(Leaf, { key: "selected" });
	}
	get broken() {
		throw new Error("fixture-error-never-transport");
	}
	get mountedChildren() {
		return mounts;
	}
}
const counter: Counter = mount(
	createStore(Counter, {
		title: "Counter controls",
		onAdd: (amount: number): number => {
			counter.count += amount;
			return counter.count;
		},
		onRename(this: { title: string }, title: string) {
			this.title = title;
			return this.title;
		},
	})
);
const stop = effect(() => {
	document.querySelector("#count")!.textContent = String(counter.count);
});
const increment = () => {
	counter.count++;
};
const incrementButton = document.querySelector("#increment")!;
incrementButton.addEventListener("click", increment);
if (import.meta.hot) {
	const parameters = new URLSearchParams(location.search);
	class Document extends Model {
		static types = { upper: computed };
		title = "Live document";
		get upper() {
			return this.title.toUpperCase();
		}
	}
	const documentModel = Document.create();
	const inspector = createInspector({
		// Explicit opt-in for the fixture. Normal inspection remains read-only.
		controls: parameters.get("controls") === "1",
		activity: parameters.get("activity") === "1",
	});
	inspector.registerRoot("Counter", counter);
	inspector.registerRoot("Document", documentModel);
	const disconnect = connectViteInspector(inspector, import.meta.hot, token);
	const second =
		parameters.get("instances") === "2" ? createInspector() : undefined;
	second?.registerRoot("Second bridge", counter);
	const disconnectSecond = second
		? connectViteInspector(second, import.meta.hot, token)
		: () => {};
	import.meta.hot.dispose(() => {
		disconnect();
		disconnectSecond();
		second?.dispose();
		inspector.dispose();
		documentModel[Symbol.dispose]();
		stop();
		incrementButton.removeEventListener("click", increment);
		counter[Symbol.dispose]();
	});
}
