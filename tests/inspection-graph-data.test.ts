import {
	buildInspectorGraph,
	type GraphAddress,
} from "../src/inspection/graph-data";
import {
	createInspector,
	type InspectionValue,
} from "../src/inspection/runtime";
import { Store, child, createStore, mount } from "../src/index";
import { getStoreAdm } from "../src/store/StoreAdministration";

const field = (name: string, value: InspectionValue, edge = "ownership") => ({
	name,
	value,
	edge,
	type: edge === "ownership" ? "child" : "value",
});

test("diagram projects ownership, keeps references separate, and overlays only selected Context availability", () => {
	const values: Record<string, InspectionValue> = {
		root: {
			id: "root",
			kind: "Store",
			className: "ApplicationStore",
			fields: [
				field("children", { id: "list", kind: "array" }),
				field("model", { id: "model", kind: "Model" }, "object"),
				field("props", { id: "props", kind: "object" }, "object"),
			],
			methods: [{ name: "run" }],
		},
		"root/children": {
			id: "list",
			kind: "array",
			fields: [field("0", { id: "leaf", kind: "Store" }, "object")],
		},
		"root/children/0": {
			id: "leaf",
			kind: "Store",
			fields: [],
			contexts: [
				{ name: "ApiContext", providerId: "root", status: "inherited" },
			],
		},
		model: { id: "model", kind: "Model", fields: [] },
	};
	const read = vi.fn(
		(at: GraphAddress) => values[[at.rootId, ...at.path].join("/")]
	);
	const roots = [
		{ rootId: "root", name: "Stores", kind: "Store" },
		{ rootId: "model", name: "Models", kind: "Model" },
	];
	const selected = { rootId: "root", name: "0", path: ["children", "0"] };
	const graph = buildInspectorGraph(roots, read, new Map(), selected, true);
	expect(graph.nodes.map((node) => node.id)).toEqual([
		"root",
		"list",
		"leaf",
		"model",
	]);
	expect(graph.selectedId).toBe("leaf");
	expect(graph.edges).toContainEqual({
		from: "root",
		to: "list",
		kind: "ownership",
	});
	expect(graph.edges).toContainEqual({
		from: "list",
		to: "leaf",
		kind: "ownership",
	});
	expect(graph.edges).toContainEqual({
		from: "root",
		to: "model",
		kind: "reference",
		label: "model",
	});
	expect(graph.edges).toContainEqual({
		from: "root",
		to: "leaf",
		kind: "context",
		label: "ApiContext · available",
	});
	expect(graph.nodes.find((node) => node.id === "leaf")!.contextCount).toBe(1);
	expect(
		buildInspectorGraph(
			roots,
			read,
			new Map(),
			selected,
			false,
			false
		).edges.every((edge) => edge.kind === "ownership")
	).toBe(true);
});

test("closed branches stay closed, duplicate identities cannot recurse, and work is bounded", () => {
	const root = { rootId: "root", name: "Root", kind: "Store" };
	const read = vi.fn((at: GraphAddress): InspectionValue =>
		at.path.length
			? {
					id: "child",
					kind: "Store",
					fields: [field("cycle", { id: "root", kind: "Store" })],
				}
			: {
					id: "root",
					kind: "Store",
					fields: [field("child", { id: "child", kind: "Store" })],
				}
	);
	const closed = buildInspectorGraph([root], read, new Map([["root", false]]));
	expect(closed.nodes).toHaveLength(1);
	expect(closed.nodes[0].expandable).toBe(true);
	expect(closed.nodes[0].expanded).toBe(false);
	expect(read).toHaveBeenCalledTimes(1);
	read.mockClear();
	const cyclic = buildInspectorGraph([root], read, new Map());
	expect(cyclic.nodes).toHaveLength(2);
	expect(read).toHaveBeenCalledTimes(2);
	const wide = buildInspectorGraph(
		[root],
		() => ({
			id: "root",
			kind: "Store",
			fields: Array.from({ length: 400 }, (_, i) =>
				field(String(i), { id: String(i), kind: "Store" })
			),
		}),
		new Map()
	);
	expect(wide.nodes.length).toBeLessThanOrEqual(160);
	expect(wide.limited).toBe(true);
});

test("closed diagram leaves and empty ownership arrays never offer expansion", () => {
	const values: Record<string, InspectionValue> = {
		root: {
			id: "root",
			kind: "Store",
			fields: [
				field("leaf", { id: "leaf", kind: "Store" }),
				field("empty", { id: "empty", kind: "array" }),
			],
		},
		"root/leaf": {
			id: "leaf",
			kind: "Store",
			fields: [field("text", "Hello", "object")],
		},
		"root/empty": { id: "empty", kind: "array", fields: [] },
	};
	const graph = buildInspectorGraph(
		[{ rootId: "root", name: "Root", kind: "Store" }],
		(at) => values[[at.rootId, ...at.path].join("/")],
		new Map([
			["leaf", false],
			["empty", false],
		])
	);
	expect(graph.nodes.find((node) => node.id === "root")!.expandable).toBe(true);
	for (const id of ["leaf", "empty"]) {
		expect(graph.nodes.find((node) => node.id === id)).toMatchObject({
			expandable: false,
			expanded: false,
		});
		expect(graph.addresses.has(id)).toBe(true);
	}
});

test("aliases inspected before child getters do not hide the owned array's descendants or runtime kind", () => {
	class Leaf extends Store {}
	class Root extends Store {
		static types = { children: child };
		alias: Store[] | null = null;
		get children() {
			return [createStore(Leaf, { key: "a" }), createStore(Leaf, { key: "b" })];
		}
	}
	const root = mount(createStore(Root));
	root.alias = root.children;
	const inspector = createInspector();
	try {
		const { rootId } = inspector.registerRoot("Root", root);
		const read = (at: GraphAddress) =>
			inspector.query({
				op: "inspect",
				rootId: at.rootId,
				path: at.path,
				depth: 1,
				maxEntries: 500,
				evaluateComputeds: false,
			});
		const shallow: any = read({ rootId, name: "Root", path: [] });
		expect(
			shallow.fields.find((field: any) => field.name === "children").value.kind
		).toBe("reference");
		const graph = buildInspectorGraph(
			[{ rootId, name: "Root", kind: "Store" }],
			read,
			new Map()
		);
		expect(graph.nodes).toHaveLength(4);
		expect(graph.nodes.find((node) => node.name === "children")!.kind).toBe(
			"array"
		);
		expect(
			graph.nodes.filter((node) => node.className === "Leaf")
		).toHaveLength(2);
		expect(
			graph.edges.filter((edge) => edge.kind === "ownership")
		).toHaveLength(3);
		const selectedValue = read({ rootId, name: "0", path: ["alias", "0"] });
		const alias = buildInspectorGraph(
			[{ rootId, name: "Root", kind: "Store" }],
			read,
			new Map(),
			{ rootId, name: "0", path: ["alias", "0"] },
			false,
			true,
			selectedValue
		);
		expect(alias.selectedId).toBe((selectedValue as any).id);
	} finally {
		inspector.dispose();
		root[Symbol.dispose]();
	}
});

test("diagram discovery does not initialize lazy child getters; placeholders select their parent", () => {
	let initialized = 0;
	class Leaf extends Store {}
	class Root extends Store {
		static types = { lazy: child };
		get lazy() {
			initialized++;
			return createStore(Leaf);
		}
	}
	const root = mount(createStore(Root));
	const inspector = createInspector();
	try {
		const { rootId } = inspector.registerRoot("Root", root);
		const graph = buildInspectorGraph(
			[{ rootId, name: "Root", kind: "Store" }],
			(at) =>
				inspector.query({
					op: "inspect",
					rootId: at.rootId,
					path: at.path,
					depth: 1,
					maxEntries: 500,
				}),
			new Map()
		);
		expect(initialized).toBe(0);
		expect(getStoreAdm(root).peekInspectionChild("lazy").initialized).toBe(
			false
		);
		const placeholder = graph.nodes.find(
			(node) => node.status === "not initialized"
		)!;
		expect(placeholder.name).toBe("lazy");
		expect(graph.addresses.get(placeholder.id)!.path).toEqual([]);
	} finally {
		inspector.dispose();
		root[Symbol.dispose]();
	}
});
