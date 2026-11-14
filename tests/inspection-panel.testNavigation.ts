// @vitest-environment jsdom
import { createInspector } from "../src/devtools";
import { Store, child, createStore, mount } from "../src/index";
import { getStoreAdm } from "../src/store/StoreAdministration";
import { cleanups, openPanel, fixture } from "./helpers/inspection-panel";

test("tree expansion and breadcrumbs keep the workspace, expansion and independent scroll positions", () => {
	const { shadow, click, row } = fixture();
	const tree = shadow.querySelector('[role="tree"]')!;
	const treePane = shadow.querySelector<HTMLElement>(".tree-pane")!;
	const detailsPane = shadow.querySelector<HTMLElement>(".details-pane")!;
	expect(
		tree.querySelector('[aria-label="Counter"]')!.getAttribute("aria-expanded")
	).toBe("true");
	click("Expand settings");
	expect(
		tree
			.querySelector('[role="treeitem"][aria-label="appearance"]')!
			.hasAttribute("aria-expanded")
	).toBe(false);
	expect(tree.querySelector('[aria-label="Expand appearance"]')).toBeNull();
	expect(tree.textContent).not.toContain("No child objects");
	treePane.scrollTop = 70;
	detailsPane.scrollTop = 30;
	click("Select settings");
	expect(row("theme").textContent).toContain("dark");
	expect(shadow.querySelector(".tree-pane")).toBe(treePane);
	expect(shadow.querySelector(".details-pane")).toBe(detailsPane);
	expect(treePane.scrollTop).toBe(70);
	expect(detailsPane.scrollTop).toBe(0);
	expect(
		tree.querySelector('[aria-label="settings"]')!.getAttribute("aria-selected")
	).toBe("true");
	click("Go to Counter");
	expect(detailsPane.scrollTop).toBe(30);
	expect(
		tree.querySelector('[aria-label="settings"]')!.getAttribute("aria-expanded")
	).toBe("true");
	click("Refresh");
	expect(treePane.scrollTop).toBe(70);
	expect(
		tree.querySelector('[aria-label="settings"]')!.getAttribute("aria-expanded")
	).toBe("true");
});

test("leaf objects stay selectable without an expand action, and refresh updates affordances when children change", () => {
	class Root extends Store {
		bucket: { nested?: { label: string } } = {};
	}
	const root = mount(createStore(Root));
	const inspector = createInspector();
	inspector.registerRoot("Mutable", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const { shadow, body, click } = openPanel(inspector, "Mutable");
	const tree = shadow.querySelector('[role="tree"]')!;
	expect(tree.querySelector('[aria-label="Expand bucket"]')).toBeNull();
	click("Select bucket");
	expect(shadow.querySelector('[aria-current="page"]')!.textContent).toBe(
		"bucket"
	);
	expect(
		tree
			.querySelector('[role="treeitem"][aria-label="bucket"]')!
			.hasAttribute("aria-expanded")
	).toBe(false);
	expect(body.textContent).not.toContain("No child objects");
	root.bucket = { nested: { label: "Ready" } };
	click("Refresh");
	expect(tree.querySelector('[aria-label="Collapse bucket"]')).not.toBeNull();
	expect(tree.querySelector('[aria-label="Expand nested"]')).toBeNull();
	root.bucket = {};
	click("Refresh");
	expect(
		tree.querySelector(
			'[aria-label="Expand bucket"], [aria-label="Collapse bucket"]'
		)
	).toBeNull();
	expect(tree.querySelector('[aria-label="Select bucket"]')).not.toBeNull();
});

test("tree does not initialize children and stops cycles without losing reference navigation", () => {
	class Cyclic extends Store {
		static types = { lazy: child };
		self = this;
		get lazy() {
			return createStore(Cyclic);
		}
	}
	const root = mount(createStore(Cyclic));
	const inspector = createInspector();
	inspector.registerRoot("Cycle", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const { shadow, click } = openPanel(inspector, "Cycle");
	const tree = shadow.querySelector('[role="tree"]')!;
	expect(tree.textContent).toContain("lazy · not initialized");
	expect(tree.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
	expect(
		tree.querySelector('[aria-label="self"]')!.hasAttribute("aria-expanded")
	).toBe(false);
	expect(getStoreAdm(root).peekInspectionChild("lazy").initialized).toBe(false);
	click("Select self");
	expect(shadow.querySelector('[aria-current="page"]')!.textContent).toBe(
		"self"
	);
	click("Refresh");
	expect(tree.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
});

test("tree keyboard navigation expands and collapses branches with one tab stop", () => {
	const { shadow, click } = fixture();
	const tree = shadow.querySelector('[role="tree"]')!;
	const choices = () => [
		...tree.querySelectorAll<HTMLButtonElement>(".tree-choice"),
	];
	const root = choices()[0];
	root.focus();
	root.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		})
	);
	expect(shadow.activeElement).toBe(choices()[1]);
	expect(choices().filter((choice) => choice.tabIndex === 0)).toHaveLength(1);
	click("Select settings");
	const selected = choices().find(
		(choice) => choice.getAttribute("aria-label") === "Select settings"
	)!;
	selected.focus();
	selected.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowLeft",
			bubbles: true,
			cancelable: true,
		})
	);
	expect(
		tree
			.querySelector('[role="treeitem"][aria-label="settings"]')!
			.getAttribute("aria-expanded")
	).toBe("false");
	const collapsed = choices().find(
		(choice) => choice.getAttribute("aria-label") === "Select settings"
	)!;
	collapsed.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowRight",
			bubbles: true,
			cancelable: true,
		})
	);
	expect(
		tree
			.querySelector('[role="treeitem"][aria-label="settings"]')!
			.getAttribute("aria-expanded")
	).toBe("true");
});
