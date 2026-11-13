import { createInspector } from "../src/devtools";
import { runInNewContext } from "node:vm";
import {
	Store,
	Model,
	createStore,
	mount,
	child,
	id,
	modelRef,
	observable,
	batch,
	applySnapshot,
	toSnapshot,
	effect,
} from "../src/index";
import {
	isDebugRecording,
	subscribeDebug,
} from "../src/observables/internal/debug";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0).reverse()) dispose();
});
function setup<T extends Store>(
	Type: new (...args: any[]) => T,
	options: Parameters<typeof createInspector>[0] = { activity: true }
) {
	const root = mount(createStore(Type));
	cleanup.push(() => root[Symbol.dispose]());
	const inspector = createInspector(options);
	cleanup.push(() => inspector.dispose());
	const registration = inspector.registerRoot("Application", root);
	return { root, inspector, ...registration };
}
const records = (inspector: ReturnType<typeof createInspector>): any[] =>
	(inspector.query({ op: "operations" }) as any).records;

test("recording is off by default and subscribing does not change method identity or application results", () => {
	class Counter extends Store {
		count = 0;
		add(n: number) {
			this.count += n;
			return this.count;
		}
	}
	const { root, inspector } = setup(Counter, {});
	const method = root.add;
	expect(isDebugRecording()).toBe(false);
	expect(root.add(2)).toBe(2);
	expect(records(inspector)).toEqual([]);
	const active = createInspector({ activity: true });
	cleanup.push(() => active.dispose());
	active.registerRoot("Counter", root);
	expect(root.add).toBe(method);
	expect(root.add(3)).toBe(5);
	expect(records(active).filter((r) => r.kind === "method")).toHaveLength(1);
	active.dispose();
	expect(isDebugRecording()).toBe(false);
	expect(root.add).toBe(method);
});

test("calls, nested calls and every successful write are grouped by their synchronous batch", () => {
	class Counter extends Store {
		count = 0;
		inner() {
			this.count++;
		}
		outer() {
			this.inner();
			this.count = 7;
			return 42;
		}
	}
	const { root, inspector } = setup(Counter);
	expect(root.outer()).toBe(42);
	const log = records(inspector);
	const outer = log.find((r) => r.name === "outer");
	const inner = log.find((r) => r.name === "inner");
	expect(outer).toMatchObject({
		kind: "method",
		status: "succeeded",
		path: ["outer"],
	});
	expect(inner.parentId).toBe(outer.id);
	const writes = log.filter((r) => r.kind === "write");
	expect(writes.map((r) => [r.before, r.after])).toEqual([
		[1, 7],
		[0, 1],
	]);
	expect(
		new Set(log.filter((r) => r.kind !== "batch").map((r) => r.batchId)).size
	).toBe(1);
	expect(log.find((r) => r.kind === "batch").status).toBe("succeeded");
	batch(() => {
		root.count = 8;
		batch(() => {
			root.count = 9;
		});
	});
	expect(records(inspector).filter((r) => r.kind === "batch")).toHaveLength(2);
});

test("failures propagate unchanged, writes are not rolled back, and logging errors cannot break the app", () => {
	const error = new Error("DO_NOT_CAPTURE_MESSAGE");
	class Counter extends Store {
		count = 0;
		fail() {
			this.count++;
			throw error;
		}
	}
	const { root, inspector } = setup(Counter);
	expect(() => root.fail()).toThrow(error);
	expect(root.count).toBe(1);
	expect(records(inspector).find((r) => r.name === "fail").status).toBe(
		"failed"
	);
	expect(records(inspector).find((r) => r.kind === "batch").status).toBe(
		"failed"
	);
	expect(JSON.stringify(records(inspector))).not.toContain(
		"DO_NOT_CAPTURE_MESSAGE"
	);
	const unsubscribe = subscribeDebug(() => {
		throw new Error("broken debugger");
	});
	try {
		expect(() => root.fail()).toThrow(error);
	} finally {
		unsubscribe();
	}
});

test("async outcomes are observed without replacing promises or claiming causality across await", async () => {
	let resolve!: () => void;
	const gate = new Promise<void>((r) => {
		resolve = r;
	});
	class Counter extends Store {
		count = 0;
		async run() {
			this.count++;
			await gate;
			this.count++;
			return 3;
		}
		async fail() {
			throw new Error("private");
		}
	}
	const { root, inspector } = setup(Counter);
	const result = root.run();
	expect(records(inspector).find((r) => r.name === "run").status).toBe(
		"pending"
	);
	resolve();
	expect(await result).toBe(3);
	await Promise.resolve();
	const log = records(inspector);
	expect(log.find((r) => r.name === "run").status).toBe("succeeded");
	const continuation = log.find((r) => r.kind === "write" && r.after === 2);
	expect(continuation.parentId).toBeUndefined();
	expect(continuation.batchId).toBeUndefined();
	await expect(root.fail()).rejects.toThrow("private");
	await Promise.resolve();
	expect(records(inspector).find((r) => r.name === "fail").status).toBe(
		"failed"
	);
});

test("plain returns succeed, custom thenables are never executed and observation expires", async () => {
	vi.useFakeTimers();
	try {
		let reads = 0;
		class Root extends Store {
			object() {
				return {};
			}
			thenable() {
				return {
					get then() {
						reads++;
						throw new Error("do not read");
					},
				};
			}
			pending() {
				return new Promise(() => {});
			}
		}
		const { root, inspector } = setup(Root);
		root.object();
		root.thenable();
		root.pending();
		expect(reads).toBe(0);
		expect(records(inspector).find((r) => r.name === "object").status).toBe(
			"succeeded"
		);
		expect(records(inspector).find((r) => r.name === "thenable").status).toBe(
			"unobserved"
		);
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		expect(records(inspector).find((r) => r.name === "pending").status).toBe(
			"unobserved"
		);
	} finally {
		vi.useRealTimers();
	}
});

test("recording does not materialize children or computeds; new realized children are discovered", () => {
	let children = 0,
		computeds = 0;
	class Leaf extends Store {
		value = 0;
		increment() {
			this.value++;
		}
	}
	class Root extends Store {
		@child get leaf() {
			children++;
			return createStore(Leaf);
		}
		get expensive() {
			computeds++;
			return 42;
		}
		value = 0;
	}
	const { root, inspector } = setup(Root);
	root.value++;
	expect(children).toBe(0);
	expect(computeds).toBe(0);
	root.leaf.increment();
	expect(children).toBe(1);
	expect(computeds).toBe(0);
	expect(records(inspector).find((r) => r.name === "increment")).toMatchObject({
		path: ["leaf", "increment"],
	});
	expect(
		records(inspector).find((r) => r.name === "value" && r.path.length === 2)
	).toMatchObject({ before: 0, after: 1 });
});

test("observable collections, deletion and definitions are recorded without deep serialization", () => {
	class Root extends Store {
		list = observable([1, 2]);
		map = observable(new Map<string, number>());
		set = observable(new Set<string>());
		date = observable(new Date(0));
		object = observable<Record<string, unknown>>({ value: 1 });
	}
	const { root, inspector } = setup(Root);
	root.list.push(3);
	root.list[0] = 4;
	root.list.length = 1;
	root.list.reverse();
	root.list.sort();
	root.list.fill(7);
	root.list.copyWithin(0, 0);
	root.map.set("a", 1);
	root.map.set("a", 2);
	root.map.delete("a");
	root.set.add("x");
	root.set.delete("x");
	root.date.setTime(50);
	root.object.value = 2;
	delete root.object.value;
	Object.defineProperty(root.object, "other", { value: 5, configurable: true });
	const log = records(inspector).filter((r) => r.kind === "write");
	for (const operation of [
		"splice",
		"set",
		"reverse",
		"sort",
		"fill",
		"copyWithin",
		"delete",
		"add",
		"date",
		"define",
	])
		expect(
			log.some((r) => r.operation === operation),
			operation
		).toBe(true);
	expect(
		log.find((r) => r.path.join(".") === "map.a" && r.after === 2)
	).toMatchObject({ before: 1 });
	expect(log.find((r) => r.path.join(".") === "date.setTime")).toMatchObject({
		before: 0,
		after: 50,
	});
});

test("Model identifiers, children, references and snapshot writes are visible", () => {
	class Item extends Model {
		@id id!: string;
		name = "first";
		rename() {
			this.name = "second";
		}
	}
	class Disk extends Model {
		@child(Item) items: Item[] = [];
		@modelRef(Item) selected?: Item;
	}
	const disk = Disk.create({ items: [{ id: "a" }] });
	cleanup.push(() => disk[Symbol.dispose]());
	const inspector = createInspector({ activity: true });
	cleanup.push(() => inspector.dispose());
	inspector.registerRoot("Disk", disk);
	disk.items[0].rename();
	disk.selected = disk.items[0];
	applySnapshot(disk, {
		...toSnapshot(disk),
		selected: undefined,
		items: [{ id: "a", name: "restored" }],
	});
	const log = records(inspector);
	expect(log.some((r) => r.kind === "method" && r.name === "rename")).toBe(
		true
	);
	expect(
		log.some((r) => r.kind === "write" && r.path.join(".") === "selected")
	).toBe(true);
	expect(log.some((r) => r.kind === "write" && r.after === "restored")).toBe(
		true
	);
});

test("redaction applies before capture, including parents, methods and dynamic policies", () => {
	let hide = false;
	class Root extends Store {
		password = "old";
		privateArea = observable({ value: "old" });
		publicValue = "old";
		secretMethod() {
			this.password = "DO_NOT_CAPTURE";
		}
	}
	const { root, inspector } = setup(Root, {
		activity: true,
		redact: (path) =>
			path[0] === "privateArea" || (hide && path[0] === "publicValue"),
	});
	root.password = "DO_NOT_CAPTURE";
	root.privateArea.value = "DO_NOT_CAPTURE";
	root.secretMethod();
	root.publicValue = "visible";
	expect(JSON.stringify(records(inspector))).not.toContain("DO_NOT_CAPTURE");
	expect(records(inspector).some((r) => r.name === "publicValue")).toBe(true);
	hide = true;
	expect(records(inspector).some((r) => r.name === "publicValue")).toBe(false);
});

test("only registered reachable objects are recorded, stale paths update after array shifts", () => {
	class Leaf extends Store {
		value = 0;
		change() {
			this.value++;
		}
	}
	class Root extends Store {
		leaves = observable([mount(createStore(Leaf)), mount(createStore(Leaf))]);
	}
	const { root, inspector, unregister } = setup(Root);
	cleanup.push(() => {
		for (const leaf of root.leaves) leaf[Symbol.dispose]();
	});
	const other = mount(createStore(Leaf));
	cleanup.push(() => other[Symbol.dispose]());
	other.change();
	expect(records(inspector)).toEqual([]);
	const removed = root.leaves.shift()!;
	cleanup.push(() => removed[Symbol.dispose]());
	root.leaves[0].change();
	expect(records(inspector).find((r) => r.name === "change").path).toEqual([
		"leaves",
		"0",
		"change",
	]);
	const length = records(inspector).length;
	removed.change();
	expect(records(inspector)).toHaveLength(length);
	unregister();
	other.change();
	root.leaves[0].change();
	expect(records(inspector)).toEqual([]);
});

test("bounded histories, multiple inspectors, clear and disposal release pending observations", async () => {
	vi.useFakeTimers();
	try {
		let finish!: () => void;
		class Root extends Store {
			count = 0;
			increment() {
				this.count++;
			}
			pending() {
				return new Promise<void>((r) => {
					finish = r;
				});
			}
		}
		const { root, inspector } = setup(Root, {
			activity: { maxEntries: 5 },
			controls: true,
		});
		const second = createInspector({ activity: true });
		cleanup.push(() => second.dispose());
		second.registerRoot("Second", root);
		for (let i = 0; i < 10; i++) root.increment();
		expect(records(inspector).length).toBeLessThanOrEqual(5);
		expect(records(second).length).toBeGreaterThan(5);
		root.pending();
		expect(vi.getTimerCount()).toBe(2);
		inspector.query({ op: "clearOperations" });
		expect(records(inspector)).toEqual([]);
		second.dispose();
		expect(vi.getTimerCount()).toBe(0);
		finish();
		await Promise.resolve();
		expect(records(inspector)).toEqual([]);
		inspector.dispose();
		expect(isDebugRecording()).toBe(false);
	} finally {
		vi.useRealTimers();
	}
});

test("debugger observation does not subscribe the surrounding reaction to unrelated state", () => {
	class Root extends Store {
		count = 0;
		other = 0;
	}
	const { root } = setup(Root);
	let runs = 0;
	const stop = effect(() => {
		runs++;
		root.count = 1;
	});
	cleanup.push(stop);
	root.other = 1;
	expect(runs).toBe(1);
});

test("recording cannot be enabled in production and an empty registry installs no hooks", () => {
	vi.stubEnv("NODE_ENV", "production");
	try {
		expect(() => createInspector({ activity: true })).toThrow(
			"development only"
		);
		const plain = createInspector();
		plain.dispose();
	} finally {
		vi.unstubAllEnvs();
	}
	const inspector = createInspector({ activity: true });
	cleanup.push(() => inspector.dispose());
	expect(isDebugRecording()).toBe(false);
	class Root extends Store {
		value = 0;
	}
	const root = mount(createStore(Root));
	cleanup.push(() => root[Symbol.dispose]());
	const { unregister } = inspector.registerRoot("Root", root);
	expect(isDebugRecording()).toBe(true);
	unregister();
	expect(isDebugRecording()).toBe(false);
});

test("saved batch references still group writes after recording is enabled", () => {
	const savedBatch = batch;
	class Root extends Store {
		count = 0;
	}
	const { root, inspector } = setup(Root);
	savedBatch(() => {
		root.count = 1;
		root.count = 2;
	});
	const writes = records(inspector).filter((r) => r.kind === "write");
	expect(writes).toHaveLength(2);
	expect(writes[0].batchId).toBeDefined();
	expect(writes[0].batchId).toBe(writes[1].batchId);
});

test("value-only redaction retains write metadata without retaining document text", () => {
	class Root extends Store {
		draft = "private original";
		setDraft(value: string) {
			this.draft = value;
		}
	}
	const { root, inspector } = setup(Root, {
		activity: { redactValues: (path) => path.at(-1) === "draft" },
	});
	root.setDraft("private replacement");
	const log = records(inspector);
	expect(log.find((r) => r.name === "draft")).toMatchObject({
		kind: "write",
		before: "[redacted]",
		after: "[redacted]",
	});
	expect(log.find((r) => r.name === "setDraft")).not.toHaveProperty("args");
	expect(JSON.stringify(log)).not.toContain("private original");
	expect(JSON.stringify(log)).not.toContain("private replacement");
});

test("callback props and arrow methods are captured with their real property names", () => {
	class Root extends Store<{ callback: () => number }> {
		arrow = () => 3;
	}
	const root = mount(createStore(Root, { callback: () => 4 }));
	cleanup.push(() => root[Symbol.dispose]());
	const inspector = createInspector({ activity: true });
	cleanup.push(() => inspector.dispose());
	inspector.registerRoot("Root", root);
	expect(root.arrow()).toBe(3);
	expect(root.props.callback()).toBe(4);
	expect(records(inspector).find((r) => r.name === "callback")).toMatchObject({
		path: ["props", "callback"],
		kind: "method",
	});
	expect(records(inspector).find((r) => r.name === "arrow")).toMatchObject({
		path: ["arrow"],
		kind: "method",
	});
});

test("setter assignments and data definitions on Models are recorded without evaluating getters", () => {
	let gets = 0;
	class Document extends Model {
		value = 0;
		get doubled() {
			gets++;
			return this.value * 2;
		}
		set doubled(value: number) {
			this.value = value / 2;
		}
	}
	const model = Document.create();
	cleanup.push(() => model[Symbol.dispose]());
	const inspector = createInspector({ activity: true });
	cleanup.push(() => inspector.dispose());
	inspector.registerRoot("Document", model);
	model.doubled = 10;
	Object.defineProperty(model, "extra", { value: 42 });
	expect(gets).toBe(0);
	expect(records(inspector).find((r) => r.name === "doubled")).toMatchObject({
		operation: "setter",
		after: 10,
	});
	expect(records(inspector).find((r) => r.name === "extra")).toMatchObject({
		operation: "define",
		after: 42,
	});
});

test("discovery limits are reported rather than pretending to be an exhaustive trace", () => {
	const leaf = observable({ value: 0 });
	let branch: object = leaf;
	for (let i = 0; i < 18; i++) branch = observable({ child: branch });
	class Root extends Store {
		tree = branch;
	}
	const { inspector } = setup(Root);
	leaf.value = 1;
	expect(inspector.query({ op: "operations" })).toMatchObject({
		activity: { discoveryTruncated: true },
		records: [],
	});
});

test("combined operation output stays below the transport budget with long Unicode paths", () => {
	const key = "🚀".repeat(400);
	class Root extends Store {
		object = observable({ [key]: 0 });
	}
	const { root, inspector } = setup(Root, { activity: { maxEntries: 500 } });
	for (let i = 1; i <= 500; i++) root.object[key] = i;
	const result = inspector.query({ op: "operations" });
	expect(result).toMatchObject({ truncated: true });
	expect(
		new TextEncoder().encode(JSON.stringify(result)).byteLength
	).toBeLessThan(1024 * 1024);
	expect(records(inspector).length).toBeLessThan(500);
});

test("ordinary object returns do not attempt throwing Promise brand checks", () => {
	class Root extends Store {
		object = observable({ value: 1 });
		lookup() {
			return this.object;
		}
	}
	const { root, inspector } = setup(Root);
	const then = vi.spyOn(Promise.prototype, "then");
	try {
		const count = then.mock.calls.length;
		root.lookup();
		expect(then.mock.calls.length).toBe(count);
		expect(records(inspector).find((r) => r.name === "lookup").status).toBe(
			"succeeded"
		);
	} finally {
		then.mockRestore();
	}
});

test("cross-realm native promises keep their identity and report settlement", async () => {
	const promise = runInNewContext("Promise.resolve(7)") as Promise<number>;
	class Root extends Store {
		work() {
			return promise;
		}
	}
	const { root, inspector } = setup(Root);
	expect(root.work()).toBe(promise);
	expect(await promise).toBe(7);
	await Promise.resolve();
	expect(records(inspector).find((r) => r.name === "work").status).toBe(
		"succeeded"
	);
});

test("Map clear groups its member deletions without tracing Map reads", () => {
	class Root extends Store {
		map = observable(
			new Map([
				["a", 1],
				["b", 2],
			])
		);
	}
	const { root, inspector } = setup(Root);
	root.map.get("a");
	expect(records(inspector)).toEqual([]);
	root.map.clear();
	const writes = records(inspector).filter((r) => r.kind === "write");
	expect(writes).toHaveLength(2);
	expect(writes[0].batchId).toBeDefined();
	expect(writes[0].batchId).toBe(writes[1].batchId);
});
