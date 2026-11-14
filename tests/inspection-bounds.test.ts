import {
	Store,
	child,
	createStore,
	mount,
	observable,
	Observable,
	computed,
} from "../src/index";
import { createInspector } from "../devtools/src/devtools";

test("recursive child materialization and wide realized lists are bounded", () => {
	class Node extends Store {
		@child get next(): Node {
			return createStore(Node);
		}
	}
	class Root extends Store {
		@child get chain() {
			return createStore(Node);
		}
		@child get many() {
			return Array.from({ length: 30 }, (_, key) => createStore(Node, { key }));
		}
	}
	const root = mount(createStore(Root));
	const inspector = createInspector();
	const { rootId } = inspector.registerRoot("root", root);
	expect(
		inspector.query({
			op: "initialize",
			rootId,
			field: "chain",
			levels: 4,
			maxInitializations: 50,
		})
	).toMatchObject({ initialized: 4 });
	expect(
		inspector.query({
			op: "initialize",
			rootId,
			field: "many",
			levels: 4,
			maxInitializations: 3,
		})
	).toMatchObject({ initialized: 3, visited: 3, truncated: true });
	const existing = inspector.query({
		op: "initialize",
		rootId,
		field: "many",
		levels: 2,
		maxInitializations: 3,
	}) as any;
	expect(existing.storesVisited).toBeLessThanOrEqual(3);
	expect(existing.visited).toBeLessThanOrEqual(3);
	expect(existing.truncated).toBe(true);
	root[Symbol.dispose]();
	inspector.dispose();
});

test("subtree initialization respects redacted array-item ancestors", () => {
	let reads = 0;
	class Leaf extends Store {}
	class Branch extends Store {
		@child get leaf() {
			reads++;
			return createStore(Leaf);
		}
	}
	class Root extends Store {
		@child get branches() {
			return [createStore(Branch), createStore(Branch)];
		}
	}
	const root = mount(createStore(Root));
	const inspector = createInspector({
		redact: (path) => path.join(".") === "branches.0",
	});
	const { rootId } = inspector.registerRoot("root", root);
	expect(
		inspector.query({ op: "initialize", rootId, field: "branches", levels: 2 })
	).toMatchObject({ initialized: 2 });
	expect(reads).toBe(1);
	expect(() =>
		inspector.query({
			op: "initialize",
			rootId,
			path: ["branches", "0"],
			field: "leaf",
		})
	).toThrow("Redacted");
	root[Symbol.dispose]();
	inspector.dispose();
});

test("key errors are bounded and disposed Stores do not evaluate their keys", () => {
	let reads = 0;
	class Root extends Store {
		override get key(): string {
			reads++;
			throw new Error("SECRET KEY ERROR");
		}
		value = 7;
	}
	const root = mount(createStore(Root));
	const inspector = createInspector();
	const { rootId } = inspector.registerRoot("root", root);
	const result = inspector.query({ op: "inspect", rootId }) as any;
	expect(result.key.kind).toBe("error");
	expect(result.fields.find((f: any) => f.name === "value").value).toBe(7);
	expect(JSON.stringify(result)).not.toContain("SECRET KEY ERROR");
	root[Symbol.dispose]();
	const before = reads;
	expect(inspector.query({ op: "inspect", rootId })).toMatchObject({
		status: "disposed",
	});
	expect(reads).toBe(before);
	inspector.dispose();
});

test("ordinary computed values on observable objects and Observable classes are evaluated live", () => {
	class Data extends Observable {
		count = 2;
		@computed get double() {
			return this.count * 2;
		}
	}
	const data = new Data();
	const record = observable({
		get count() {
			return data.double + 1;
		},
	});
	class Root extends Store {
		data = data;
		record = record;
	}
	const root = mount(createStore(Root));
	const inspector = createInspector();
	const { rootId } = inspector.registerRoot("root", root);
	const inspect = (path: string[]) =>
		inspector.query({ op: "inspect", rootId, path, depth: 2 }) as any;
	expect(
		inspect(["data"]).fields.find((f: any) => f.name === "double").value
	).toBe(4);
	expect(
		inspect(["record"]).fields.find((f: any) => f.name === "count").value
	).toBe(5);
	data.count = 3;
	expect(inspect(["data", "double"])).toBe(6);
	root[Symbol.dispose]();
	inspector.dispose();
});

test("null children initialize distinctly; non-JSON values and accessors never invoke toJSON or plain getters", () => {
	let reads = 0;
	const data = {
		get dangerous() {
			reads++;
			return "no";
		},
		toJSON() {
			reads++;
			return "no";
		},
		date: new Date("2020-01-01"),
		invalid: new Date(NaN),
		undef: undefined,
		symbol: Symbol("private"),
		fn: () => 1,
	};
	class Root extends Store {
		data = data;
		@child get absent() {
			return null;
		}
	}
	const root = mount(createStore(Root));
	const inspector = createInspector();
	const { rootId } = inspector.registerRoot("root", root);
	expect(
		inspector.query({ op: "initialize", rootId, field: "absent" })
	).toMatchObject({ initialized: 1 });
	const output = inspector.query({ op: "inspect", rootId, depth: 4 }) as any;
	expect(output.fields.find((f: any) => f.name === "absent").value).toBeNull();
	const fields = output.fields.find((f: any) => f.name === "data").value.fields;
	expect(fields.find((f: any) => f.name === "date").value.value).toBe(
		"2020-01-01T00:00:00.000Z"
	);
	expect(fields.find((f: any) => f.name === "invalid").value.kind).toBe(
		"error"
	);
	expect(reads).toBe(0);
	expect(() => JSON.stringify(output)).not.toThrow();
	root[Symbol.dispose]();
	inspector.dispose();
});
