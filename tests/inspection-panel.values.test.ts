// @vitest-environment jsdom
import { createInspector } from "../devtools/src/devtools";
import type {
	Inspector,
	InspectionValue,
} from "../devtools/src/inspection/runtime";
import type { InspectionRequest } from "../devtools/src/inspection/protocol";
import { Store, createStore, mount } from "../src/index";
import { getStoreAdm } from "../src/store/StoreAdministration";
import { cleanups, openPanel, fixture } from "./helpers/inspection-panel";

// The embedded panel was removed. These exercise the shipped extension's table,
// explicit computed evaluation, manual refresh and transport-backed actions.
test("extension shows live values, relationship labels and redaction without eagerly evaluating computeds or children", async () => {
	const { root, page, body, row, click, evaluateComputeds } = await fixture();
	expect(row("count").querySelector("code")!.textContent).toBe("1");
	expect(row("count").querySelector(".meta")!.textContent).toContain("value");
	expect(row("double").querySelector(".meta")!.textContent).toContain(
		"computed"
	);
	expect(row("double").querySelector("code")!.textContent).toBe(
		"Not evaluated"
	);
	expect(row("lazy").querySelector(".meta")!.textContent).toContain("child");
	expect(row("lazy").querySelector("code")!.textContent).toBe(
		"Not initialized"
	);
	expect(row("password").querySelector("code")!.textContent).toBe("Redacted");
	expect(body.textContent).not.toContain("never-show-this-secret");
	expect(body.textContent).not.toContain('"kind"');
	expect(page.querySelector("textarea")).toBeNull();
	expect(body.textContent).toContain("Supported methods · read-only");
	expect(
		[...body.querySelectorAll("button")].some(
			(button) => button.textContent === "Call add"
		)
	).toBe(false);
	expect(getStoreAdm(root).peekInspectionChild("lazy").initialized).toBe(false);
	await evaluateComputeds();
	await vi.waitFor(() =>
		expect(row("double").querySelector("code")!.textContent).toBe("2")
	);
	root.count = 3;
	expect(row("count").querySelector("code")!.textContent).toBe("1");
	await click("Reconnect / refresh");
	expect(row("count").querySelector("code")!.textContent).toBe("3");
	expect(row("double").querySelector("code")!.textContent).toBe("6");
	expect(getStoreAdm(root).peekInspectionChild("lazy").initialized).toBe(false);
});

test("object links and Up navigate live state; explicit child initialization uses the shared engine and hides failures", async () => {
	const { root, page, body, row, click, status, requests } = await fixture();
	await click("Inspect settings");
	expect(row("theme").querySelector("code")!.textContent).toBe('"dark"');
	expect(page.getElementById("selection")!.textContent).toBe(
		"Counter · Store / settings"
	);
	await click("Up");
	await click("Initialize lazy");
	expect(getStoreAdm(root).peekInspectionChild("lazy").initialized).toBe(true);
	expect(row("lazy").querySelector("code")!.textContent).toBe("Leaf");
	expect(row("lazy").textContent).not.toContain("Initialize lazy");
	expect(requests).toContainEqual(
		expect.objectContaining({
			op: "initialize",
			field: "lazy",
			levels: 1,
			maxInitializations: 1,
		})
	);
	await click("Inspect lazy");
	expect(body.textContent).toContain("Child ready");
	await click("Up");
	await click("Initialize broken");
	expect(status.className).toBe("error");
	expect(status.textContent).toContain("Child initialization failed");
	expect(page.body.textContent).not.toContain("never-show-this-exception");
	await click("Reconnect / refresh");
	expect(status.className).toBe("");
});

test("protocol markers are readable text and only supported object identities get navigation actions", async () => {
	const values: Record<string, InspectionValue> = {
		nil: null,
		flag: false,
		text: '<img src=x onerror="alert(1)">',
		missing: { kind: "unsupported", detail: "undefined" },
		map: { id: "map-id", kind: "unsupported", detail: "Map" },
		date: { id: "date-id", kind: "date", value: "2026-01-01T00:00:00.000Z" },
		failed: {
			kind: "error",
			detail: "Field evaluation failed (details withheld)",
		},
		long: { kind: "truncated", detail: "string", head: "hello", length: 1000 },
		limited: { kind: "truncated", detail: "entry budget" },
		alias: { kind: "reference", id: "reference-id" },
		items: { kind: "array", id: "array-id", truncated: true },
	};
	const query = vi.fn((request: InspectionRequest): InspectionValue =>
		request.op === "roots"
			? { roots: [{ rootId: "root-id", name: "Fixture", kind: "Store" }] }
			: {
					kind: "Store",
					id: "root-id",
					parentId: "parent-id",
					status: "mounted",
					fields: Object.entries(values).map(([name, value]) => ({
						name,
						value,
						edge: "object",
						type: "value",
					})),
				}
	);
	const { page, body, row } = await openPanel(
		{ query } as unknown as Inspector,
		"Fixture"
	);
	for (const [name, expected] of Object.entries({
		nil: "null",
		flag: "false",
		missing: "Not inspectable",
		map: "Not inspectable",
		date: "date",
		failed: "Evaluation failed",
		long: "Limit reached",
		limited: "Limit reached",
		alias: "Reference",
		items: "array",
	}))
		expect(row(name).querySelector("code")!.textContent).toBe(expected);
	expect(row("text").querySelector("code")!.textContent).toBe(
		JSON.stringify(values.text)
	);
	expect(page.querySelector("img")).toBeNull();
	for (const name of ["map", "date", "long", "failed"])
		expect(row(name).querySelector("button")).toBeNull();
	for (const name of ["alias", "items"])
		expect(row(name).querySelector("button")!.textContent).toBe(
			`Inspect ${name}`
		);
	expect(body.querySelector(".meta")!.textContent).toContain(
		"parent parent-id"
	);
});

test("unavailable selections show a reconnect error; closing the extension document leaves the app running", async () => {
	const { root, inspector, page, body, click, status, remove } =
		await fixture();
	inspector.dispose();
	await click("Reconnect / refresh");
	expect(status.className).toBe("error");
	expect(status.textContent).toContain("Use Reconnect / refresh to rediscover");
	expect(body.children).toHaveLength(0);
	remove();
	expect(page.body.children).toHaveLength(0);
	expect(document.querySelector("[data-r-state-tree-inspector]")).toBeNull();
	expect(root.count).toBe(1);
	expect(root.signal.aborted).toBe(false);
});

test("empty registries and field lists render without inventing data", async () => {
	const inspector = createInspector();
	cleanups.push(() => inspector.dispose());
	const empty = await openPanel(inspector);
	expect(empty.status.textContent).toBe("Connected; no registered roots.");
	expect(empty.page.querySelectorAll("#roots button")).toHaveLength(0);
	expect(empty.body.children).toHaveLength(0);
	const query = vi.fn((request: InspectionRequest): InspectionValue =>
		request.op === "roots"
			? { roots: [{ rootId: "empty", name: "Empty", kind: "Model" }] }
			: { kind: "Model", id: "empty", status: "active", fields: [] }
	);
	const { body, page } = await openPanel(
		{ query } as unknown as Inspector,
		"Empty"
	);
	expect(body.querySelectorAll("tbody tr")).toHaveLength(0);
	expect(body.querySelector("thead")!.textContent).toContain("Live value");
	expect(page.getElementById("selection")!.textContent).toBe("Empty · Model");
});

test("redacted props have no navigation or edit capability and never reveal their values", async () => {
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
	const { body, row } = await openPanel(inspector, "Feature");
	expect(row("props").querySelector("code")!.textContent).toBe("Redacted");
	expect(row("props").querySelector("button,input,textarea")).toBeNull();
	expect(body.textContent).not.toContain("never show this");
});

test("Context providers are read explicitly and returned objects do not become navigation/control capabilities", async () => {
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
	const { body, click, requests } = await openPanel(
		{ query } as unknown as Inspector,
		"Context fixture"
	);
	expect(reads).toBe(0);
	expect(body.textContent).toContain("ApiContext · inherited");
	expect(body.querySelector("textarea")).toBeNull();
	await click("Read Context ApiContext");
	expect(reads).toBe(1);
	expect(body.querySelector("pre")!.textContent).toContain("Shared service");
	expect(body.querySelector("pre button,pre textarea")).toBeNull();
	expect(requests).toContainEqual({
		op: "context",
		rootId: "root",
		path: [],
		contextId: "ctx",
	});
	await click("Reconnect / refresh");
	expect(reads).toBe(1);
	expect(body.textContent).not.toContain("Shared service");
});
