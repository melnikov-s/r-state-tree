// @vitest-environment jsdom
import { createInspector, type Inspector } from "../devtools/src/devtools";
import { mountStateDiagram } from "../devtools/src/inspection/diagram";
import {
	buildInspectorGraph,
	type GraphAddress,
	type GraphRoot,
} from "../devtools/src/inspection/graph-data";
import { Model, Store, child, createStore, mount } from "../src/index";
import { cleanups, fixture } from "./helpers/inspection-panel";

// Diagram/graph modules remain standalone. The removed embedded panel's
// Diagram/Outline tabs are not part of the extension's public browser entry.
function rootsOf(inspector: Inspector) {
	return (inspector.query({ op: "roots" }) as { roots: GraphRoot[] }).roots;
}

function diagram(inspector: Inspector, roots: GraphRoot[]) {
	const container = document.createElement("div");
	document.body.append(container);
	let selected: GraphAddress | undefined = roots[0]
		? { ...roots[0], path: [] }
		: undefined;
	const expansion = new Map<string, boolean>();
	const read = (address: GraphAddress) =>
		inspector.query({
			op: "inspect",
			rootId: address.rootId,
			path: address.path,
			depth: 1,
			maxEntries: 200,
			evaluateComputeds: false,
		});
	let graph = buildInspectorGraph(roots, read, expansion, selected);
	const update = () => {
		graph = buildInspectorGraph(roots, read, expansion, selected);
		view.update(graph);
	};
	const select = vi.fn((id: string) => {
		selected = graph.addresses.get(id);
		update();
	});
	const view = mountStateDiagram(container, {
		select,
		toggle: (id) => {
			expansion.set(id, !graph.nodes.find((node) => node.id === id)!.expanded);
			update();
		},
	});
	cleanups.push(view.dispose);
	const viewport = container.querySelector<HTMLElement>(
		".rst-diagram-viewport"
	)!;
	vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 800,
		bottom: 400,
		width: 800,
		height: 400,
		toJSON() {},
	});
	view.update(graph);
	const click = (label: string) => {
		const button = [
			...container.querySelectorAll<HTMLButtonElement>("button"),
		].find((item) => item.getAttribute("aria-label") === label);
		expect(button, label).toBeDefined();
		button!.click();
	};
	return {
		container,
		click,
		select,
		scene: container.querySelector<HTMLElement>(".rst-diagram-scene")!,
		names: () =>
			[...container.querySelectorAll(".rst-diagram-name")].map(
				(node) => node.textContent
			),
		selected: () => selected,
		inspectSelected: () => read(selected!),
	};
}

afterEach(() => vi.restoreAllMocks());

test("diagram selection resolves to the same live overview address without replacing its shell", async () => {
	const { inspector } = await fixture();
	const view = diagram(inspector, rootsOf(inspector));
	const viewport = view.container.querySelector(".rst-diagram-viewport");
	view.click("Inspect diagram Counter");
	expect(view.select).toHaveBeenCalledOnce();
	expect(view.selected()).toMatchObject({ name: "Counter", path: [] });
	expect(
		view.container.querySelector('[aria-pressed="true"]')!.textContent
	).toContain("Counter");
	const value = view.inspectSelected() as {
		fields: { name: string; type: string }[];
	};
	expect(value.fields).toContainEqual(
		expect.objectContaining({ name: "double", type: "computed" })
	);
	view.click("Zoom in diagram");
	expect(view.container.querySelector(".rst-diagram-viewport")).toBe(viewport);
	expect(view.selected()!.name).toBe("Counter");
});

test("Store and Model ownership projections keep independent selection and viewports", () => {
	class Domain extends Model {
		title = "Readme";
		items = ["one", "two"];
	}
	class Leaf extends Store {}
	class Behavior extends Store<{ model: Domain }> {
		static types = { leaf: child };
		model = this.props.model;
		get leaf() {
			return createStore(Leaf);
		}
	}
	const model = Domain.create();
	const store = mount(createStore(Behavior, { model }));
	void store.leaf;
	const inspector = createInspector();
	inspector.registerRoot("Behavior", store);
	inspector.registerRoot("Domain", model);
	cleanups.push(
		() => store[Symbol.dispose](),
		() => model[Symbol.dispose](),
		() => inspector.dispose()
	);
	const roots = rootsOf(inspector);
	const stores = diagram(
		inspector,
		roots.filter((root) => root.kind === "Store")
	);
	const models = diagram(
		inspector,
		roots.filter((root) => root.kind === "Model")
	);
	expect(stores.names()).toContain("Behavior");
	expect(stores.names()).toContain("leaf");
	expect(stores.names()).not.toContain("Domain");
	expect(models.names()).toEqual(["Domain"]);
	stores.click("Inspect diagram leaf");
	stores.click("Zoom in diagram");
	const storesTransform = stores.scene.style.transform;
	models.click("Inspect diagram Domain");
	models.click("Zoom out diagram");
	const modelsTransform = models.scene.style.transform;
	expect(stores.scene.style.transform).toBe(storesTransform);
	expect(stores.selected()!.path).toEqual(["leaf"]);
	expect(models.selected()!.path).toEqual([]);
	stores.click("Inspect diagram Behavior");
	expect(models.scene.style.transform).toBe(modelsTransform);
	expect(models.selected()!.name).toBe("Domain");
	expect(stores.names()).not.toContain("Domain");
});

test("an empty diagram projection does not show registered roots of the other kind", async () => {
	const { inspector } = await fixture();
	const roots = rootsOf(inspector);
	const models = diagram(
		inspector,
		roots.filter((root) => root.kind === "Model")
	);
	expect(models.container.querySelectorAll(".rst-diagram-card")).toHaveLength(
		0
	);
	expect(
		models.container.querySelector<HTMLElement>(".rst-diagram-empty")!.hidden
	).toBe(false);
	expect(
		models.container.querySelector(".rst-diagram-empty")!.textContent
	).toBe("No state nodes to display");
	const stores = diagram(
		inspector,
		roots.filter((root) => root.kind === "Store")
	);
	expect(stores.names()).toContain("Counter");
	expect(
		stores.container.querySelectorAll(".rst-diagram-card").length
	).toBeGreaterThan(0);
	expect(models.container.querySelectorAll(".rst-diagram-card")).toHaveLength(
		0
	);
});
