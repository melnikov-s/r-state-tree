import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createInspector } from "../../devtools/src/devtools";
import type { Inspector } from "../../devtools/src/inspection/runtime";
import type { InspectionRequest } from "../../devtools/src/inspection/protocol";
import { dispatchInspection } from "../../devtools/src/inspection/bridge";
import { Store, child, computed, createStore, mount } from "../../src/index";
import { INSPECTION_SIGNATURES } from "../../devtools/src/inspection/signatures";

const panelHtml = readFileSync("devtools/extension/panel.html", "utf8");
const panelSource = readFileSync("devtools/extension/panel.js", "utf8");
const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	document.body.replaceChildren();
});

// Run the shipped extension document/script, not a replacement renderer. Only
// Chrome's message transport is adapted; requests use the real shared dispatcher.
async function openPanel(inspector: Inspector, name?: string) {
	const page = new DOMParser().parseFromString(panelHtml, "text/html");
	const requests: InspectionRequest[] = [];
	const tabId = 7;
	const instanceId = "test-instance";
	const sendMessage = vi.fn(
		async (
			tab: number,
			frame: {
				source: string;
				type: string;
				instanceId?: string;
				request: InspectionRequest;
			},
			options: { frameId: number }
		) => {
			expect(tab).toBe(tabId);
			expect(options).toEqual({ frameId: 0 });
			expect(frame.source).toBe("r-state-tree:panel");
			if (frame.type === "discover")
				return {
					instances: [
						{ instanceId, title: "Test app", url: "http://localhost" },
					],
				};
			expect(frame.type).toBe("query");
			expect(frame.instanceId).toBe(instanceId);
			const request = JSON.parse(
				JSON.stringify(frame.request)
			) as InspectionRequest;
			requests.push(request);
			return new Promise<unknown>((resolve) => {
				dispatchInspection(inspector, request, (response) => {
					// Match the extension transport's serialization boundary.
					resolve(JSON.parse(JSON.stringify(response)));
				});
			});
		}
	);
	runInNewContext(
		panelSource,
		{
			document: page,
			chrome: {
				tabs: { sendMessage },
				devtools: {
					inspectedWindow: { tabId },
					network: {
						onNavigated: {
							addListener() {},
						},
					},
				},
				runtime: { id: "test-extension", onMessage: { addListener() {} } },
			},
		},
		{ filename: "devtools/extension/panel.js" }
	);
	const body = page.getElementById("state")!;
	const status = page.getElementById("status")!;
	const button = (label: string) => {
		const result = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
			(item) =>
				item.textContent === label || item.getAttribute("aria-label") === label
		);
		expect(result, `Button ${label}`).toBeDefined();
		return result!;
	};
	const click = async (label: string) => {
		const target = button(label);
		expect(target.disabled, `Button ${label} is enabled`).toBe(false);
		await target.onclick!.call(target, new PointerEvent("click"));
	};
	const row = (field: string) => {
		const result = [...body.querySelectorAll<HTMLElement>("[data-field]")].find(
			(item) => item.dataset.field === field
		);
		expect(result, `Field ${field}`).toBeDefined();
		return result!;
	};
	const input = (label: string) => {
		const result = [
			...page.querySelectorAll<HTMLTextAreaElement>("textarea"),
		].find((item) => item.getAttribute("aria-label") === label);
		expect(result, `Input ${label}`).toBeDefined();
		return result!;
	};
	const evaluateComputeds = async () => {
		const checkbox = page.getElementById("computeds") as HTMLInputElement;
		checkbox.checked = !checkbox.checked;
		await checkbox.onchange!.call(checkbox, new Event("change"));
		await vi.waitFor(
			() =>
				expect(requests.at(-1)).toMatchObject({
					op: "inspect",
					evaluateComputeds: checkbox.checked,
				}),
			{ interval: 1 }
		);
		// The checkbox listener starts an asynchronous refresh without returning it.
		await vi.waitFor(() => expect(status.textContent).toContain("Connected"), {
			interval: 1,
		});
	};
	const remove = () => page.body.replaceChildren();
	cleanups.push(remove);
	await vi.waitFor(
		() => expect(status.textContent).not.toContain("Looking for"),
		{ interval: 1 }
	);
	if (name !== undefined) {
		const root = [
			...page.querySelectorAll<HTMLButtonElement>("#roots button"),
		].find((item) => item.textContent?.startsWith(`${name} · `));
		expect(root, `Root ${name}`).toBeDefined();
		await click(root!.textContent!);
	}
	return {
		page,
		body,
		status,
		button,
		click,
		row,
		input,
		requests,
		evaluateComputeds,
		remove,
	};
}

async function fixture(controls = false) {
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
	return { root, inspector, ...(await openPanel(inspector, "Counter")) };
}

export { cleanups, openPanel, fixture };
