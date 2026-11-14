// @vitest-environment jsdom
import { createInspector, mountInspectorPanel } from "../devtools/src/devtools";
import { Store, mount, createStore } from "../src/index";

test("Operations shows automatic calls and inline before/after values grouped by batch", () => {
	class Counter extends Store {
		count = 0;
		increment() {
			this.count++;
		}
	}
	const counter = mount(createStore(Counter));
	const inspector = createInspector({ activity: true, controls: true });
	inspector.registerRoot("Counter", counter);
	const remove = mountInspectorPanel(inspector);
	try {
		counter.increment();
		const shadow = document.querySelector(
			"[data-r-state-tree-inspector]"
		)!.shadowRoot!;
		[...shadow.querySelectorAll("button")]
			.find((b) => b.textContent === "Operations")!
			.click();
		const pane = shadow.querySelector(".operations-pane")!;
		expect(pane.querySelector(".operation-batch summary")!.textContent).toBe(
			"Batch · 1 calls · 1 writes"
		);
		expect(
			pane.querySelectorAll(".batch-records .operation-record")
		).toHaveLength(2);
		expect(pane.querySelector(".operation-change")!.textContent).toContain(
			"0 → 1"
		);
		expect(pane.textContent).toContain("Counter › count");
		expect(pane.textContent).toContain("increment");
		[...shadow.querySelectorAll("button")]
			.find((b) => b.textContent === "Clear operations")!
			.click();
		expect(pane.textContent).toContain("No recorded operations");
		expect(counter.count).toBe(1);
	} finally {
		remove();
		inspector.dispose();
		counter[Symbol.dispose]();
	}
});
