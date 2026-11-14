// @vitest-environment jsdom
import { createInspector, mountInspectorPanel } from "../devtools/src/devtools";
import type {
	Inspector,
	InspectionValue,
} from "../devtools/src/inspection/runtime";
import type { InspectionRequest } from "../devtools/src/inspection/protocol";
import {
	Model,
	Store,
	child,
	computed,
	createStore,
	mount,
} from "../src/index";
import { getStoreAdm } from "../src/store/StoreAdministration";
import { INSPECTION_SIGNATURES } from "../devtools/src/inspection/signatures";

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

test("opt-in panel edits inline and calls methods with named typed arguments through the shared engine", async () => {
	const { root, body, row, click } = fixture(true);
	// Let the browser's queued initial details toggle finish before submitting async controls.
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(body.textContent).toContain("Controls enabled");
	expect(row("password").querySelector("input,textarea,select")).toBeNull();
	expect(row("double").querySelector("input,textarea,select")).toBeNull();
	expect(row("lazy").querySelector("input,textarea,select")).toBeNull();
	expect(body.querySelector('[aria-label="Edit field count"]')).toBeNull();
	let form = row("count").querySelector("form")!;
	const input = form.querySelector("input")!;
	input.value = "not a number";
	form.dispatchEvent(new Event("submit", { cancelable: true }));
	expect(form.textContent).toContain("finite number");
	expect(root.count).toBe(1);
	input.value = "10";
	form.dispatchEvent(new Event("submit", { cancelable: true }));
	await vi.waitFor(() =>
		expect(row("count").querySelector("input")!.value).toBe("10")
	);
	expect(root.count).toBe(10);
	form = body.querySelector('[data-method="addAsync"] form')!;
	form.querySelector("input")!.value = "3";
	expect(form.textContent).toContain("number");
	form.dispatchEvent(new Event("submit", { cancelable: true }));
	expect(form.querySelector("button")!.disabled).toBe(true);
	await vi.waitFor(() => expect(body.textContent).toContain("Returned: 13"));
	expect(root.count).toBe(13);
	expect(row("count").querySelector("input")!.value).toBe("13");
});

test("panel reports method failures safely and refreshes partial effects", async () => {
	const { root, body, row, click } = fixture(true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	click("Configure method fail");
	body
		.querySelector('[data-method="fail"] form')!
		.dispatchEvent(new Event("submit", { cancelable: true }));
	await vi.waitFor(() =>
		expect(body.querySelector('[role="alert"]')!.textContent).toContain(
			"state may have changed"
		)
	);
	expect(root.count).toBe(2);
	expect(row("count").querySelector("input")!.value).toBe("2");
	expect(body.textContent).not.toContain("never-show-this-exception");
});

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

test("inline edits save on blur, cancel on Escape, and preserve focus after saving", async () => {
	const { root, row, body } = fixture(true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	let input = row("count").querySelector("input")!;
	input.focus();
	input.value = "9";
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
	);
	expect(root.count).toBe(1);
	input.focus();
	input.value = "7";
	input.dispatchEvent(new FocusEvent("blur"));
	await vi.waitFor(() => expect(root.count).toBe(7));
	await vi.waitFor(() => expect(body.textContent).toContain("Saved count"));
	input = row("count").querySelector("input")!;
	expect(input.value).toBe("7");
});

test("typed method drafts survive refresh and tree navigation", async () => {
	const { shadow, body, click } = fixture(true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	click("Configure method add");
	body.querySelector<HTMLInputElement>(
		'[data-method="add"] [data-parameter="n"]'
	)!.value = "42";
	click("Refresh");
	expect(
		body.querySelector<HTMLInputElement>(
			'[data-method="add"] [data-parameter="n"]'
		)!.value
	).toBe("42");
	expect(
		body.querySelector<HTMLDetailsElement>('[data-method="add"]')!.open
	).toBe(true);
	click("Select settings");
	click("Go to Counter");
	expect(
		body.querySelector<HTMLInputElement>(
			'[data-method="add"] [data-parameter="n"]'
		)!.value
	).toBe("42");
	expect(
		shadow.querySelector("textarea[aria-label='JSON arguments for add']")
	).toBeNull();
});

test("missing method metadata gets individual arguments, without guessed names or types", async () => {
	class Plain extends Store {
		count = 1;
		add(n: number) {
			this.count += n;
			return this.count;
		}
	}
	const root = mount(createStore(Plain));
	const inspector = createInspector({ controls: true });
	inspector.registerRoot("Plain", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const { body, click } = openPanel(inspector, "Plain");
	await new Promise((resolve) => setTimeout(resolve, 0));
	click("Configure method add");
	click("+ Argument");
	body.querySelector<HTMLTextAreaElement>(
		'[data-parameter="argument 1"]'
	)!.value = "5";
	click("Run method add");
	await vi.waitFor(() => expect(root.count).toBe(6));
	await vi.waitFor(() => expect(body.textContent).toContain("Returned: 6"));
});

test("overview groups show props, computed fields and methods together, and inline props target their own path", async () => {
	class Feature extends Store<{ title: string }> {
		count = 2;
		get double() {
			return this.count * 2;
		}
		rename(title: string) {
			this.props.title = title;
		}
	}
	const root = mount(createStore(Feature, { title: "Original" }));
	const inspector = createInspector({ controls: true });
	inspector.registerRoot("Feature", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const { shadow, body } = openPanel(inspector, "Feature");
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(
		[...body.querySelectorAll(".overview-group > summary")].map(
			(node) => node.textContent
		)
	).toEqual(
		expect.arrayContaining([
			"Props1",
			"Available Context0",
			"Computed1",
			"Methods1",
		])
	);
	expect(
		body.querySelector('[data-group="Props"] [data-field="props"]')
	).toBeNull();
	const input = body.querySelector<HTMLInputElement>(
		'[aria-label="Value for prop title"]'
	)!;
	input.value = "Edited prop";
	input.form!.dispatchEvent(new Event("submit", { cancelable: true }));
	await vi.waitFor(() => expect(root.props.title).toBe("Edited prop"));
	expect(
		shadow.querySelector('[aria-label="Object overview"]')!.textContent
	).toContain("1 Props");
	expect(
		[...body.querySelectorAll(".overview-member-names")].map(
			(node) => node.textContent
		)
	).toEqual(["title", "None discovered", "double", "rename"]);
	expect(root).not.toHaveProperty("title");
});

test.each([false, true])(
	"props list values and callable props directly with controls=%s",
	async (controls) => {
		type Props = { title: string; save: (title: string) => string };
		let receiver: unknown;
		const save = function (this: Props, title: string) {
			receiver = this;
			this.title = title;
			return this.title;
		};
		Object.defineProperty(save, INSPECTION_SIGNATURES, {
			value: {
				name: "save",
				parameters: [{ name: "title", type: "string", kind: "string" }],
				returnType: "string",
			},
		});
		class Feature extends Store<Props> {
			save() {
				return "Store method";
			}
		}
		const root = mount(createStore(Feature, { title: "Original", save }));
		const inspector = createInspector({ controls });
		inspector.registerRoot("Feature", root);
		cleanups.push(
			() => root[Symbol.dispose](),
			() => inspector.dispose()
		);
		const { body, click } = openPanel(inspector, "Feature");
		await new Promise((resolve) => setTimeout(resolve, 0));
		const props = body.querySelector('[data-group="Props"]')!;
		expect(props.querySelector('[data-field="props"]')).toBeNull();
		expect(props.querySelector('[aria-label="Inspect props"]')).toBeNull();
		expect(props.textContent).not.toContain("Observable");
		expect(props.querySelector('[data-field="title"]')).not.toBeNull();
		expect(props.querySelector('[data-prop-method="save"]')).not.toBeNull();
		expect(props.querySelector("summary")!.textContent).toBe("Props2");
		expect(body.querySelector('[aria-label="2 Props"]')!.textContent).toContain(
			"title · save"
		);
		click("Configure callback prop save");
		const callback = props.querySelector('[data-prop-method="save"]')!;
		const input = callback.querySelector<HTMLInputElement>(
			'[data-parameter="title"]'
		)!;
		expect(input.disabled).toBe(!controls);
		expect(
			callback.querySelector<HTMLButtonElement>(
				'[aria-label="Run callback prop save"]'
			)!.disabled
		).toBe(!controls);
		input.value = "Updated through callback";
		callback
			.querySelector("form")!
			.dispatchEvent(new Event("submit", { cancelable: true }));
		if (controls) {
			await vi.waitFor(() =>
				expect(body.textContent).toContain(
					'Returned: "Updated through callback"'
				)
			);
			expect(root.props.title).toBe("Updated through callback");
			expect(receiver).toBe(root.props);
			expect(
				body.querySelector<HTMLInputElement>(
					'[aria-label="Value for prop title"]'
				)!.value
			).toBe("Updated through callback");
		} else {
			expect(root.props.title).toBe("Original");
			expect(receiver).toBeUndefined();
		}
		expect(
			body.querySelector(
				'[data-group="Methods"] [aria-label="Configure method save"]'
			)
		).not.toBeNull();
	}
);

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

test("finishing a pending call refreshes but never changes the user's new selection", async () => {
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	class Slow extends Store {
		count = 1;
		settings = { theme: "dark" };
		async increment() {
			await wait;
			return ++this.count;
		}
	}
	const root = mount(createStore(Slow));
	const inspector = createInspector({ controls: true });
	inspector.registerRoot("Slow", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const { body, shadow, click } = openPanel(inspector, "Slow");
	await new Promise((resolve) => setTimeout(resolve, 0));
	click("Configure method increment");
	click("Run method increment");
	expect(body.textContent).toContain("Running…");
	click("Select settings");
	expect(
		body.querySelector<HTMLInputElement>('[aria-label="Value for theme"]')!
			.disabled
	).toBe(true);
	release();
	await vi.waitFor(() =>
		expect(
			body.querySelector<HTMLInputElement>('[aria-label="Value for theme"]')!
				.disabled
		).toBe(false)
	);
	expect(root.count).toBe(2);
	expect(shadow.querySelector('[aria-current="page"]')!.textContent).toBe(
		"settings"
	);
	expect(body.textContent).not.toContain("Returned:");
});
