// @vitest-environment jsdom
import { createInspector } from "../devtools/src/devtools";
import { Store, child, createStore, mount } from "../src/index";
import { getStoreAdm } from "../src/store/StoreAdministration";
import { cleanups, openPanel, fixture } from "./helpers/inspection-panel";

// The extension replaces the old expandable tree, custom keyboard model and
// cached scroll panes with root buttons, explicit object links and an Up button.
test("nested object navigation keeps the extension shell and selection path across refresh", async () => {
	const { page, click, row, button } = await fixture();
	const roots = page.getElementById("roots");
	const state = page.getElementById("state");
	expect(button("Up").disabled).toBe(true);
	await click("Inspect settings");
	expect(row("theme").textContent).toContain("dark");
	expect(page.getElementById("selection")!.textContent).toBe(
		"Counter · Store / settings"
	);
	await click("Inspect appearance");
	expect(row("density").textContent).toContain("compact");
	await click("Reconnect / refresh");
	expect(page.getElementById("selection")!.textContent).toBe(
		"Counter · Store / settings / appearance"
	);
	expect(page.getElementById("roots")).toBe(roots);
	expect(page.getElementById("state")).toBe(state);
	await click("Up");
	expect(row("theme").textContent).toContain("dark");
	await click("Up");
	expect(button("Up").disabled).toBe(true);
	expect(row("count").querySelector("code")!.textContent).toBe("1");
});

test("empty objects stay selectable and refreshed fields follow changes in the live app", async () => {
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
	const { page, body, click, row } = await openPanel(inspector, "Mutable");
	await click("Inspect bucket");
	expect(page.getElementById("selection")!.textContent).toBe(
		"Mutable · Store / bucket"
	);
	expect(body.querySelectorAll("tbody tr")).toHaveLength(0);
	root.bucket = { nested: { label: "Ready" } };
	await click("Reconnect / refresh");
	expect(row("nested").querySelector("button")!.textContent).toBe(
		"Inspect nested"
	);
	await click("Inspect nested");
	expect(row("label").querySelector("code")!.textContent).toBe('"Ready"');
	await click("Up");
	root.bucket = {};
	await click("Reconnect / refresh");
	expect(body.querySelectorAll("tbody tr")).toHaveLength(0);
	await click("Up");
	expect(row("bucket").querySelector("button")!.textContent).toBe(
		"Inspect bucket"
	);
});

test("cyclic reference navigation stays bounded and never initializes lazy children", async () => {
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
	const { page, body, row, click, requests } = await openPanel(
		inspector,
		"Cycle"
	);
	const fieldCount = body.querySelectorAll("[data-field]").length;
	expect(row("lazy").querySelector("code")!.textContent).toBe(
		"Not initialized"
	);
	await click("Inspect self");
	expect(page.getElementById("selection")!.textContent).toBe(
		"Cycle · Store / self"
	);
	await click("Reconnect / refresh");
	expect(body.querySelectorAll("[data-field]")).toHaveLength(fieldCount);
	expect(getStoreAdm(root).peekInspectionChild("lazy").initialized).toBe(false);
	expect(requests.some((request) => request.op === "initialize")).toBe(false);
});

test("extension navigation exposes native buttons rather than the retired tree keyboard model", async () => {
	const { page, click, button, row } = await fixture();
	for (const label of ["Counter · Store", "Inspect settings", "Up"]) {
		expect(button(label).tagName).toBe("BUTTON");
		expect(button(label).tabIndex).toBe(0);
	}
	expect(button("Up").disabled).toBe(true);
	await click("Inspect settings");
	expect(button("Up").disabled).toBe(false);
	expect(row("theme").querySelector("code")!.textContent).toBe('"dark"');
	expect(button("Inspect appearance").tabIndex).toBe(0);
	await click("Up");
	expect(page.querySelector('#roots [aria-current="page"]')!.textContent).toBe(
		"Counter · Store"
	);
	expect(button("Up").disabled).toBe(true);
	expect(row("count").querySelector("code")!.textContent).toBe("1");
});
