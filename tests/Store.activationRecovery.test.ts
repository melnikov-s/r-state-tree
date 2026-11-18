import { child, createStore, mount, Signal, Store } from "../src/index";

it.each(["mount", "already mounted"] as const)(
	"stops an effect that disposes its root during setup (%s)",
	(when) => {
		let watchers = 0;
		const dependency = new Signal(0, {
			watched: () => watchers++,
			unwatched: () => watchers--,
		});
		let runs = 0;
		let cleanups = 0;

		class Root extends Store {
			constructor(props: Root["props"]) {
				super(props);
				if (when === "mount") this.startEffect();
			}

			startEffect() {
				return this.effect(() => {
					void dependency.value;
					runs++;
					this[Symbol.dispose]();
					return () => {
						expect(this.signal.aborted).toBe(true);
						cleanups++;
					};
				});
			}
		}

		const root = mount(createStore(Root));
		const stop = when === "already mounted" ? root.startEffect() : undefined;
		expect(root.signal.aborted).toBe(true);
		const watchersAfterSetup = watchers;
		const cleanupsAfterSetup = cleanups;

		dependency.value++;
		stop?.();
		root[Symbol.dispose]();
		expect(runs).toBe(1);
		expect(watchersAfterSetup).toBe(0);
		expect(cleanupsAfterSetup).toBe(1);
		expect(cleanups).toBe(1);
	}
);

it("tracks a lazy child getter after a failed first read", () => {
	let watchers = 0;
	const key = new Signal("fail", {
		watched: () => watchers++,
		unwatched: () => watchers--,
	});
	let getterRuns = 0;
	const children: Leaf[] = [];
	let activeEffects = 0;
	let cleanups = 0;

	class Leaf extends Store {
		constructor(props: Leaf["props"]) {
			super(props);
			children.push(this);
			this.effect(() => {
				activeEffects++;
				return () => {
					activeEffects--;
					cleanups++;
				};
			});
		}
	}

	class Root extends Store {
		@child get leaf() {
			getterRuns++;
			const currentKey = key.value;
			if (currentKey === "fail") throw new Error("descriptor failed");
			return createStore(Leaf, { key: currentKey });
		}
	}

	const root = mount(createStore(Root));
	expect(() => root.leaf).toThrow("descriptor failed");
	expect(watchers).toBe(0);
	key.value = "old";
	expect(children).toHaveLength(0);

	const original = root.leaf;
	const watchersAfterRetry = watchers;
	expect(children).toEqual([original]);
	expect(activeEffects).toBe(1);

	// Assert reconciliation via retained instances, without a second getter read.
	key.value = "new";
	expect(original.signal.aborted).toBe(true);
	expect(watchersAfterRetry).toBe(1);
	expect(children).toHaveLength(2);
	expect(children[1].key).toBe("new");
	expect(children[1].signal.aborted).toBe(false);
	expect(activeEffects).toBe(1);
	expect(cleanups).toBe(1);

	root[Symbol.dispose]();
	expect(watchers).toBe(0);
	expect(children[1].signal.aborted).toBe(true);
	expect(activeEffects).toBe(0);
	expect(cleanups).toBe(2);
	const runsBeforeWrite = getterRuns;
	key.value = "after disposal";
	expect(getterRuns).toBe(runsBeforeWrite);
	expect(children).toHaveLength(2);
});
