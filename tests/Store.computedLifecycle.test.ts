import { Signal } from "@preact/signals-core";
import {
	Store,
	child,
	createContext,
	createStore,
	mount,
	snapshot,
	toSnapshot,
} from "../src/index";

test("disposing a Store releases its subscriptions to child, Context and snapshot dependencies", () => {
	const watched = new Set<string>();
	const dependency = (name: string) =>
		new Signal(1, {
			watched: () => {
				watched.add(name);
			},
			unwatched: () => {
				watched.delete(name);
			},
		});
	const childKey = dependency("child");
	const contextValue = dependency("context");
	const snapshotValue = dependency("snapshot");
	const Context = createContext<number>();
	let factories = 0;
	let effectRuns = 0;
	class Leaf extends Store {}
	class Root extends Store {
		static types = { leaf: child, revision: snapshot };
		constructor(props: Root["props"]) {
			super(props);
			this.effect(() => {
				effectRuns++;
				Context.consume(this);
				toSnapshot(this);
			});
		}
		get leaf() {
			factories++;
			return createStore(Leaf, { key: childKey.value });
		}
		get revision() {
			return snapshotValue.value;
		}
		[Context.provide]() {
			return contextValue.value;
		}
	}

	const root = mount(createStore(Root));
	try {
		const first = root.leaf;
		expect(watched).toEqual(new Set(["child", "context", "snapshot"]));
		childKey.value = 2;
		expect(root.leaf).not.toBe(first);
		expect(root.leaf.key).toBe(2);
		const before = effectRuns;
		contextValue.value = 2;
		snapshotValue.value = 2;
		expect(effectRuns).toBe(before + 2);
	} finally {
		root[Symbol.dispose]();
	}

	expect(watched.size).toBe(0);
	const before = { factories, effectRuns };
	childKey.value = 3;
	contextValue.value = 3;
	snapshotValue.value = 3;
	expect({ factories, effectRuns }).toEqual(before);
});
