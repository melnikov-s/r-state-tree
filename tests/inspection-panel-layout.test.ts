// @vitest-environment jsdom
import {
	createInspector,
	mountInspectorPanel,
	type InspectorPanelOptions,
} from "../src/devtools";
import { Store, createStore, mount } from "../src/index";

const cleanups: (() => void)[] = [];
const originalOverflow = document.documentElement.style.overflow;
const originalPriority =
	document.documentElement.style.getPropertyPriority("overflow");
afterEach(() => {
	for (const cleanup of cleanups.reverse()) cleanup();
	cleanups.length = 0;
	document.body.replaceChildren();
	document.documentElement.style.setProperty(
		"overflow",
		originalOverflow,
		originalPriority
	);
});
function panel(options: HTMLElement | InspectorPanelOptions = {}) {
	class Counter extends Store {
		count = 1;
	}
	const root = mount(createStore(Counter));
	const inspector = createInspector({ controls: true });
	inspector.registerRoot("Counter", root);
	const before = new Set(
		document.querySelectorAll("[data-r-state-tree-inspector]")
	);
	const remove = mountInspectorPanel(inspector, options);
	const host = [
		...document.querySelectorAll<HTMLElement>("[data-r-state-tree-inspector]"),
	].find((node) => !before.has(node))!;
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose(),
		remove
	);
	const shadow = host.shadowRoot!;
	const toggle = () =>
		shadow
			.querySelector<HTMLButtonElement>("[data-inspector-fullscreen-toggle]")!
			.click();
	return {
		host,
		shadow,
		shell: shadow.querySelector<HTMLDetailsElement>(".inspector-shell")!,
		toggle,
		remove,
		root,
		inspector,
	};
}

test("embedded placement defaults open, and fullscreen restores the exact container slot", () => {
	const container = document.createElement("aside");
	document.body.append(container);
	const before = document.createElement("span");
	container.append(before);
	const p = panel({ container, layout: "embedded" });
	const after = document.createElement("span");
	container.append(after);
	expect(p.host.parentNode).toBe(container);
	expect(p.host.getAttribute("data-inspector-layout")).toBe("embedded");
	expect(p.shell.open).toBe(true);
	p.toggle();
	expect(p.host.parentNode).toBe(document.body);
	expect(p.host.hasAttribute("data-fullscreen")).toBe(true);
	expect(p.host.getAttribute("role")).toBe("dialog");
	expect(p.host.getAttribute("aria-modal")).toBe("true");
	p.shadow.querySelector<HTMLElement>(".panel-heading")!.click();
	expect(p.shell.open).toBe(true);
	p.toggle();
	expect([...container.children]).toEqual([before, p.host, after]);
	expect(p.host.hasAttribute("data-fullscreen")).toBe(false);
	expect(p.host.hasAttribute("aria-modal")).toBe(false);
	expect(p.host.hasAttribute("role")).toBe(false);
	expect(p.shell.open).toBe(true);
	expect(
		p.shadow.querySelector(".panel-heading")!.hasAttribute("aria-disabled")
	).toBe(false);
});

test("fullscreen startup opens the panel and Escape restores layout, focus and scrolling", () => {
	const appButton = document.createElement("button");
	document.body.append(appButton);
	appButton.focus();
	document.documentElement.style.setProperty("overflow", "scroll", "important");
	const p = panel({ fullscreen: true, open: false });
	expect(p.shell.open).toBe(true);
	expect(p.host.hasAttribute("data-fullscreen")).toBe(true);
	expect(document.documentElement.style.overflow).toBe("hidden");
	expect(p.shadow.activeElement).toBe(
		p.shadow.querySelector("[data-inspector-fullscreen-toggle]")
	);
	window.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
	);
	expect(p.host.hasAttribute("data-fullscreen")).toBe(false);
	expect(document.documentElement.style.overflow).toBe("scroll");
	expect(document.documentElement.style.getPropertyPriority("overflow")).toBe(
		"important"
	);
	expect(document.activeElement).toBe(appButton);
});

test("an input's consumed Escape cancels its edit before exiting fullscreen", () => {
	const p = panel({ fullscreen: true });
	const input = document.createElement("input");
	p.shadow.append(input);
	input.addEventListener("keydown", (event) => event.preventDefault());
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			composed: true,
			cancelable: true,
		})
	);
	expect(p.host.hasAttribute("data-fullscreen")).toBe(true);
	p.shadow
		.querySelector<HTMLButtonElement>("[data-inspector-fullscreen-toggle]")!
		.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				composed: true,
				cancelable: true,
			})
		);
	expect(p.host.hasAttribute("data-fullscreen")).toBe(false);
});

test("cleanup while fullscreen releases scroll lock and portal without disposing app state", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const p = panel({ container, layout: "embedded", fullscreen: true });
	p.remove();
	p.remove();
	expect(document.querySelector("[data-r-state-tree-inspector]")).toBeNull();
	expect(container.childNodes).toHaveLength(0);
	expect(document.documentElement.style.overflow).toBe(originalOverflow);
	expect(p.root.signal.aborted).toBe(false);
	expect((p.inspector.query({ op: "roots" }) as any).roots).toHaveLength(1);
});

test("multiple fullscreen panels keep one scroll lock and only the top panel traps focus", () => {
	document.documentElement.style.overflow = "auto";
	const first = panel({ fullscreen: true });
	const second = panel({ fullscreen: true });
	expect(document.activeElement).toBe(second.host);
	first.remove();
	expect(document.documentElement.style.overflow).toBe("hidden");
	expect(document.activeElement).toBe(second.host);
	second.remove();
	expect(document.documentElement.style.overflow).toBe("auto");
});

test("legacy containers keep the floating default and open can be chosen explicitly", () => {
	const container = document.createElement("div");
	document.body.append(container);
	const legacy = panel(container);
	expect(legacy.host.parentNode).toBe(container);
	expect(legacy.host.getAttribute("data-inspector-layout")).toBe("floating");
	expect(legacy.shell.open).toBe(false);
	const opened = panel({ open: true });
	expect(opened.shell.open).toBe(true);
});
