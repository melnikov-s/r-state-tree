import { createInspector } from "../devtools/src/devtools";
import {
	Store,
	Model,
	child,
	createStore,
	mount,
	computed,
	transient,
	id,
	modelRef,
	source,
} from "../src/index";
import { getStoreAdm } from "../src/store/StoreAdministration";

const asObject = (value: unknown): any => value;
const field = (value: unknown, name: string) =>
	asObject(value).fields.find((f: any) => f.name === name);

test("enumeration does not initialize children; existing children bypass the public reconciling getter", () => {
	let reads = 0;
	class Leaf extends Store {
		value = 7;
	}
	class Root extends Store {
		@child get leaf() {
			reads++;
			return createStore(Leaf);
		}
	}
	const root = mount(createStore(Root));
	const inspector = createInspector();
	const { rootId, unregister } = inspector.registerRoot("root", root);
	const inspect = () => inspector.query({ op: "inspect", rootId, depth: 4 });
	expect(field(inspect(), "leaf").value).toEqual({
		kind: "uninitialized",
		detail: "Not yet initialized",
	});
	expect(reads).toBe(0);
	expect(root.leaf.value).toBe(7);
	const getStore = vi.spyOn(getStoreAdm(root) as any, "getStore");
	expect(field(field(inspect(), "leaf").value, "value").value).toBe(7);
	expect(getStore).not.toHaveBeenCalled();
	expect(reads).toBe(1);
	unregister();
	expect(() => inspect()).toThrow("Unknown root");
	const replacement = inspector.registerRoot("replacement", root);
	unregister(); // stale cleanup must not unregister the new registration
	expect(asObject(inspector.query({ op: "roots" })).roots).toHaveLength(1);
	replacement.unregister();
	root[Symbol.dispose]();
	inspector.dispose();
});

test("explicit initialization preserves mount/disposal effects, keyed identity, and bounded subtree materialization", () => {
	let mounts = 0,
		stops = 0;
	class Leaf extends Store {
		value = 2;
		constructor(props: any) {
			super(props);
			this.effect(() => {
				mounts++;
				return () => {
					stops++;
				};
			});
		}
	}
	class Branch extends Store {
		@child get leaves() {
			return [createStore(Leaf, { key: "a" }), createStore(Leaf, { key: "b" })];
		}
	}
	class Root extends Store {
		@child get branch() {
			return createStore(Branch);
		}
	}
	const root = mount(createStore(Root));
	const inspector = createInspector();
	const { rootId } = inspector.registerRoot("root", root);
	expect(
		inspector.query({
			op: "initialize",
			rootId,
			field: "branch",
			levels: 3,
			maxInitializations: 1,
		})
	).toMatchObject({ initialized: 1, truncated: true });
	expect(mounts).toBe(0);
	expect(
		inspector.query({
			op: "initialize",
			rootId,
			path: ["branch"],
			field: "leaves",
		})
	).toMatchObject({ initialized: 1 });
	expect(mounts).toBe(2);
	const values = root.branch.leaves;
	const before = inspector.query({
		op: "inspect",
		rootId,
		path: ["branch", "leaves"],
		depth: 3,
	});
	expect(field(before, "0").value.key).toBe("a");
	inspector.query({
		op: "initialize",
		rootId,
		path: ["branch"],
		field: "leaves",
	});
	expect(root.branch.leaves[0]).toBe(values[0]);
	expect(mounts).toBe(2);
	root[Symbol.dispose]();
	expect(stops).toBe(2);
	expect(() =>
		inspector.query({ op: "initialize", rootId, field: "branch" })
	).toThrow("live Store");
	inspector.dispose();
});

test("ordinary computed values and errors evaluate; indirect child initialization is possible", () => {
	let runs = 0;
	class Leaf extends Store {
		value = 9;
	}
	class Root extends Store {
		count = 3;
		@child get lazy() {
			return createStore(Leaf);
		}
		@computed get double() {
			runs++;
			return this.count * 2;
		}
		get error() {
			throw new Error("SECRET ERROR PAYLOAD");
		}
		get indirect() {
			return this.lazy.value;
		}
	}
	const root = mount(createStore(Root));
	const inspector = createInspector();
	const { rootId } = inspector.registerRoot("root", root);
	const result = inspector.query({ op: "inspect", rootId });
	expect(field(result, "double").value).toBe(6);
	expect(runs).toBe(1);
	expect(field(result, "error").value.kind).toBe("error");
	expect(field(result, "indirect").value).toBe(9);
	expect(getStoreAdm(root).peekInspectionChild("lazy").initialized).toBe(true);
	expect(JSON.stringify(result)).not.toContain("SECRET ERROR PAYLOAD");
	root.count = 4;
	expect(
		field(inspector.query({ op: "inspect", rootId }), "double").value
	).toBe(8);
	root[Symbol.dispose]();
	inspector.dispose();
});

test("runtime Model ownership/reference metadata is distinct; cycles and source/proxy identity are preserved", () => {
	class Item extends Model {
		@id id = "a";
		value = 4;
	}
	class Tree extends Model {
		@child(Item) item = Item.create();
		@modelRef(Item) selected = this.item;
		@transient runtime: any = {
			promise: Promise.resolve(1),
			bigint: 1n,
			nan: NaN,
			map: new Map(),
		};
	}
	const tree = Tree.create();
	tree.runtime.cycle = tree.runtime;
	tree.runtime.alias = source(tree.item);
	const inspector = createInspector();
	const { rootId } = inspector.registerRoot("tree", tree);
	const result = inspector.query({ op: "inspect", rootId, depth: 5 });
	expect(field(result, "item").edge).toBe("ownership");
	expect(field(result, "selected").edge).toBe("reference");
	expect(field(result, "item").value.parentId).toBe(rootId);
	expect(field(result, "selected").value.id).toBe(
		field(result, "item").value.id
	);
	const runtime = field(result, "runtime").value;
	expect(field(runtime, "cycle").value.kind).toBe("reference");
	expect(field(runtime, "alias").value.id).toBe(field(result, "item").value.id);
	expect(field(runtime, "promise").value.kind).toBe("unsupported");
	expect(field(runtime, "bigint").value.kind).toBe("unsupported");
	expect(() => JSON.stringify(result)).not.toThrow();
	expect(() =>
		inspector.query({
			op: "inspect",
			rootId,
			path: ["runtime", "promise", "anything"],
		})
	).toThrow("internals");
	tree[Symbol.dispose]();
	inspector.dispose();
});

test("redaction runs before getters, navigation, initialization, and transport; errors and bounds are safe", () => {
	let reads = 0;
	class Root extends Store {
		password = "DO NOT SEND";
		long = "x".repeat(2000);
		values = Array.from({ length: 1000 }, (_, i) => i);
		get privateData() {
			reads++;
			return "DO NOT SEND";
		}
		@child get privateChild() {
			reads++;
			return null;
		}
		@child get broken() {
			throw new Error("DO NOT SEND");
		}
	}
	const root = mount(createStore(Root));
	const inspector = createInspector({
		redact: (path) => path.at(-1)?.startsWith("private") ?? false,
	});
	const { rootId } = inspector.registerRoot("root", root);
	const result = inspector.query({ op: "inspect", rootId, depth: 1 });
	expect(field(result, "password").value.kind).toBe("redacted");
	expect(field(result, "privateData").value.kind).toBe("redacted");
	expect(reads).toBe(0);
	expect(JSON.stringify(result)).not.toContain("DO NOT SEND");
	expect(field(result, "long").value).toMatchObject({
		kind: "truncated",
		length: 2000,
	});
	expect(field(result, "values").value.truncated).toBe(true);
	const bounded = inspector.query({
		op: "inspect",
		rootId,
		path: ["values"],
		depth: 2,
		maxEntries: 5,
	});
	expect(asObject(bounded).fields.length).toBe(4);
	expect(asObject(bounded).truncated).toBe(true);
	expect(() =>
		inspector.query({ op: "inspect", rootId, path: ["privateData"] })
	).toThrow("Redacted");
	expect(() =>
		inspector.query({ op: "initialize", rootId, field: "privateChild" })
	).toThrow("Redacted");
	expect(() =>
		inspector.query({ op: "initialize", rootId, field: "long" })
	).toThrow("Only declared");
	expect(
		inspector.query({ op: "initialize", rootId, field: "broken" })
	).toMatchObject({ errors: [{ kind: "error" }] });
	expect(
		field(
			inspector.query({ op: "inspect", rootId, path: [], depth: 1 }),
			"broken"
		).value.kind
	).toBe("uninitialized");
	expect(() => inspector.query({ op: "inspect", rootId, depth: 99 })).toThrow(
		"Invalid depth"
	);
	expect(() =>
		inspector.query({ op: "inspect", rootId, path: ["__proto__"] })
	).toThrow("Invalid path");
	expect(() => inspector.query({ op: "eval" } as any)).toThrow(
		"Unknown operation"
	);
	root[Symbol.dispose]();
	inspector.dispose();
});
