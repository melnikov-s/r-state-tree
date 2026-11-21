import { child, createStore, mount, Signal, Store } from "../src/index";

function trackedKey() {
	const watched = vi.fn();
	const unwatched = vi.fn();
	const key = new Signal("initial", { watched, unwatched });
	const read = vi.fn(() => key.value);
	return { key, read, watched, unwatched };
}

function expectFailure(operation: () => unknown, failure: Error) {
	let caught: unknown;
	try {
		operation();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBe(failure);
}

class Leaf extends Store {}

it.each(["root", "branch"] as const)(
	"releases constructor-time child listeners when the %s constructor fails",
	(failsIn) => {
		const branchKey = trackedKey();
		const leafKey = trackedKey();
		const failure = new Error("construction failed");
		const lifetimes: AbortSignal[] = [];
		const effectStarted = vi.fn();
		let fail = true;

		class Branch extends Store {
			initial = this.leaf.key;
			constructor(props: Branch["props"]) {
				super(props);
				lifetimes.push(this.signal, this.leaf.signal);
				this.effect(effectStarted);
				if (fail && failsIn === "branch") throw failure;
			}

			@child get leaf() {
				return createStore(Leaf, { key: leafKey.read() });
			}
		}

		class Root extends Store {
			initial = this.branch.initial;
			constructor(props: Root["props"]) {
				super(props);
				lifetimes.push(this.signal);
				if (fail && failsIn === "root") throw failure;
			}

			@child get branch() {
				return createStore(Branch, { key: branchKey.read() });
			}
		}

		const descriptor = createStore(Root);
		expectFailure(() => mount(descriptor), failure);
		for (const dependency of [branchKey, leafKey]) {
			expect(dependency.watched).toHaveBeenCalledTimes(1);
			expect(dependency.unwatched).toHaveBeenCalledTimes(1);
			expect(dependency.read).toHaveBeenCalledTimes(1);
			dependency.key.value = "retry";
			expect(dependency.read).toHaveBeenCalledTimes(1);
		}
		expect(lifetimes.map((signal) => signal.aborted)).toEqual(
			failsIn === "root" ? [true, true, true] : [true, true]
		);
		expect(effectStarted).not.toHaveBeenCalled();

		fail = false;
		const root = mount(descriptor);
		try {
			expect(root.initial).toBe("retry");
			expect(effectStarted).toHaveBeenCalledTimes(1);
			for (const dependency of [branchKey, leafKey]) {
				expect(dependency.watched).toHaveBeenCalledTimes(2);
				expect(dependency.unwatched).toHaveBeenCalledTimes(1);
			}
		} finally {
			root[Symbol.dispose]();
		}
		expect(branchKey.unwatched).toHaveBeenCalledTimes(2);
		expect(leafKey.unwatched).toHaveBeenCalledTimes(2);
	}
);

it("keeps the constructor error as the cause when cleanup also fails", () => {
	const failure = new Error("construction failed");
	const cleanupFailure = new Error("unwatch failed");
	const key = new Signal("initial", {
		unwatched() {
			throw cleanupFailure;
		},
	});
	const later = trackedKey();

	class Root extends Store {
		constructor(props: Root["props"]) {
			super(props);
			void this.unsafe;
			void this.safe;
			throw failure;
		}

		@child get unsafe() {
			return createStore(Leaf, { key: key.value });
		}

		@child get safe() {
			return createStore(Leaf, { key: later.read() });
		}
	}

	expect(() => mount(createStore(Root))).toThrow(
		expect.objectContaining({ cause: failure })
	);
	expect(later.unwatched).toHaveBeenCalledTimes(1);
});

it.each(["single", "list"] as const)(
	"disposes failed %s replacements without retiring the committed child",
	(shape) => {
		const originalKey = trackedKey();
		const tentativeKey = trackedKey();
		const replacementKey = trackedKey();
		const replace = new Signal(false);
		const failure = new Error("replacement failed");
		const failedLifetimes: AbortSignal[] = [];
		let fail = true;

		class Branch extends Store<{ readKey: () => string }> {
			initial = this.leaf.key;
			constructor(props: Branch["props"]) {
				super(props);
				if (fail && this.key !== "original") {
					failedLifetimes.push(this.signal, this.leaf.signal);
					if (this.key === "replacement") throw failure;
				}
			}

			@child get leaf() {
				return createStore(Leaf, { key: this.props.readKey() });
			}
		}

		const originalDescriptor = createStore(Branch, {
			key: "original",
			readKey: originalKey.read,
		});
		const tentativeDescriptor = createStore(Branch, {
			key: "tentative",
			readKey: tentativeKey.read,
		});
		const replacementDescriptor = createStore(Branch, {
			key: "replacement",
			readKey: replacementKey.read,
		});

		class Root extends Store {
			@child get single() {
				return replace.value ? replacementDescriptor : originalDescriptor;
			}

			@child get list() {
				return replace.value
					? [tentativeDescriptor, replacementDescriptor]
					: [originalDescriptor];
			}
		}

		const root = mount(createStore(Root));
		try {
			const read = () => (shape === "single" ? [root.single] : root.list);
			const [original] = read();
			const originalLeaf = original.leaf;
			expectFailure(() => (replace.value = true), failure);
			expect(failedLifetimes.map((signal) => signal.aborted)).toEqual(
				shape === "single" ? [true, true] : [true, true, true, true]
			);
			const discardedKeys =
				shape === "single" ? [replacementKey] : [tentativeKey, replacementKey];
			for (const dependency of discardedKeys) {
				expect(dependency.watched).toHaveBeenCalledTimes(1);
				expect(dependency.unwatched).toHaveBeenCalledTimes(1);
				expect(dependency.read).toHaveBeenCalledTimes(1);
				dependency.key.value = "retry";
				expect(dependency.read).toHaveBeenCalledTimes(1);
			}
			expect(original.signal.aborted).toBe(false);
			expect(originalKey.unwatched).not.toHaveBeenCalled();
			originalKey.key.value = "still live";
			expect(originalLeaf.signal.aborted).toBe(true);
			expect(original.leaf.key).toBe("still live");

			fail = false;
			const replacements = read();
			expect(replacements.map((branch) => branch.initial)).toEqual(
				shape === "single" ? ["retry"] : ["retry", "retry"]
			);
			expect(original.signal.aborted).toBe(true);
			for (const dependency of discardedKeys) {
				expect(dependency.watched).toHaveBeenCalledTimes(2);
				expect(dependency.unwatched).toHaveBeenCalledTimes(1);
			}
		} finally {
			root[Symbol.dispose]();
		}
		expect(replacementKey.unwatched).toHaveBeenCalledTimes(2);
	}
);
