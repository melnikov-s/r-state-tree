// @vitest-environment jsdom
import { createInspector } from "../src/devtools";
import { Model, Store, child, createStore, mount } from "../src/index";
import { cleanups, openPanel, fixture } from "./helpers/inspection-panel";

test("Diagram view shares selection with the overview and toggles without resizing the shell", () => {
	const { shadow, body, click } = fixture();
	click("Diagram");
	expect(shadow.querySelector<HTMLElement>(".diagram-pane")!.hidden).toBe(
		false
	);
	expect(
		shadow.querySelector(".workspace")!.classList.contains("diagram-mode")
	).toBe(true);
	click("Inspect diagram Counter");
	expect(shadow.querySelector('[aria-current="page"]')!.textContent).toBe(
		"Counter"
	);
	expect(body.querySelector('[data-group="Computed"]')!.textContent).toContain(
		"double"
	);
	click("Outline");
	expect(shadow.querySelector<HTMLElement>(".diagram-pane")!.hidden).toBe(true);
	expect(shadow.querySelector('[aria-current="page"]')!.textContent).toBe(
		"Counter"
	);
});

test("Stores and Models have separate diagrams, selections and viewports", () => {
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
	const { shadow, body, click } = openPanel(inspector, "Behavior");
	click("Diagram");
	const names = () =>
		[...body.querySelectorAll(".rst-diagram-name")].map(
			(node) => node.textContent
		);
	expect(names()).toContain("Behavior");
	expect(names()).not.toContain("Domain");
	expect(body.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
	click("Inspect diagram leaf");
	click("Zoom in diagram");
	const storesScene = body.querySelector<HTMLElement>(".rst-diagram-scene")!;
	const storesTransform = storesScene.style.transform;
	click("Models");
	expect(names()).toContain("Domain");
	expect(names()).not.toContain("Behavior");
	expect(names()).not.toContain("leaf");
	expect(shadow.querySelector('[aria-current="page"]')!.textContent).toBe(
		"Domain"
	);
	expect(
		body.querySelector<HTMLInputElement>(
			'[aria-label="Show available Context routes"]'
		)!.parentElement!.hidden
	).toBe(true);
	click("Zoom out diagram");
	const modelsScene = body.querySelector<HTMLElement>(".rst-diagram-scene")!;
	const modelsTransform = modelsScene.style.transform;
	click("Stores");
	expect(body.querySelector(".rst-diagram-scene")).toBe(storesScene);
	expect(storesScene.style.transform).toBe(storesTransform);
	expect(shadow.querySelector('[aria-current="page"]')!.textContent).toBe(
		"leaf"
	);
	click("Models");
	expect(body.querySelector(".rst-diagram-scene")).toBe(modelsScene);
	expect(modelsScene.style.transform).toBe(modelsTransform);
	expect(names()).toEqual(["Domain"]);
	click("Outline");
	click("Behavior");
	click("Diagram");
	expect(
		body.querySelector('[role="tab"][aria-selected="true"]')!.textContent
	).toBe("Stores");
	expect(names()).not.toContain("Domain");
	click("Outline");
	click("Inspect model");
	click("Inspect items");
	click("Diagram");
	click("Refresh");
	expect(
		body.querySelector('[role="tab"][aria-selected="true"]')!.textContent
	).toBe("Models");
	click("Stores");
	expect(
		body.querySelector('[role="tab"][aria-selected="true"]')!.textContent
	).toBe("Stores");
	expect(shadow.querySelector('[aria-current="page"]')!.textContent).toBe(
		"Behavior"
	);
	expect(names()).not.toContain("Domain");
});

test("an empty diagram category does not show roots from the other kind", () => {
	const { body, click } = fixture();
	click("Diagram");
	click("Models");
	expect(body.querySelectorAll(".rst-diagram-card")).toHaveLength(0);
	expect(body.textContent).toContain("No registered Model roots.");
	click("Stores");
	expect(body.querySelectorAll(".rst-diagram-card").length).toBeGreaterThan(0);
	expect(body.querySelector('[aria-current="page"]')!.textContent).toBe(
		"Counter"
	);
});
