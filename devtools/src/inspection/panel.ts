/// <reference lib="dom" />
import type { Inspector, InspectionValue } from "./runtime";
import {
	isRecord,
	type InspectionRequest,
	type ControlValue,
} from "./protocol";
import type { InspectionParameter } from "./signatures";
import {
	parameterInput,
	readArguments,
	type ParameterInput,
} from "./panel-inputs";
import { panelStyles } from "./panel-styles";
import { createOperationsView } from "./panel-operations";
import { mountPanelLayout, type InspectorPanelOptions } from "./panel-layout";
export type { InspectorPanelOptions } from "./panel-layout";
import { mountStateDiagram } from "./diagram";
import { buildInspectorGraph, type InspectorGraph } from "./graph-data";

type PanelValue = {
	text: string;
	tone?: "muted" | "string" | "number" | "boolean" | "error";
	hint?: string;
};
/** Present protocol values, never their transport metadata or application HTML. */
function describePanelValue(value: InspectionValue): PanelValue {
	if (value === null) return { text: "null", tone: "muted" };
	if (typeof value === "string")
		return { text: JSON.stringify(value), tone: "string" };
	if (typeof value === "number" || typeof value === "boolean")
		return {
			text: String(value),
			tone: typeof value === "number" ? "number" : "boolean",
		};
	if (!isRecord(value)) return { text: "Value unavailable", tone: "muted" };
	const hint = typeof value.detail === "string" ? value.detail : undefined;
	switch (value.kind) {
		case "redacted":
			return { text: "Redacted", tone: "muted", hint: "Hidden before reading" };
		case "uninitialized":
			return { text: "Not initialized", tone: "muted" };
		case "deferred":
			return { text: "Not evaluated", tone: "muted", hint };
		case "error":
			return { text: "Could not evaluate", tone: "error", hint };
		case "unsupported":
			return {
				text:
					hint === "undefined"
						? "undefined"
						: hint === "Map" || hint === "Set"
							? `${hint} · not inspected`
							: "Not inspectable",
				tone: "muted",
				hint,
			};
		case "truncated":
			return typeof value.head === "string"
				? {
						text: JSON.stringify(value.head + "…"),
						tone: "string",
						hint:
							typeof value.length === "number"
								? `Showing ${value.head.length} of ${value.length} characters`
								: "String truncated",
					}
				: { text: "Limit reached", tone: "muted", hint };
		case "reference":
			return { text: "Reference", hint: "Same object shown elsewhere" };
		case "date":
			return {
				text: typeof value.value === "string" ? value.value : "Date",
				tone: "string",
			};
		case "number":
			return { text: hint ?? "Number", tone: "number" };
		case "Store":
		case "Model":
		case "Observable":
			return {
				text:
					typeof value.className === "string" ? value.className : value.kind,
			};
		case "array":
			return { text: "Array" };
		default:
			return { text: "Object" };
	}
}

type Selection = { rootId: string; name: string; path: string[] };
type TreeNode = Selection & { kind: string; id?: string; edge?: string };
type Root = { rootId: string; name: string; kind: string };
type DiagramKind = "Store" | "Model";
const nodeKey = (selection: Selection) =>
	JSON.stringify([selection.rootId, ...selection.path]);
const navigable = (
	value: unknown
): value is Record<string, InspectionValue> & { id: string; kind: string } =>
	isRecord(value) &&
	typeof value.id === "string" &&
	["Store", "Model", "Observable", "array", "object", "reference"].includes(
		typeof value.kind === "string" ? value.kind : ""
	);
function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	text?: string,
	className?: string
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (text !== undefined) node.textContent = text;
	if (className) node.className = className;
	return node;
}
function button(label: string, action: () => void, className?: string) {
	const node = element("button", label, className);
	node.type = "button";
	node.onclick = action;
	return node;
}
function showValue(value: InspectionValue) {
	const description = describePanelValue(value);
	const node = element(
		"span",
		description.text,
		`value-text ${description.tone ?? ""}`
	);
	node.title = description.hint ?? description.text;
	return node;
}

/** Persistent workspace. Tree expansion never directly invokes lazy child getters. */
export function mountInspectorPanel(
	inspector: Inspector,
	target: HTMLElement | InspectorPanelOptions = document.body
) {
	const options: InspectorPanelOptions =
		"nodeType" in target ? { container: target } : target;
	const container = options.container ?? document.body;
	const host = element("div");
	host.setAttribute("data-r-state-tree-inspector", "");
	const shadow = host.attachShadow({ mode: "open" });
	const style = element("style", panelStyles);
	const shell = element("details", undefined, "inspector-shell");
	const heading = element("summary", undefined, "panel-heading");
	heading.append(
		element("span", "RStateTree · live inspector"),
		element("span", "Manual refresh", "mode")
	);
	const section = element("section");
	section.setAttribute("aria-label", "Live state inspector");
	const toolbar = element("div", undefined, "toolbar");
	const workspace = element("div", undefined, "workspace");
	const operationsPane = element("article", undefined, "operations-pane");
	operationsPane.setAttribute("aria-label", "Application operations");
	operationsPane.hidden = true;
	const operationsView = createOperationsView(
		inspector,
		operationsPane,
		report
	);
	const diagramPane = element("div", undefined, "diagram-pane");
	diagramPane.hidden = true;
	const diagramCanvas = element("div", undefined, "diagram-canvas");
	const graphOptions = element("div", undefined, "graph-options");
	const diagramTabs = element("div", undefined, "diagram-tabs");
	diagramTabs.setAttribute("role", "tablist");
	diagramTabs.setAttribute("aria-label", "Diagram trees");
	const surfaces = {
		Store: element("div", undefined, "diagram-surface"),
		Model: element("div", undefined, "diagram-surface"),
	};
	const tabs = {
		Store: button("Stores", () => changeDiagramKind("Store")),
		Model: button("Models", () => changeDiagramKind("Model")),
	};
	for (const kind of ["Store", "Model"] as const) {
		surfaces[kind].id = `${kind.toLowerCase()}-diagram`;
		surfaces[kind].setAttribute("role", "tabpanel");
		surfaces[kind].setAttribute(
			"aria-labelledby",
			`${kind.toLowerCase()}-diagram-tab`
		);
		tabs[kind].id = `${kind.toLowerCase()}-diagram-tab`;
		tabs[kind].setAttribute("role", "tab");
		tabs[kind].setAttribute("aria-controls", surfaces[kind].id);
		tabs[kind].setAttribute("aria-selected", String(kind === "Store"));
		tabs[kind].tabIndex = kind === "Store" ? 0 : -1;
		tabs[kind].onkeydown = (event) => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
				return;
			event.preventDefault();
			const next =
				event.key === "Home"
					? "Store"
					: event.key === "End"
						? "Model"
						: kind === "Store"
							? "Model"
							: "Store";
			changeDiagramKind(next);
			tabs[next].focus();
		};
		diagramTabs.append(tabs[kind]);
	}
	diagramCanvas.append(surfaces.Store);
	const contextToggle = element("input");
	contextToggle.type = "checkbox";
	contextToggle.checked = true;
	contextToggle.setAttribute("aria-label", "Show available Context routes");
	const contextLabel = element("label");
	contextLabel.append(contextToggle, "Context routes");
	const referenceToggle = element("input");
	referenceToggle.type = "checkbox";
	referenceToggle.setAttribute("aria-label", "Show object references");
	const referenceLabel = element("label");
	referenceLabel.append(referenceToggle, "References");
	graphOptions.append(diagramTabs, contextLabel, referenceLabel);
	const graphNote = element(
		"p",
		"Solid branches show ownership. Context routes show availability, not recorded reads.",
		"graph-note"
	);
	diagramPane.append(graphOptions, diagramCanvas, graphNote);
	const treePane = element("aside", undefined, "tree-pane");
	treePane.setAttribute("aria-label", "Registered state trees");
	const tree = element("div", undefined, "tree-group");
	tree.setAttribute("role", "tree");
	tree.setAttribute("aria-label", "Models and Stores");
	treePane.append(element("div", "State trees", "pane-label"), tree);
	const detailsPane = element("article", undefined, "details-pane");
	detailsPane.setAttribute("aria-label", "Selected object");
	const feedback = element("div", undefined, "feedback");
	workspace.append(treePane, diagramPane, detailsPane);
	const outlineMode = button("Outline", () => changeView(false));
	const diagramMode = button("Diagram", () => changeView(true));
	const operationsMode = button("Operations", () => {
		rememberMethods();
		workspace.hidden = true;
		operationsPane.hidden = false;
		outlineMode.setAttribute("aria-pressed", "false");
		diagramMode.setAttribute("aria-pressed", "false");
		operationsMode.setAttribute("aria-pressed", "true");
		renderOperations();
	});
	operationsMode.setAttribute("aria-pressed", "false");
	outlineMode.setAttribute("aria-pressed", "true");
	diagramMode.setAttribute("aria-pressed", "false");
	toolbar.append(
		element("span", "Live state", "toolbar-title"),
		button("Roots", () => select(undefined)),
		button("Up", () => {
			if (selection?.path.length)
				select({ ...selection, path: selection.path.slice(0, -1) });
		}),
		button("Refresh", () => refresh()),
		outlineMode,
		diagramMode,
		operationsMode
	);
	section.append(
		toolbar,
		workspace,
		operationsPane,
		feedback,
		element(
			"p",
			"Enter or leave a field to save · Escape to cancel · Computed and Context reads run app code",
			"hint"
		)
	);
	shell.append(heading, section);
	shadow.append(style, shell);
	container.append(host);

	let selection: Selection | undefined;
	let selectionKind: DiagramKind | undefined;
	let roots: Root[] = [];
	let removed = false;
	let pending = false;
	let pointerActive = false;
	let deferredRefresh = false;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	let treeReads = 0;
	let graph: InspectorGraph | undefined;
	let diagramKind: DiagramKind = "Store";
	let diagramKindChosen = false;
	const graphs: Partial<Record<DiagramKind, InspectorGraph>> = {};
	const lastSelections: Partial<Record<DiagramKind, Selection>> = {};
	let revealGraphSelection = false;
	const graphExpansions = {
		Store: new Map<string, boolean>(),
		Model: new Map<string, boolean>(),
	};
	const groupOpen = new Map<string, boolean>();
	const contextValues = new Map<string, InspectionValue>();
	const createDiagram = (kind: DiagramKind) =>
		mountStateDiagram(surfaces[kind], {
			select(id) {
				const at = graphs[kind]?.addresses.get(id);
				if (at) select(at);
			},
			toggle(id) {
				const node = graphs[kind]?.nodes.find((node) => node.id === id);
				if (!node) return;
				const expansion = graphExpansions[kind];
				expansion.set(id, !node.expanded);
				while (expansion.size > 500)
					expansion.delete(expansion.keys().next().value!);
				renderDiagram();
			},
		});
	const diagrams = {
		Store: createDiagram("Store"),
		Model: createDiagram("Model"),
	};
	contextToggle.onchange = () => renderDiagram();
	referenceToggle.onchange = () => renderDiagram();
	const cache = new Map<string, InspectionValue>();
	const expanded = new Set<string>();
	const detailScrolls = new Map<string, number>();
	// Keep unsubmitted method arguments when refreshing the current object.
	const methodDrafts = new Map<
		string,
		{
			open: boolean;
			values: { value: string; checked: boolean }[];
			extra: number;
		}
	>();

	function report(text = "", error = false) {
		feedback.replaceChildren(document.createTextNode(text));
		if (text) feedback.setAttribute("role", error ? "alert" : "status");
		else feedback.removeAttribute("role");
	}
	function query(at: Selection): InspectionValue {
		const key = nodeKey(at);
		if (!cache.has(key))
			cache.set(
				key,
				inspector.query({
					op: "inspect",
					rootId: at.rootId,
					path: at.path,
					depth: 1,
					maxEntries: 500,
				})
			);
		return cache.get(key)!;
	}
	function queryStructure(at: Selection): InspectionValue {
		const key = "diagram:" + nodeKey(at);
		if (!cache.has(key))
			cache.set(
				key,
				inspector.query({
					op: "inspect",
					rootId: at.rootId,
					path: at.path,
					depth: 1,
					maxEntries: 500,
					evaluateComputeds: false,
				})
			);
		return cache.get(key)!;
	}
	function rememberMethods() {
		if (selection)
			for (const group of detailsPane.querySelectorAll<HTMLDetailsElement>(
				".overview-group"
			))
				groupOpen.set(
					nodeKey(selection) + ":" + group.dataset.group,
					group.open
				);
		while (groupOpen.size > 300)
			groupOpen.delete(groupOpen.keys().next().value!);
		for (const method of detailsPane.querySelectorAll<HTMLDetailsElement>(
			".method"
		)) {
			const form = method.querySelector("form")!;
			methodDrafts.set(method.dataset.key!, {
				open: method.open,
				values: [
					...form.querySelectorAll<
						HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
					>("input,textarea,select"),
				].map((input) => ({
					value: input.value,
					checked: input instanceof HTMLInputElement && input.checked,
				})),
				extra: Number(form.dataset.extra ?? 0),
			});
		}
		// This is UI state, not a second registry retaining application objects.
		while (methodDrafts.size > 100)
			methodDrafts.delete(methodDrafts.keys().next().value!);
	}
	function select(next: Selection | undefined) {
		rememberMethods();
		if (selection) {
			const rootId = selection.rootId;
			const rootKind = roots.find((root) => root.rootId === rootId)?.kind;
			if (
				(rootKind === "Store" || rootKind === "Model") &&
				selectionKind === rootKind
			)
				lastSelections[rootKind] = selection;
		}
		if (selection) detailScrolls.set(nodeKey(selection), detailsPane.scrollTop);
		while (detailScrolls.size > 100)
			detailScrolls.delete(detailScrolls.keys().next().value!);
		const previousSelection = selection;
		const previousKind = selectionKind;
		selection = next;
		selectionKind = undefined;
		revealGraphSelection = true;
		if (next) {
			for (let i = 0; i <= next.path.length; i++)
				expanded.add(nodeKey({ ...next, path: next.path.slice(0, i) }));
		}
		report();
		renderDetails(next ? (detailScrolls.get(nodeKey(next)) ?? 0) : 0);
		if (next) {
			for (let i = next.path.length; i >= 0; i--) {
				const key = nodeKey({ ...next, path: next.path.slice(0, i) });
				const value = cache.get(key) ?? cache.get("diagram:" + key);
				if (
					isRecord(value) &&
					(value.kind === "Store" || value.kind === "Model")
				) {
					selectionKind = value.kind;
					break;
				}
			}
			if (
				!selectionKind &&
				previousSelection?.rootId === next.rootId &&
				previousSelection.path.length < next.path.length &&
				previousSelection.path.every((part, i) => next.path[i] === part)
			)
				selectionKind = previousKind;
			const kind =
				selectionKind ??
				roots.find((root) => root.rootId === next.rootId)?.kind;
			if (kind === "Store" || kind === "Model") {
				selectionKind = kind;
				activateDiagram(kind);
			}
		}
		renderTree();
	}
	function renderOperations() {
		if (!removed) operationsView.render();
	}
	function refresh() {
		if (!operationsPane.hidden) {
			renderOperations();
			return;
		}
		rememberMethods();
		cache.clear();
		contextValues.clear();
		try {
			const result = inspector.query({ op: "roots" });
			roots =
				isRecord(result) && Array.isArray(result.roots)
					? result.roots.filter(
							(root): root is Root =>
								isRecord(root) &&
								typeof root.rootId === "string" &&
								typeof root.name === "string" &&
								typeof root.kind === "string"
						)
					: [];
			if (
				!selection &&
				!diagramKindChosen &&
				!roots.some((root) => root.kind === diagramKind)
			) {
				const kind = roots[0]?.kind;
				if (kind === "Store" || kind === "Model") activateDiagram(kind);
			}
			const available = new Set(roots.map((root) => root.rootId));
			for (const key of expanded)
				if (!available.has(JSON.parse(key)[0])) expanded.delete(key);
			report();
			renderDetails();
			renderTree();
		} catch {
			report(
				"Could not inspect this selection. Return to Roots and refresh. Error details are hidden.",
				true
			);
		}
	}
	function renderTree() {
		if (!diagramPane.hidden) {
			renderDiagram();
			return;
		}
		const scroll = treePane.scrollTop;
		const focused = shadow.activeElement?.getAttribute("data-tree-key");
		tree.replaceChildren();
		treeReads = 0;
		let treeLimited = false;
		let count = 0;
		const append = (
			node: TreeNode,
			parent: HTMLElement,
			depth: number,
			ancestors: Set<string>
		) => {
			if (++count > 250) return;
			const key = nodeKey(node);
			const cycle = !!node.id && ancestors.has(node.id);
			let value = cache.get(key) ?? cache.get("diagram:" + key);
			if (!cycle && node.path.length < 16 && value === undefined) {
				if (treeReads >= 40) treeLimited = true;
				else {
					try {
						treeReads++;
						value = queryStructure(node);
					} catch {
						/* The node remains selectable; unknown shape is not an expand action. */
					}
				}
			}
			const childFields =
				isRecord(value) && Array.isArray(value.fields)
					? (value.fields as unknown[]).filter(isRecord)
					: [];
			const expandable =
				!cycle &&
				node.path.length < 16 &&
				childFields.some(
					(field) =>
						navigable(field.value) ||
						(isRecord(field.value) && field.value.kind === "uninitialized")
				);
			const isOpen = expanded.has(key) && expandable;
			const branch = element("div");
			branch.setAttribute("role", "treeitem");
			branch.setAttribute("aria-level", String(depth + 1));
			branch.setAttribute("aria-label", node.name);
			branch.setAttribute(
				"aria-selected",
				String(!!selection && nodeKey(selection) === key)
			);
			if (expandable) branch.setAttribute("aria-expanded", String(isOpen));
			const item = element("div", undefined, "tree-node");
			item.setAttribute("aria-selected", branch.getAttribute("aria-selected")!);
			branch.append(item);
			item.style.paddingLeft = `${Math.min(depth, 10) * 12 + 4}px`;
			const toggle = button(
				isOpen ? "▾" : "▸",
				() => {
					if (isOpen) expanded.delete(key);
					else expanded.add(key);
					renderTree();
				},
				"tree-toggle"
			);
			toggle.setAttribute(
				"aria-label",
				`${isOpen ? "Collapse" : "Expand"} ${node.name}`
			);
			toggle.setAttribute("data-tree-key", key + ":toggle");
			toggle.tabIndex = -1;
			item.append(
				expandable ? toggle : element("span", undefined, "tree-spacer")
			);
			const choice = button("", () => select(node), "tree-choice");
			choice.setAttribute(
				"aria-label",
				node.path.length ? `Select ${node.name}` : node.name
			);
			choice.setAttribute("data-tree-key", key);
			choice.title = node.name;
			choice.tabIndex = -1;
			choice.onfocus = () => {
				for (const other of tree.querySelectorAll<HTMLButtonElement>(
					".tree-choice"
				))
					other.tabIndex = -1;
				choice.tabIndex = 0;
			};
			choice.append(element("span", node.name, "tree-name"));
			if (node.edge === "reference" || cycle)
				choice.append(element("span", "↗", "tree-reference"));
			choice.append(element("span", node.kind, "tree-kind"));
			item.append(choice);
			item.onkeydown = (event) => {
				if (event.key === "ArrowRight" && expandable && !isOpen) {
					event.preventDefault();
					expanded.add(key);
					renderTree();
				} else if (event.key === "ArrowLeft") {
					event.preventDefault();
					if (isOpen) {
						expanded.delete(key);
						renderTree();
					} else if (node.path.length)
						select({ ...node, path: node.path.slice(0, -1) });
				} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					const choices = [
						...tree.querySelectorAll<HTMLButtonElement>(".tree-choice"),
					];
					const index = choices.indexOf(choice);
					choices[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
				}
			};
			parent.append(branch);
			if (!isOpen) return;
			const group = element("div", undefined, "tree-group");
			group.setAttribute("role", "group");
			branch.append(group);
			if (isRecord(value)) {
				const nextAncestors = new Set(ancestors);
				if (typeof value.id === "string") nextAncestors.add(value.id);
				for (const field of childFields) {
					if (typeof field.name !== "string") continue;
					if (navigable(field.value)) {
						append(
							{
								rootId: node.rootId,
								name: field.name,
								path: node.path.concat(field.name),
								kind:
									field.name === "props" && value.kind === "Store"
										? ""
										: typeof field.value.className === "string"
											? field.value.className
											: field.value.kind,
								id: field.value.id,
								edge: typeof field.edge === "string" ? field.edge : undefined,
							},
							group,
							depth + 1,
							nextAncestors
						);
					} else if (
						isRecord(field.value) &&
						field.value.kind === "uninitialized"
					) {
						const leaf = element(
							"div",
							`${field.name} · not initialized`,
							"tree-empty"
						);
						leaf.style.paddingLeft = `${Math.min(depth + 1, 10) * 12 + 28}px`;
						group.append(leaf);
					}
				}
				if (value.truncated)
					group.append(
						element(
							"div",
							"More fields available; use MCP for bounded queries.",
							"tree-empty"
						)
					);
			}
		};
		for (const root of roots) append({ ...root, path: [] }, tree, 0, new Set());
		if (!roots.length)
			tree.append(element("p", "No registered roots", "tree-empty"));
		if (count > 250 || treeLimited)
			tree.append(
				element(
					"p",
					"Tree limit reached. Collapse branches to explore more.",
					"tree-empty"
				)
			);
		const choices = [
			...tree.querySelectorAll<HTMLButtonElement>(".tree-choice"),
		];
		const active =
			choices.find(
				(choice) =>
					selection &&
					choice.getAttribute("data-tree-key") === nodeKey(selection)
			) ?? choices[0];
		if (active) active.tabIndex = 0;
		treePane.scrollTop = scroll;
		if (focused)
			[...tree.querySelectorAll<HTMLButtonElement>("[data-tree-key]")]
				.find((node) => node.getAttribute("data-tree-key") === focused)
				?.focus({ preventScroll: true });
		renderDiagram();
	}
	function changeView(showDiagram: boolean) {
		workspace.hidden = false;
		operationsPane.hidden = true;
		operationsMode.setAttribute("aria-pressed", "false");
		workspace.classList.toggle("diagram-mode", showDiagram);
		diagramPane.hidden = !showDiagram;
		outlineMode.setAttribute("aria-pressed", String(!showDiagram));
		diagramMode.setAttribute("aria-pressed", String(showDiagram));
		if (showDiagram) {
			revealGraphSelection = true;
			renderDiagram();
		} else renderTree();
	}
	function activateDiagram(kind: DiagramKind) {
		diagramKind = kind;
		graph = graphs[kind];
		if (diagramCanvas.firstElementChild !== surfaces[kind])
			diagramCanvas.replaceChildren(surfaces[kind]);
		for (const key of ["Store", "Model"] as const) {
			tabs[key].setAttribute("aria-selected", String(key === kind));
			tabs[key].tabIndex = key === kind ? 0 : -1;
		}
		contextLabel.hidden = kind !== "Store";
	}
	function changeDiagramKind(kind: DiagramKind) {
		diagramKindChosen = true;
		if (kind === diagramKind) return;
		activateDiagram(kind);
		const previous = lastSelections[kind];
		const root = roots.find((root) => root.kind === kind);
		select(
			previous &&
				roots.some(
					(root) => root.rootId === previous.rootId && root.kind === kind
				)
				? previous
				: root
					? { ...root, path: [] }
					: undefined
		);
	}
	function renderDiagram() {
		if (diagramPane.hidden || removed) return;
		const graphExpansion = graphExpansions[diagramKind];
		if (revealGraphSelection && selection) {
			for (let i = 0; i < selection.path.length; i++) {
				const value = cache.get(
					nodeKey({ ...selection, path: selection.path.slice(0, i) })
				);
				if (isRecord(value) && typeof value.id === "string")
					graphExpansion.set(value.id, true);
			}
		}
		revealGraphSelection = false;
		while (graphExpansion.size > 500)
			graphExpansion.delete(graphExpansion.keys().next().value!);
		const diagramRoots = roots.filter((root) => root.kind === diagramKind);
		graph = buildInspectorGraph(
			diagramRoots,
			queryStructure,
			graphExpansion,
			selection,
			referenceToggle.checked,
			diagramKind === "Store" && contextToggle.checked,
			selection ? cache.get(nodeKey(selection)) : undefined
		);
		graphs[diagramKind] = graph;
		diagrams[diagramKind].update(graph);
		graphNote.textContent = !diagramRoots.length
			? `No registered ${diagramKind} roots.`
			: graph.limited
				? "Diagram limit reached. Collapse branches to explore more."
				: diagramKind === "Store"
					? "Store ownership. Context routes show availability, not recorded reads."
					: "Model ownership. References stay within this diagram.";
	}

	function repaint() {
		if (removed) return;
		rememberMethods();
		const scroll = detailsPane.scrollTop;
		const active = shadow.activeElement;
		const focused = active?.getAttribute("aria-label");
		const range =
			active instanceof HTMLInputElement ||
			active instanceof HTMLTextAreaElement
				? ([active.selectionStart, active.selectionEnd] as const)
				: undefined;
		renderDetails();
		renderTree();
		detailsPane.scrollTop = scroll;
		if (focused) {
			const input = [
				...detailsPane.querySelectorAll<HTMLElement>("[aria-label]"),
			].find((node) => node.getAttribute("aria-label") === focused);
			input?.focus({ preventScroll: true });
			if (
				(input instanceof HTMLInputElement ||
					input instanceof HTMLTextAreaElement) &&
				range?.[0] !== null &&
				range?.[0] !== undefined
			)
				input.setSelectionRange(range[0], range[1]);
		}
	}
	const pointerStarted = () => {
		pointerActive = true;
	};
	const interactionFinished = () => {
		pointerActive = false;
		if (!deferredRefresh) return;
		clearTimeout(refreshTimer);
		// The blur save is synchronous, but its repaint must happen AFTER the
		// originating click/default action. Otherwise we remove its target.
		refreshTimer = setTimeout(() => {
			deferredRefresh = false;
			if (!pending) repaint();
		}, 0);
	};
	window.addEventListener("pointerdown", pointerStarted, true);
	window.addEventListener("click", interactionFinished, true);
	window.addEventListener("pointercancel", interactionFinished, true);
	window.addEventListener("keydown", interactionFinished, true);
	window.addEventListener("blur", interactionFinished);

	async function run(
		request: InspectionRequest,
		success: string,
		method = false
	) {
		if (pending || removed) return;
		if (request.op === "set") {
			let result: InspectionValue;
			try {
				result = inspector.query(request);
			} catch {
				result = {
					ok: false,
					error:
						"Field write failed; state may have changed. Error details are hidden.",
				};
			}
			cache.clear();
			if (pointerActive) deferredRefresh = true;
			else repaint();
			if (isRecord(result) && result.ok === true) report(success);
			else
				report(
					isRecord(result) && typeof result.error === "string"
						? result.error
						: "Field write failed; state may have changed.",
					true
				);
			return;
		}
		const at = selection && nodeKey(selection);
		rememberMethods();
		pending = true;
		const disabled = [
			...detailsPane.querySelectorAll<
				| HTMLInputElement
				| HTMLTextAreaElement
				| HTMLSelectElement
				| HTMLButtonElement
			>("input,textarea,select,button"),
		].filter((input) => !input.disabled);
		for (const input of disabled) input.disabled = true;
		report("Running…");
		let result: InspectionValue;
		try {
			result = await inspector.query(request);
		} catch {
			result = {
				ok: false,
				error:
					"Control failed. Check permissions and selection; state may have changed. Error details are hidden.",
			};
		}
		pending = false;
		if (removed) return;
		for (const input of disabled) input.disabled = false;
		cache.clear();
		repaint();
		if (!selection || nodeKey(selection) !== at) {
			report();
			return;
		}
		if (!isRecord(result) || result.ok !== true)
			report(
				isRecord(result) && typeof result.error === "string"
					? result.error
					: "Control failed; state may have changed.",
				true
			);
		else if (method) {
			feedback.replaceChildren(
				document.createTextNode("Returned: "),
				showValue(result.result as InspectionValue)
			);
			feedback.setAttribute("role", "status");
		} else report(success);
	}
	function inlineField(
		cell: HTMLElement,
		name: string,
		value: null | string | number | boolean,
		at: Selection,
		prop = false
	) {
		const form = element("form", undefined, "inline-field");
		const input = element(
			"input",
			undefined,
			`inline-input ${value === null ? "muted" : typeof value}`
		);
		input.setAttribute("aria-label", `Value for ${prop ? "prop " : ""}${name}`);
		if (typeof value === "boolean") {
			input.type = "checkbox";
			input.checked = value;
		} else {
			input.type = "text";
			input.value = value === null ? "null" : String(value);
			if (typeof value === "number") input.inputMode = "decimal";
		}
		input.title = "Enter or leave the field to save; Escape to cancel";
		input.disabled = pending;
		const original = input.value;
		const error = element("p", undefined, "field-error");
		const reset = () => {
			input.value = original;
			if (typeof value === "boolean") input.checked = value;
			error.textContent = "";
		};
		const submit = () => {
			if (pending) return;
			let next: ControlValue;
			if (typeof value === "boolean") next = input.checked;
			else if (typeof value === "number") {
				if (!input.value.trim() || !Number.isFinite(Number(input.value))) {
					error.textContent = "Enter a finite number.";
					return;
				}
				next = Number(input.value);
			} else if (value === null) {
				try {
					next = JSON.parse(input.value);
				} catch {
					error.textContent = "Enter a JSON value.";
					return;
				}
			} else next = input.value;
			if (next === value) {
				error.textContent = "";
				return;
			}
			void run(
				{
					op: "set",
					rootId: at.rootId,
					path: [...at.path],
					field: name,
					value: next,
				},
				`Saved ${name}.`
			);
		};
		form.onsubmit = (event) => {
			event.preventDefault();
			submit();
		};
		input.onkeydown = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				reset();
				input.blur();
			}
		};
		if (typeof value === "boolean") input.onchange = submit;
		else input.onblur = submit;
		form.append(input, error);
		cell.append(form);
	}
	function methodForm(
		method: Record<string, unknown>,
		at: Selection,
		controllable = true,
		prop = false
	) {
		const name = String(method.name);
		const key = nodeKey(at) + ":" + name;
		const saved = methodDrafts.get(key);
		const wrapper = element(
			"details",
			undefined,
			prop ? "method prop-method" : "method"
		);
		wrapper.setAttribute("data-method", name);
		if (prop) wrapper.setAttribute("data-prop-method", name);
		const actionName = prop ? "callback prop" : "method";
		wrapper.dataset.key = key;
		const metadata = Array.isArray(method.parameters)
			? (method.parameters as InspectionParameter[])
			: undefined;
		const parameters: InspectionParameter[] = metadata ? [...metadata] : [];
		const signature = metadata
			? metadata
					.map(
						(parameter) =>
							`${parameter.rest ? "..." : ""}${parameter.name}${parameter.optional ? "?" : ""}: ${parameter.type}`
					)
					.join(", ")
			: "parameters unavailable";
		const summary = element(
			"summary",
			`${name}(${signature})${typeof method.returnType === "string" ? ` → ${method.returnType}` : ""}`
		);
		summary.setAttribute("aria-label", `Configure ${actionName} ${name}`);
		const form = element("form", undefined, "method-form");
		const inputs: ParameterInput[] = [];
		const appendInput = (parameter: InspectionParameter) => {
			const input = parameterInput(parameter);
			inputs.push(input);
			form.insertBefore(input.container, actions);
		};
		const actions = element("div", undefined, "method-actions");
		const submit = button("Run", () => {});
		submit.type = "submit";
		submit.setAttribute("aria-label", `Run ${actionName} ${name}`);
		actions.append(submit);
		if (!metadata) {
			form.append(
				element(
					"p",
					"Signature unavailable. Add individual JSON arguments if needed.",
					"parameter-help"
				)
			);
			actions.append(
				button("+ Argument", () => {
					if (parameters.length >= 32) return;
					const parameter: InspectionParameter = {
						name: `argument ${parameters.length + 1}`,
						type: "unknown · JSON",
						kind: "unknown",
					};
					parameters.push(parameter);
					appendInput(parameter);
					form.dataset.extra = String(parameters.length);
				}),
				button("− Argument", () => {
					inputs.pop()?.container.remove();
					parameters.pop();
					form.dataset.extra = String(parameters.length);
				})
			);
		}
		form.append(actions);
		for (const parameter of parameters) appendInput(parameter);
		if (!metadata && saved) {
			for (let i = 0; i < saved.extra; i++) {
				const parameter: InspectionParameter = {
					name: `argument ${i + 1}`,
					type: "unknown · JSON",
					kind: "unknown",
				};
				parameters.push(parameter);
				appendInput(parameter);
			}
			form.dataset.extra = String(saved.extra);
		}
		if (saved) {
			wrapper.open = saved.open;
			[
				...form.querySelectorAll<
					HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
				>("input,textarea,select"),
			].forEach((input, index) => {
				if (!saved.values[index]) return;
				input.value = saved.values[index].value;
				if (input instanceof HTMLInputElement)
					input.checked = saved.values[index].checked;
			});
			for (const toggle of form.querySelectorAll<HTMLInputElement>(
				".optional-parameter input"
			))
				toggle.dispatchEvent(new Event("change"));
		}
		if (pending || !controllable)
			for (const input of form.querySelectorAll<
				| HTMLInputElement
				| HTMLTextAreaElement
				| HTMLSelectElement
				| HTMLButtonElement
			>("input,textarea,select,button"))
				input.disabled = true;
		form.onsubmit = (event) => {
			event.preventDefault();
			if (pending || !controllable) return;
			try {
				const args = readArguments(parameters, inputs);
				void run(
					{
						op: "call",
						rootId: at.rootId,
						path: [...at.path],
						method: name,
						args,
					},
					"",
					true
				);
			} catch (error) {
				report(
					error instanceof Error
						? error.message
						: "Check the method arguments.",
					true
				);
			}
		};
		wrapper.append(summary, form);
		return wrapper;
	}
	function fieldRow(field: unknown, at: Selection, prop = false) {
		if (!isRecord(field) || typeof field.name !== "string") return undefined;
		const name = field.name;
		const row = element("div", undefined, "row");
		row.setAttribute("data-field", name);
		const label = element("div");
		label.append(element("div", name, "field-name"));
		const metadata =
			field.edge === "ownership"
				? "Child"
				: field.edge === "reference"
					? "Reference"
					: field.type === "computed"
						? "Computed"
						: field.type !== "value" && typeof field.type === "string"
							? field.type
							: field.value === null
								? "null"
								: ["string", "boolean", "number"].includes(typeof field.value)
									? typeof field.value
									: "";
		if (metadata) label.append(element("div", metadata, "field-meta"));
		const cell = element("div", undefined, "field-value");
		const child = field.value as InspectionValue;
		if (navigable(child)) {
			const open = button(
				"",
				() => select({ ...at, path: at.path.concat(name) }),
				"object-link"
			);
			open.setAttribute("aria-label", `Inspect ${name}`);
			open.append(showValue(child), element("span", "›", "arrow"));
			cell.append(open);
		} else if (
			field.writable === true &&
			(child === null || ["string", "boolean", "number"].includes(typeof child))
		) {
			inlineField(
				cell,
				name,
				child as null | string | number | boolean,
				at,
				prop
			);
		} else cell.append(showValue(child));
		if (isRecord(child) && child.kind === "uninitialized") {
			const initialize = button(
				"Initialize",
				() => {
					try {
						const result = inspector.query({
							op: "initialize",
							rootId: at.rootId,
							path: [...at.path],
							field: name,
						});
						cache.clear();
						renderDetails();
						renderTree();
						if (
							isRecord(result) &&
							Array.isArray(result.errors) &&
							result.errors.length
						)
							report(
								`Could not initialize ${name}. Error details are hidden.`,
								true
							);
					} catch {
						report(
							`Could not initialize ${name}. Error details are hidden.`,
							true
						);
					}
				},
				"initialize"
			);
			initialize.disabled = pending;
			initialize.setAttribute("aria-label", `Initialize child ${name}`);
			initialize.title = "Creates this child using its normal lifecycle";
			cell.append(initialize);
		}
		row.append(label, cell);
		return row;
	}
	function overviewGroup(name: string, count: number, at: Selection) {
		const group = element("details", undefined, "overview-group");
		group.dataset.group = name;
		group.open = groupOpen.get(nodeKey(at) + ":" + name) ?? true;
		const summary = element("summary", undefined, "overview-heading");
		summary.append(
			element("span", name),
			element("span", String(count), "group-count")
		);
		group.append(summary);
		detailsPane.append(group);
		return group;
	}
	function resultTree(
		value: InspectionValue,
		remaining = { count: 40 }
	): HTMLElement {
		if (--remaining.count < 0) return element("span", "…", "muted");
		if (!isRecord(value) || !Array.isArray(value.fields))
			return showValue(value);
		const tree = element("details", undefined, "context-result");
		tree.open = true;
		tree.append(
			element("summary", describePanelValue(value as InspectionValue).text)
		);
		for (const field of value.fields) {
			if (remaining.count < 0) break;
			if (!isRecord(field) || typeof field.name !== "string") continue;
			const row = element("div", undefined, "result-row");
			row.append(
				element("span", field.name, "field-name"),
				resultTree(field.value as InspectionValue, remaining)
			);
			tree.append(row);
		}
		return tree;
	}
	function contextRow(context: Record<string, unknown>, at: Selection) {
		const name = typeof context.name === "string" ? context.name : "Context";
		const row = element("div", undefined, "context-row");
		row.setAttribute("data-context", name);
		row.append(element("div", name, "field-name"));
		if (typeof context.type === "string")
			row.append(element("div", context.type, "field-meta"));
		const status =
			context.status === "provided"
				? "Provided here"
				: context.status === "inherited"
					? `Inherited from ${typeof context.providerClass === "string" ? context.providerClass : "an ancestor"}`
					: context.status === "default"
						? "Default value"
						: context.status === "redacted"
							? "Redacted"
							: "No provider or default";
		const origin = element("div", undefined, "context-origin");
		origin.append(element("span", status));
		let source =
			typeof context.providerId === "string"
				? graph?.addresses.get(context.providerId)
				: undefined;
		if (!source && typeof context.providerId === "string") {
			const root = roots.find((root) => root.rootId === context.providerId);
			if (root) source = { ...root, path: [] };
			for (let i = 0; !source && i <= at.path.length; i++) {
				const candidate = { ...at, path: at.path.slice(0, i) };
				const value = cache.get(nodeKey(candidate));
				if (isRecord(value) && value.id === context.providerId)
					source = candidate;
			}
		}
		if (source && context.status === "inherited")
			origin.append(button("Show provider", () => select(source)));
		row.append(origin);
		if (context.declared === true)
			row.append(
				element("div", "Declared use · not a recorded read", "field-meta")
			);
		if (
			typeof context.contextId === "string" &&
			!["redacted", "unavailable"].includes(
				typeof context.status === "string" ? context.status : "unavailable"
			)
		) {
			const contextId = context.contextId;
			const key = nodeKey(at) + ":context:" + contextId;
			const read = button("Read value", () => {
				if (pending) return;
				try {
					const result = inspector.query({
						op: "context",
						rootId: at.rootId,
						path: [...at.path],
						contextId,
						depth: 2,
						maxEntries: 80,
					});
					if (!isRecord(result) || result.ok !== true) {
						report(
							"Could not read Context. Error details are hidden; app state may have changed.",
							true
						);
						return;
					}
					contextValues.set(key, result.result as InspectionValue);
					while (contextValues.size > 10)
						contextValues.delete(contextValues.keys().next().value!);
					cache.clear();
					repaint();
					report(`Read ${name}. Context providers run app code.`);
				} catch {
					report(
						"Could not read Context. Error details are hidden; app state may have changed.",
						true
					);
				}
			});
			read.setAttribute("aria-label", `Read Context ${name}`);
			read.title =
				"Evaluates this Context's provider; application code may have side effects";
			read.disabled = pending;
			row.append(read);
			if (contextValues.has(key))
				row.append(resultTree(contextValues.get(key)!));
		}
		return row;
	}
	function renderOverview(selected: Record<string, unknown>, at: Selection) {
		const fields = (selected.fields as unknown[]).filter(isRecord);
		const props = fields.find(
			(field) => field.name === "props" && selected.kind === "Store"
		);
		let propFields: Record<string, unknown>[] = [];
		let propMethods: Record<string, unknown>[] = [];
		let propsTruncated = false;
		let propsUnavailable = false;
		if (props && navigable(props.value) && at.path.length < 16) {
			try {
				const value = query({ ...at, path: at.path.concat("props") });
				propsUnavailable = !isRecord(value) || !Array.isArray(value.fields);
				if (isRecord(value)) {
					if (Array.isArray(value.fields))
						propFields = (value.fields as unknown[]).filter(isRecord);
					if (Array.isArray(value.methods))
						propMethods = (value.methods as unknown[]).filter(isRecord);
					propsTruncated = value.truncated === true;
				}
			} catch {
				propsUnavailable = true;
			}
		}
		const computeds = fields.filter((field) => field.type === "computed");
		const contexts = Array.isArray(selected.contexts)
			? selected.contexts.filter(isRecord)
			: [];
		const methods = Array.isArray(selected.methods)
			? selected.methods.filter(isRecord)
			: [];
		const overview = element("nav", undefined, "overview-counts");
		overview.setAttribute("aria-label", "Object overview");
		for (const [name, count] of [
			["Props", propFields.length + propMethods.length],
			["Context", contexts.length],
			["Computed", computeds.length],
			["Methods", methods.length],
		] as const) {
			if ((name === "Context" || name === "Props") && selected.kind !== "Store")
				continue;
			const members =
				name === "Props"
					? [...propFields, ...propMethods]
					: name === "Context"
						? contexts
						: name === "Computed"
							? computeds
							: methods;
			const names = members.flatMap((member) =>
				typeof member.name === "string" ? [member.name] : []
			);
			const badge = button(`${count} ${name}`, () => {
				const group = [
					...detailsPane.querySelectorAll<HTMLDetailsElement>(
						".overview-group"
					),
				].find(
					(group) =>
						group.dataset.group ===
						(name === "Context" ? "Available Context" : name)
				);
				if (group) {
					group.open = true;
					group.scrollIntoView?.({ block: "nearest" });
				}
			});
			badge.setAttribute("aria-label", `${count} ${name}`);
			badge.title = names.join(", ") || "None discovered";
			badge.append(
				element(
					"span",
					names.join(" · ") || "None discovered",
					"overview-member-names"
				)
			);
			overview.append(badge);
		}
		detailsPane.append(overview);
		if (props) {
			const group = overviewGroup(
				"Props",
				propFields.length + propMethods.length,
				at
			);
			for (const field of propFields) {
				const row = fieldRow(
					field,
					{ ...at, path: at.path.concat("props") },
					true
				);
				if (row) {
					row.classList.add("prop-row");
					group.append(row);
				}
			}
			for (const method of propMethods)
				if (typeof method.name === "string")
					group.append(
						methodForm(
							method,
							{ ...at, path: at.path.concat("props") },
							selected.controls === true,
							true
						)
					);
			if (!navigable(props.value))
				group.append(showValue(props.value as InspectionValue));
			else if (propsUnavailable || at.path.length >= 16)
				group.append(
					element("p", "Props unavailable at this path.", "overview-empty")
				);
			else if (!propFields.length && !propMethods.length && !propsTruncated)
				group.append(element("p", "No visible props", "overview-empty"));
			if (propsTruncated)
				group.append(
					element(
						"p",
						"More props available. Inspect a smaller subtree or use MCP bounds.",
						"overview-empty"
					)
				);
		}
		if (selected.kind === "Store") {
			const group = overviewGroup("Available Context", contexts.length, at);
			for (const context of contexts) group.append(contextRow(context, at));
			if (!contexts.length)
				group.append(
					element(
						"p",
						"No discoverable Context. Context names need development metadata.",
						"overview-empty"
					)
				);
		}
		for (const [name, members] of [
			[
				"State",
				fields.filter(
					(field) =>
						field !== props &&
						field.type !== "computed" &&
						field.edge !== "ownership"
				),
			],
			["Computed", computeds],
			["Children", fields.filter((field) => field.edge === "ownership")],
		] as const) {
			if (!members.length) continue;
			const group = overviewGroup(name, members.length, at);
			for (const member of members) {
				const row = fieldRow(member, at);
				if (row) group.append(row);
			}
		}
		const group = overviewGroup("Methods", methods.length, at);
		group.classList.add("methods-group");
		group.querySelector("summary")!.classList.add("methods-title");
		if (!methods.length)
			group.append(element("p", "No discoverable methods", "overview-empty"));
		if (methods.length && selected.controls !== true)
			group.append(
				element(
					"p",
					"Read-only · enable controls to invoke methods",
					"overview-empty"
				)
			);
		for (const method of methods)
			if (typeof method.name === "string")
				group.append(methodForm(method, at, selected.controls === true));
	}
	function renderDetails(scroll = detailsPane.scrollTop) {
		detailsPane.replaceChildren();
		const up = toolbar.querySelectorAll("button")[1];
		up.disabled = !selection?.path.length;
		if (!selection) {
			detailsPane.append(
				element(
					"p",
					!diagramPane.hidden
						? roots.some((root) => root.kind === diagramKind)
							? `Select a ${diagramKind} in this diagram.`
							: `No registered ${diagramKind} roots.`
						: roots.length
							? "Select a Model or Store in the tree."
							: "No registered roots",
					"message"
				)
			);
			return;
		}
		const at = selection;
		const root = roots.find((root) => root.rootId === at.rootId);
		const breadcrumbs = element("nav", undefined, "breadcrumbs");
		breadcrumbs.setAttribute("aria-label", "Selected path");
		[root?.name ?? at.name, ...at.path].forEach((name, index) => {
			if (index) breadcrumbs.append(element("span", "›", "separator"));
			const crumb = button(name, () =>
				select({ ...at, path: at.path.slice(0, index) })
			);
			crumb.setAttribute("aria-label", `Go to ${name}`);
			if (index === at.path.length) crumb.setAttribute("aria-current", "page");
			breadcrumbs.append(crumb);
		});
		detailsPane.append(breadcrumbs);
		try {
			const selected = query(at);
			if (!isRecord(selected) || !Array.isArray(selected.fields)) {
				detailsPane.append(showValue(selected));
				if (isRecord(selected) && typeof selected.status === "string")
					detailsPane.append(element("p", selected.status, "node-meta"));
				return;
			}
			detailsPane.append(
				element(
					"p",
					describePanelValue(selected as InspectionValue).text +
						(typeof selected.status === "string"
							? ` · ${selected.status}`
							: ""),
					"node-meta"
				)
			);
			if (selected.controls === true)
				detailsPane.append(
					element(
						"p",
						"Controls enabled · writes and calls may reach real services.",
						"controls-warning"
					)
				);
			renderOverview(selected, at);
			if (!selected.fields.length)
				detailsPane.append(element("p", "No inspectable fields", "message"));
			if (selected.truncated)
				detailsPane.append(
					element(
						"p",
						"More fields available. Inspect a smaller subtree or use MCP bounds.",
						"message"
					)
				);
		} catch {
			detailsPane.append(
				element(
					"p",
					"Selection unavailable. Select its parent or refresh.",
					"message"
				)
			);
			report(
				"Could not inspect this selection. Return to Roots and refresh. Error details are hidden.",
				true
			);
		}
		detailsPane.scrollTop = scroll;
	}
	shell.addEventListener("toggle", () => {
		if (shell.open && !removed) refresh();
	});
	const removeLayout = mountPanelLayout({
		host,
		shadow,
		shell,
		heading,
		toolbar,
		container,
		options,
	});
	return () => {
		removed = true;
		removeLayout();
		operationsView.dispose();
		clearTimeout(refreshTimer);
		window.removeEventListener("pointerdown", pointerStarted, true);
		window.removeEventListener("click", interactionFinished, true);
		window.removeEventListener("pointercancel", interactionFinished, true);
		window.removeEventListener("keydown", interactionFinished, true);
		window.removeEventListener("blur", interactionFinished);
		cache.clear();
		expanded.clear();
		methodDrafts.clear();
		detailScrolls.clear();
		graphExpansions.Store.clear();
		graphExpansions.Model.clear();
		groupOpen.clear();
		contextValues.clear();
		diagrams.Store.dispose();
		diagrams.Model.dispose();
		delete graphs.Store;
		delete graphs.Model;
		delete lastSelections.Store;
		delete lastSelections.Model;
		graph = undefined;
		host.remove();
	};
}
