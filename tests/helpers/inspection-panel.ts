import { createInspector, mountInspectorPanel } from "../../src/devtools";
import type { Inspector } from "../../src/inspection/runtime";
import { Store, child, computed, createStore, mount } from "../../src/index";
import { INSPECTION_SIGNATURES } from "../../src/inspection/signatures";

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.reverse()) cleanup();
	cleanups.length = 0;
	document.body.replaceChildren();
});

function openPanel(inspector: Inspector, name?: string) {
	const remove = mountInspectorPanel(inspector);
	cleanups.push(remove);
	const shadow = document.querySelector(
		"[data-r-state-tree-inspector]"
	)!.shadowRoot!;
	const body = shadow.querySelector("section")!;
	const click = (label: string) => {
		const button = [
			...shadow.querySelectorAll<HTMLElement>("button,summary"),
		].find(
			(b) => b.getAttribute("aria-label") === label || b.textContent === label
		);
		expect(button, `Button ${label}`).toBeDefined();
		button!.click();
	};
	const details = shadow.querySelector("details")!;
	details.open = true;
	details.dispatchEvent(new Event("toggle"));
	if (name !== undefined) click(name);
	const row = (field: string) =>
		[...body.querySelectorAll(".row")].find(
			(node) => node.getAttribute("data-field") === field
		)!;
	return { shadow, body, click, row, remove };
}

function fixture(controls = false) {
	class Leaf extends Store {
		message = "Child ready";
	}
	class Root extends Store {
		static types = { lazy: child, broken: child, double: computed };
		count = 1;
		password = "never-show-this-secret";
		settings = { theme: "dark", appearance: { density: "compact" } };
		get double() {
			return this.count * 2;
		}
		add(n: number) {
			this.count += n;
			return this.count;
		}
		async addAsync(n: number) {
			await Promise.resolve();
			this.count += n;
			return this.count;
		}
		fail() {
			this.count++;
			throw new Error("never-show-this-exception");
		}
		get lazy() {
			return createStore(Leaf);
		}
		get broken() {
			throw new Error("never-show-this-exception");
		}
	}
	Object.defineProperty(Root.prototype, INSPECTION_SIGNATURES, {
		value: [
			{
				name: "add",
				method: Root.prototype.add,
				parameters: [{ name: "n", type: "number", kind: "number" }],
			},
			{
				name: "addAsync",
				method: Root.prototype.addAsync,
				parameters: [{ name: "n", type: "number", kind: "number" }],
			},
			{ name: "fail", method: Root.prototype.fail, parameters: [] },
		],
	});
	const root = mount(createStore(Root));
	const inspector = createInspector({ controls });
	inspector.registerRoot("Counter", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	return { root, inspector, ...openPanel(inspector, "Counter") };
}

export { cleanups, openPanel, fixture };
