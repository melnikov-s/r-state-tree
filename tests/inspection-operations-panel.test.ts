// @vitest-environment jsdom
import {
	createInspector,
	createOperationTimeline,
	mountInspectorPanel,
} from "../src/devtools";
import { Store, createStore, mount } from "../src/index";

test("Operations view shows safe text, manual updates, gated clear and preserves state views", () => {
	const timeline = createOperationTimeline({ maxEntries: 2 });
	const inspector = createInspector({ operations: timeline, controls: true });
	class Root extends Store {
		count = 1;
	}
	const root = mount(createStore(Root));
	inspector.registerRoot("Counter", root);
	const remove = mountInspectorPanel(inspector);
	const shadow = document.querySelector(
		"[data-r-state-tree-inspector]"
	)!.shadowRoot!;
	const click = (label: string) => {
		const button = [...shadow.querySelectorAll("button")].find(
			(node) =>
				node.textContent === label || node.getAttribute("aria-label") === label
		)!;
		expect(button, label).toBeDefined();
		button.click();
	};
	try {
		const shell = shadow.querySelector("details")!;
		shell.open = true;
		shell.dispatchEvent(new Event("toggle"));
		click("Counter");
		const selected = shadow.querySelector(".details-pane")!.textContent;
		click("Operations");
		expect((shadow.querySelector(".workspace") as HTMLElement).hidden).toBe(
			true
		);
		expect(shadow.querySelector(".operations-pane")!.textContent).toContain(
			"No recorded operations"
		);
		try {
			timeline.run("<script>private markup</script>", () => {
				throw new Error("Service unavailable");
			});
		} catch {
			/* expected */
		}
		click("Refresh");
		expect(shadow.querySelector(".operation-record")!.textContent).toContain(
			"Service unavailable"
		);
		expect(shadow.querySelector(".operation-record")!.textContent).toContain(
			"failed"
		);
		expect(shadow.querySelector(".operation-record script")).toBeNull();
		expect(shadow.querySelector(".operation-record")!.textContent).toContain(
			"ms"
		);
		click("Diagram");
		expect(
			(shadow.querySelector(".operations-pane") as HTMLElement).hidden
		).toBe(true);
		click("Operations");
		click("Outline");
		expect(shadow.querySelector(".details-pane")!.textContent).toBe(selected);
		click("Operations");
		click("Clear operations");
		expect(timeline.list()).toEqual([]);
		expect(shadow.querySelector(".operations-pane")!.textContent).toContain(
			"No recorded operations"
		);
	} finally {
		remove();
		inspector.dispose();
		timeline.dispose();
		root[Symbol.dispose]();
	}
	expect(document.querySelector("[data-r-state-tree-inspector]")).toBeNull();
});

test("read-only inspectors can view operations but cannot clear; absent/redacted timelines are honest", () => {
	for (const mode of ["readonly", "absent", "redacted"]) {
		const timeline = createOperationTimeline();
		timeline.run("hidden label", () => 1);
		const inspector = createInspector({
			operations: mode === "absent" ? undefined : timeline,
			redact:
				mode === "redacted" ? (path) => path[0] === "$operations" : undefined,
		});
		const remove = mountInspectorPanel(inspector);
		try {
			const shadow = document.querySelector(
				"[data-r-state-tree-inspector]"
			)!.shadowRoot!;
			[...shadow.querySelectorAll("button")]
				.find((node) => node.textContent === "Operations")!
				.click();
			const pane = shadow.querySelector(".operations-pane")!;
			if (mode === "readonly") {
				expect(pane.textContent).toContain("hidden label");
				expect(
					(pane.querySelector("button") as HTMLButtonElement).disabled
				).toBe(true);
			} else {
				expect(pane.textContent).not.toContain("hidden label");
				expect(pane.textContent).toContain(
					mode === "absent" ? "No operation timeline attached" : "redacted"
				);
			}
		} finally {
			remove();
			inspector.dispose();
			timeline.dispose();
		}
	}
});
