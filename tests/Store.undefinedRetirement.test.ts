import { batch, child, createStore, mount, Signal, Store } from "../src/index";

function setup(initiallyEnabled: boolean, initialRevision = 0) {
	const subscriptions = { descriptor: 0, worker: 0 };
	const revision = new Signal(initialRevision, {
		watched: () => subscriptions.descriptor++,
		unwatched: () => subscriptions.descriptor--,
	});
	const work = new Signal(0, {
		watched: () => subscriptions.worker++,
		unwatched: () => subscriptions.worker--,
	});
	const workers: Worker[] = [];
	const getterRan = vi.fn();
	const startWork = vi.fn();
	const cleanup = vi.fn();

	class Worker extends Store {
		constructor(props: Worker["props"]) {
			super(props);
			workers.push(this);
			this.effect(() => {
				void work.value;
				startWork(this);
				return () => cleanup(this);
			});
		}
	}

	// Reuse the descriptor so some getter evaluations return the same value.
	const descriptor = createStore(Worker);
	class Root extends Store {
		enabled = initiallyEnabled;
		unrelated = 0;

		@child get worker() {
			getterRan();
			if (revision.value < 0) throw new Error("descriptor failed");
			return this.enabled ? descriptor : undefined;
		}
	}

	return {
		root: mount(createStore(Root)),
		revision,
		workers,
		getterRan,
		startWork,
		cleanup,
		subscriptions,
	};
}

test("retires a realized child on its first undefined descriptor without a reread", () => {
	const { root, workers, startWork, cleanup, subscriptions } = setup(true);
	using mounted = root;
	const old = mounted.worker!;
	expect(startWork).toHaveBeenCalledExactlyOnceWith(old);
	expect(subscriptions).toEqual({ descriptor: 1, worker: 1 });

	mounted.enabled = false;
	expect(old.signal.aborted).toBe(true);
	expect(cleanup).toHaveBeenCalledExactlyOnceWith(old);
	expect(subscriptions).toEqual({ descriptor: 1, worker: 0 });

	mounted.enabled = true;
	expect(workers).toHaveLength(2);
	const replacement = workers[1];
	expect(replacement).not.toBe(old);
	expect(startWork.mock.calls).toEqual([[old], [replacement]]);
	expect(cleanup).toHaveBeenCalledExactlyOnceWith(old);
	expect(subscriptions).toEqual({ descriptor: 1, worker: 1 });
	expect(mounted.worker).toBe(replacement);

	mounted[Symbol.dispose]();
	expect(replacement.signal.aborted).toBe(true);
	expect(cleanup.mock.calls).toEqual([[old], [replacement]]);
	expect(subscriptions).toEqual({ descriptor: 0, worker: 0 });
});

test("tracks initial absence and ignores unrelated or unchanged descriptor values", () => {
	const {
		root,
		revision,
		workers,
		getterRan,
		startWork,
		cleanup,
		subscriptions,
	} = setup(false);
	using mounted = root;
	expect(mounted.worker).toBeNull();
	expect(subscriptions).toEqual({ descriptor: 1, worker: 0 });
	mounted.unrelated++;
	mounted.enabled = false;
	expect(getterRan).toHaveBeenCalledTimes(1);
	revision.value++;
	expect(getterRan).toHaveBeenCalledTimes(2);
	expect(workers).toHaveLength(0);

	mounted.enabled = true;
	expect(workers).toHaveLength(1);
	const worker = workers[0];
	revision.value++;
	mounted.unrelated++;
	mounted.enabled = true;
	expect(getterRan).toHaveBeenCalledTimes(4);
	expect(workers).toHaveLength(1);
	expect(startWork).toHaveBeenCalledExactlyOnceWith(worker);
	expect(cleanup).not.toHaveBeenCalled();
	expect(worker.signal.aborted).toBe(false);
	expect(subscriptions).toEqual({ descriptor: 1, worker: 1 });
});

test("a synchronous read inside a batch does not hide a return to the original descriptor", () => {
	const { root, workers, startWork, cleanup, subscriptions } = setup(true);
	using mounted = root;
	const old = mounted.worker!;
	batch(() => {
		mounted.enabled = false;
		expect(mounted.worker).toBeNull();
		expect(old.signal.aborted).toBe(true);
		expect(cleanup).toHaveBeenCalledExactlyOnceWith(old);
		mounted.enabled = true;
	});

	// The batch listener should have realized the replacement, not the next read.
	expect(workers).toHaveLength(2);
	expect(startWork.mock.calls).toEqual([[old], [workers[1]]]);
	expect(cleanup).toHaveBeenCalledExactlyOnceWith(old);
	expect(subscriptions).toEqual({ descriptor: 1, worker: 1 });
});

test("a failed first evaluation can retry and retire on the next undefined descriptor", () => {
	const { root, revision, workers, cleanup, subscriptions } = setup(true, -1);
	using mounted = root;
	expect(() => mounted.worker).toThrow("descriptor failed");
	expect(subscriptions).toEqual({ descriptor: 0, worker: 0 });
	revision.value = 0;
	expect(workers).toHaveLength(0);

	const old = mounted.worker!;
	expect(subscriptions).toEqual({ descriptor: 1, worker: 1 });
	mounted.enabled = false;
	expect(old.signal.aborted).toBe(true);
	expect(cleanup).toHaveBeenCalledExactlyOnceWith(old);
	expect(subscriptions).toEqual({ descriptor: 1, worker: 0 });

	mounted[Symbol.dispose]();
	expect(cleanup).toHaveBeenCalledExactlyOnceWith(old);
	expect(subscriptions).toEqual({ descriptor: 0, worker: 0 });
});
