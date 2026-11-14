// @vitest-environment jsdom
import { createInspector } from "../src/devtools";
import type { Inspector, InspectionValue } from "../src/inspection/runtime";
import type { InspectionRequest } from "../src/inspection/protocol";
import { Model, Store, child, createStore, mount } from "../src/index";
import { getStoreAdm } from "../src/store/StoreAdministration";
import { cleanups, openPanel, fixture } from "./helpers/inspection-panel";

test("panel prioritizes values, labels computeds and children, and keeps transport metadata out of the view", () => {
	const { root, body, row, click } = fixture();
	expect(row("count").querySelector(".value-text")!.textContent).toBe("1");
	expect(row("count").querySelector(".field-meta")!.textContent).toBe("number");
	expect(row("double").querySelector(".field-meta")!.textContent).toBe(
		"Computed"
	);
	expect(row("double").querySelector(".value-text")!.textContent).toBe("2");
	expect(row("lazy").querySelector(".field-meta")!.textContent).toBe("Child");
	expect(row("lazy").querySelector(".value-text")!.textContent).toBe(
		"Not initialized"
	);
	expect(row("password").querySelector(".value-text")!.textContent).toBe(
		"Redacted"
	);
	expect(row("settings").querySelector(".value-text")!.textContent).toBe(
		"Object"
	);
	expect(body.textContent).not.toContain('"kind"');
	expect(body.textContent).not.toContain('"id"');
	expect(body.textContent).not.toContain("never-show-this-secret");
	expect(body.querySelector(".inline-input")).toBeNull();
	expect(body.querySelector(".methods-title")!.textContent).toContain(
		"Methods"
	);
	expect(
		body.querySelector<HTMLButtonElement>('[aria-label="Run method add"]')!
			.disabled
	).toBe(true);
	expect(getStoreAdm(root).peekInspectionChild("lazy").initialized).toBe(false);
	root.count = 3;
	expect(row("count").querySelector(".value-text")!.textContent).toBe("1");
	click("Refresh");
	expect(row("count").querySelector(".value-text")!.textContent).toBe("3");
	expect(row("double").querySelector(".value-text")!.textContent).toBe("6");
});

test("object links and breadcrumbs navigate live state; explicit initialization still uses the shared engine", () => {
	const { root, shadow, body, row, click } = fixture();
	click("Inspect settings");
	expect(row("theme").querySelector(".value-text")!.textContent).toBe('"dark"');
	expect(shadow.querySelector('[aria-current="page"]')!.textContent).toBe(
		"settings"
	);
	click("Go to Counter");
	click("Initialize child lazy");
	expect(getStoreAdm(root).peekInspectionChild("lazy").initialized).toBe(true);
	expect(row("lazy").querySelector(".value-text")!.textContent).toBe("Leaf");
	expect(row("lazy").querySelector(".initialize")).toBeNull();
	click("Inspect lazy");
	expect(body.textContent).toContain("Child ready");
	click("Up");
	click("Initialize child broken");
	expect(body.querySelector('[role="alert"]')!.textContent).toBe(
		"Could not initialize broken. Error details are hidden."
	);
	expect(body.textContent).not.toContain("never-show-this-exception");
	click("Refresh");
	expect(body.querySelector('[role="alert"]')).toBeNull();
});

test("protocol markers have readable summaries; only navigable objects get expansion controls", () => {
	const values: Record<string, InspectionValue> = {
		nil: null,
		flag: false,
		text: '<img src=x onerror="alert(1)">',
		missing: { kind: "unsupported", detail: "undefined" },
		map: { id: "private-map-id", kind: "unsupported", detail: "Map" },
		date: {
			id: "private-date-id",
			kind: "date",
			value: "2026-01-01T00:00:00.000Z",
		},
		failed: {
			kind: "error",
			detail: "Field evaluation failed (details withheld)",
		},
		long: { kind: "truncated", detail: "string", head: "hello", length: 1000 },
		limited: { kind: "truncated", detail: "entry budget" },
		alias: { kind: "reference", id: "private-reference-id" },
		items: { kind: "array", id: "private-array-id", truncated: true },
	};
	const query = vi.fn((request: InspectionRequest): InspectionValue => {
		if (request.op === "roots")
			return { roots: [{ rootId: "root-id", name: "Fixture", kind: "Store" }] };
		return {
			kind: "Store",
			id: "private-root-id",
			parentId: "private-parent-id",
			status: "mounted",
			fields: Object.entries(values).map(([name, value]) => ({
				name,
				value,
				edge: "object",
				type: "value",
			})),
		};
	});
	const { shadow, body, row } = openPanel(
		{ query } as unknown as Inspector,
		"Fixture"
	);
	for (const [name, expected] of Object.entries({
		nil: "null",
		flag: "false",
		missing: "undefined",
		map: "Map · not inspected",
		date: "2026-01-01T00:00:00.000Z",
		failed: "Could not evaluate",
		long: '"hello…"',
		limited: "Limit reached",
		alias: "Reference",
		items: "Array",
	}))
		expect(row(name).querySelector(".value-text")!.textContent).toBe(expected);
	expect(body.textContent).not.toContain("private-");
	expect(shadow.querySelector("img")).toBeNull();
	expect(row("map").querySelector("button")).toBeNull();
	expect(row("date").querySelector("button")).toBeNull();
	expect(
		row("alias").querySelector('button[aria-label="Inspect alias"]')
	).not.toBeNull();
	expect(
		row("items").querySelector('button[aria-label="Inspect items"]')
	).not.toBeNull();
	expect(row("long").querySelector(".value-text")!.getAttribute("title")).toBe(
		"Showing 5 of 1000 characters"
	);
});

test("unavailable selections have plain messages, and removing the panel leaves the app alone", () => {
	const { root, inspector, body, click, remove } = fixture();
	inspector.dispose();
	click("Refresh");
	expect(body.querySelector('[role="alert"]')!.textContent).toContain(
		"Return to Roots"
	);
	click("Roots");
	click("Refresh");
	expect(body.querySelector('[role="alert"]')).not.toBeNull();
	remove();
	expect(document.querySelector("[data-r-state-tree-inspector]")).toBeNull();
	expect(root.count).toBe(1);
	expect(root.signal.aborted).toBe(false);
});

test("empty registries and objects explain why no fields are shown", () => {
	const inspector = createInspector();
	cleanups.push(() => inspector.dispose());
	const empty = openPanel(inspector);
	expect(empty.body.textContent).toContain("No registered roots");
	empty.remove();
	const query = vi.fn((request: InspectionRequest): InspectionValue =>
		request.op === "roots"
			? { roots: [{ rootId: "empty", name: "Empty", kind: "Model" }] }
			: { kind: "Model", id: "private-id", status: "active", fields: [] }
	);
	const { body } = openPanel({ query } as unknown as Inspector, "Empty");
	expect(body.textContent).toContain("No inspectable fields");
	expect(body.textContent).not.toContain("private-id");
});

test("redacted props stay hidden without a misleading container link or empty-props claim", () => {
	class Feature extends Store<{ title: string }> {}
	const root = mount(createStore(Feature, { title: "never show this" }));
	const inspector = createInspector({
		controls: true,
		redact: (path) => path[0] === "props",
	});
	inspector.registerRoot("Feature", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const { body } = openPanel(inspector, "Feature");
	const props = body.querySelector('[data-group="Props"]')!;
	expect(props.textContent).toContain("Redacted");
	expect(props.textContent).not.toContain("No visible props");
	expect(body.textContent).not.toContain("never show this");
	expect(props.querySelector("button,input")).toBeNull();
});

test("Context overview only reads a provider on explicit request, and its result is not a control capability", () => {
	let reads = 0;
	const query = vi.fn((request: InspectionRequest): InspectionValue => {
		if (request.op === "roots")
			return {
				roots: [{ rootId: "root", name: "Context fixture", kind: "Store" }],
			};
		if (request.op === "context") {
			reads++;
			return {
				ok: true,
				result: {
					id: "result",
					kind: "object",
					fields: [
						{
							name: "label",
							value: "Shared service",
							type: "value",
							edge: "object",
						},
					],
				},
			};
		}
		return {
			id: "root",
			kind: "Store",
			fields: [],
			contexts: [
				{
					contextId: "ctx",
					name: "ApiContext",
					type: "Api",
					status: "inherited",
					providerId: "ancestor",
					providerClass: "ApplicationStore",
					declared: true,
				},
			],
			methods: [{ name: "run" }],
		};
	});
	const { body, click } = openPanel(
		{ query } as unknown as Inspector,
		"Context fixture"
	);
	expect(reads).toBe(0);
	expect(body.textContent).toContain("Inherited from ApplicationStore");
	expect(
		body.querySelector<HTMLButtonElement>('[aria-label="Run method run"]')!
			.disabled
	).toBe(true);
	click("Read Context ApiContext");
	expect(reads).toBe(1);
	expect(body.textContent).toContain("Shared service");
	expect(body.querySelector(".context-result .object-link")).toBeNull();
	click("Refresh");
	expect(reads).toBe(1);
	expect(body.textContent).not.toContain("Shared service");
});
