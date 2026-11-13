/// <reference lib="dom" />
import { diagramStyles } from "./diagram-styles";

export type DiagramNode = {
	id: string;
	name: string;
	kind: string;
	className?: string;
	status?: string;
	expandable?: boolean;
	expanded?: boolean;
	summary?: string;
	contextCount?: number;
};
export type DiagramEdge = {
	from: string;
	to: string;
	kind: "ownership" | "reference" | "context";
	label?: string;
};
export type DiagramData = {
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	selectedId?: string;
};
export type DiagramLayout = {
	nodes: (DiagramNode & { x: number; y: number })[];
	edges: DiagramEdge[];
	width: number;
	height: number;
	truncated: boolean;
};
const CARD_WIDTH = 200;
const CARD_HEIGHT = 84;
const GAP_X = 36;
const GAP_Y = 64;
const PADDING = 28;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;
const INITIAL_MIN_ZOOM = 0.6;

/** Bounded, deterministic spanning-forest layout. Only ownership affects position.
 * Additional parents and cycles remain visible as edges, never recursive layout.
 */
export function layoutDiagram(data: DiagramData): DiagramLayout {
	const rawNodes = Array.isArray(data?.nodes) ? data.nodes : [];
	const rawEdges = Array.isArray(data?.edges) ? data.edges : [];
	const byId = new Map<string, DiagramNode>();
	for (const node of rawNodes.slice(0, 250)) {
		if (node && typeof node.id === "string" && !byId.has(node.id))
			byId.set(node.id, node);
	}
	const edges = rawEdges
		.slice(0, 500)
		.filter(
			(edge) =>
				edge &&
				byId.has(edge.from) &&
				byId.has(edge.to) &&
				["ownership", "reference", "context"].includes(edge.kind)
		)
		.sort((a, b) => {
			const aKey = JSON.stringify([a.from, a.to, a.kind, safeText(a.label)]);
			const bKey = JSON.stringify([b.from, b.to, b.kind, safeText(b.label)]);
			return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
		});
	const ids = [...byId.keys()].sort();
	const adjacent = new Map(ids.map((id) => [id, new Set<string>()]));
	const incoming = new Set<string>();
	for (const edge of edges) {
		if (edge.kind !== "ownership" || edge.from === edge.to) continue;
		adjacent.get(edge.from)!.add(edge.to);
		incoming.add(edge.to);
	}
	const visited = new Set<string>();
	const children = new Map<string, string[]>();
	const widths = new Map<string, number>();
	const roots: string[] = [];
	function visit(id: string) {
		visited.add(id);
		const owned: string[] = [];
		children.set(id, owned);
		for (const child of [...adjacent.get(id)!].sort()) {
			if (visited.has(child)) continue;
			owned.push(child);
			visit(child);
		}
		widths.set(
			id,
			Math.max(
				CARD_WIDTH,
				owned.reduce((width, child) => width + widths.get(child)!, 0) +
					Math.max(0, owned.length - 1) * GAP_X
			)
		);
	}
	// Parentless roots first; remaining components may be entirely cyclic.
	for (const id of [...ids.filter((id) => !incoming.has(id)), ...ids]) {
		if (visited.has(id)) continue;
		roots.push(id);
		visit(id);
	}
	const nodes: DiagramLayout["nodes"] = [];
	let bottom = PADDING;
	function place(id: string, left: number, depth: number) {
		const width = widths.get(id)!;
		const y = PADDING + depth * (CARD_HEIGHT + GAP_Y);
		nodes.push({ ...byId.get(id)!, x: left + (width - CARD_WIDTH) / 2, y });
		bottom = Math.max(bottom, y + CARD_HEIGHT);
		let childLeft = left;
		for (const child of children.get(id)!) {
			place(child, childLeft, depth + 1);
			childLeft += widths.get(child)! + GAP_X;
		}
	}
	let left = PADDING;
	for (const root of roots) {
		place(root, left, 0);
		left += widths.get(root)! + GAP_X;
	}
	return {
		nodes,
		edges,
		width: Math.max(CARD_WIDTH + 2 * PADDING, left - GAP_X + PADDING),
		height: bottom + PADDING,
		truncated: rawNodes.length > 250 || rawEdges.length > 500,
	};
}

function element<K extends keyof HTMLElementTagNameMap>(
	document: Document,
	tag: K,
	className: string,
	text?: string
) {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}
const safeText = (value: unknown) =>
	typeof value === "string" ? value.slice(0, 2000) : "";

/** DOM-only view; no runtime objects, subscriptions, or automatic getter reads. */
export function mountStateDiagram(
	container: HTMLElement,
	callbacks: { select: (id: string) => void; toggle: (id: string) => void }
) {
	const document = container.ownerDocument;
	const root = element(document, "div", "rst-diagram");
	root.setAttribute("role", "region");
	root.setAttribute("aria-label", "Ownership diagram");
	const style = element(document, "style", "", diagramStyles);
	const toolbar = element(document, "div", "rst-diagram-toolbar");
	const viewport = element(document, "div", "rst-diagram-viewport");
	const scene = element(document, "div", "rst-diagram-scene");
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "rst-diagram-edges");
	svg.setAttribute("aria-hidden", "true");
	const cards = element(document, "div", "rst-diagram-cards");
	const empty = element(
		document,
		"div",
		"rst-diagram-empty",
		"No state nodes to display"
	);
	const legend = element(document, "div", "rst-diagram-legend");
	for (const [kind, text] of [
		["ownership", "Ownership"],
		["reference", "Reference"],
		["context", "Context"],
	])
		legend.append(
			element(document, "span", `rst-diagram-key rst-diagram-${kind}`, text)
		);
	const limit = element(document, "span", "rst-diagram-limit");
	legend.append(limit);
	const zoomLabel = element(document, "span", "rst-diagram-zoom");
	const hint = element(
		document,
		"span",
		"rst-diagram-hint",
		"Drag canvas to pan · Ctrl/⌘ + wheel to zoom"
	);
	let layout = layoutDiagram({ nodes: [], edges: [] });
	let zoom = 1;
	let panX = 0;
	let panY = 0;
	let fitted = false;
	let awaitingSize: "initial" | "fit" | undefined;
	let selectedId: string | undefined;
	let viewportSize: { width: number; height: number } | undefined;
	let disposed = false;
	let drag: { id: number; x: number; y: number } | undefined;
	const cardViews = new Map<
		string,
		{
			card: HTMLDivElement;
			select: HTMLButtonElement;
			toggle: HTMLButtonElement;
			name: HTMLSpanElement;
			meta: HTMLSpanElement;
			summary: HTMLSpanElement;
		}
	>();
	function renderViewport() {
		scene.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
		zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
	}
	function dimensions() {
		const rect = viewport.getBoundingClientRect();
		return {
			width: rect.width || 800,
			height: rect.height || 360,
			measured: rect.width > 0 && rect.height > 0,
		};
	}
	function frame(readable: boolean) {
		if (disposed) return;
		const { width, height, measured } = dimensions();
		if (measured) viewportSize = { width, height };
		const overviewZoom = Math.max(
			MIN_ZOOM,
			Math.min(1, (width - 24) / layout.width, (height - 24) / layout.height)
		);
		const focus =
			layout.nodes.find((node) => node.id === selectedId) ?? layout.nodes[0];
		if (readable && overviewZoom < INITIAL_MIN_ZOOM && focus) {
			// Opening a large forest should show readable cards, not tiny labels.
			// Explicit Fit remains a full overview; all later updates keep the view.
			zoom = INITIAL_MIN_ZOOM;
			panX = width / 2 - (focus.x + CARD_WIDTH / 2) * zoom;
			panY = height / 2 - (focus.y + CARD_HEIGHT / 2) * zoom;
		} else {
			zoom = overviewZoom;
			panX = (width - layout.width * zoom) / 2;
			panY = (height - layout.height * zoom) / 2;
		}
		awaitingSize = measured ? undefined : readable ? "initial" : "fit";
		renderViewport();
	}
	function fit() {
		frame(false);
	}
	function zoomAt(next: number, x: number, y: number) {
		awaitingSize = undefined;
		const previous = zoom;
		zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
		panX = x - ((x - panX) * zoom) / previous;
		panY = y - ((y - panY) * zoom) / previous;
		renderViewport();
	}
	function control(label: string, text: string, action: () => void) {
		const button = element(document, "button", "rst-diagram-control", text);
		button.type = "button";
		button.setAttribute("aria-label", label);
		button.onclick = action;
		toolbar.append(button);
	}
	function stepZoom(factor: number) {
		const { width, height } = dimensions();
		zoomAt(zoom * factor, width / 2, height / 2);
	}
	control("Zoom in diagram", "+", () => stepZoom(1.25));
	control("Zoom out diagram", "−", () => stepZoom(0.8));
	control("Fit diagram", "Fit", fit);
	toolbar.append(zoomLabel, hint);
	scene.append(svg, cards);
	viewport.append(scene, empty);
	root.append(style, toolbar, viewport, legend);
	container.append(root);
	renderViewport();

	function pointerDown(event: PointerEvent) {
		if (drag || event.button !== 0) return;
		if (
			event.target instanceof Element &&
			event.target.closest(".rst-diagram-card")
		)
			return;
		awaitingSize = undefined;
		drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
		// Capture is unavailable in jsdom and may fail for synthetic pointers.
		try {
			viewport.setPointerCapture?.(event.pointerId);
		} catch {
			/* No active pointer. */
		}
		viewport.classList.add("rst-diagram-dragging");
		event.preventDefault();
	}
	function pointerMove(event: PointerEvent) {
		if (!drag || drag.id !== event.pointerId) return;
		panX += event.clientX - drag.x;
		panY += event.clientY - drag.y;
		drag.x = event.clientX;
		drag.y = event.clientY;
		renderViewport();
	}
	function endDrag(event?: PointerEvent) {
		if (!drag || (event && drag.id !== event.pointerId)) return;
		const id = drag.id;
		drag = undefined;
		viewport.classList.remove("rst-diagram-dragging");
		try {
			viewport.releasePointerCapture?.(id);
		} catch {
			/* Already released. */
		}
	}
	function wheel(event: WheelEvent) {
		if (!Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY))
			return;
		event.preventDefault();
		awaitingSize = undefined;
		const multiplier =
			event.deltaMode === 1
				? 16
				: event.deltaMode === 2
					? dimensions().height
					: 1;
		if (event.ctrlKey || event.metaKey) {
			const rect = viewport.getBoundingClientRect();
			zoomAt(
				zoom *
					Math.exp(
						-Math.max(-100, Math.min(100, event.deltaY * multiplier)) * 0.01
					),
				event.clientX - rect.left,
				event.clientY - rect.top
			);
		} else {
			panX -= event.deltaX * multiplier;
			panY -= event.deltaY * multiplier;
			renderViewport();
		}
	}
	viewport.addEventListener("pointerdown", pointerDown);
	viewport.addEventListener("pointermove", pointerMove);
	viewport.addEventListener("pointerup", endDrag);
	viewport.addEventListener("pointercancel", endDrag);
	viewport.addEventListener("lostpointercapture", endDrag);
	viewport.addEventListener("wheel", wheel, { passive: false });
	const ResizeObserverClass = document.defaultView?.ResizeObserver;
	const observer = ResizeObserverClass
		? new ResizeObserverClass(() => {
				if (disposed) return;
				const { width, height, measured } = dimensions();
				if (!measured) return;
				if (awaitingSize && fitted) {
					frame(awaitingSize === "initial");
					return;
				}
				const previous = viewportSize;
				viewportSize = { width, height };
				if (
					!fitted ||
					(previous?.width === width && previous.height === height)
				)
					return;
				const focus =
					layout.nodes.find((node) => node.id === selectedId) ??
					layout.nodes[0];
				if (!focus) return;
				const left = panX + focus.x * zoom;
				const top = panY + focus.y * zoom;
				// Preserve intentional framing unless a genuine size change leaves
				// the selection entirely outside the viewport (e.g. desktop->mobile).
				if (
					left >= width ||
					left + CARD_WIDTH * zoom <= 0 ||
					top >= height ||
					top + CARD_HEIGHT * zoom <= 0
				) {
					panX = width / 2 - (focus.x + CARD_WIDTH / 2) * zoom;
					panY = height / 2 - (focus.y + CARD_HEIGHT / 2) * zoom;
					renderViewport();
				}
			})
		: undefined;
	observer?.observe(viewport);

	function update(data: DiagramData) {
		if (disposed) return;
		layout = layoutDiagram(data);
		selectedId = data.selectedId;
		const ids = new Set(layout.nodes.map((node) => node.id));
		for (const [id, view] of cardViews) {
			if (!ids.has(id)) {
				view.select.onclick = null;
				view.toggle.onclick = null;
				view.card.remove();
				cardViews.delete(id);
			}
		}
		for (const node of layout.nodes) {
			let view = cardViews.get(node.id);
			if (!view) {
				const card = element(document, "div", "rst-diagram-card");
				const select = element(document, "button", "rst-diagram-select");
				const toggle = element(document, "button", "rst-diagram-toggle");
				select.type = toggle.type = "button";
				const name = element(document, "span", "rst-diagram-name");
				const meta = element(document, "span", "rst-diagram-meta");
				const summary = element(document, "span", "rst-diagram-summary");
				select.append(name, meta, summary);
				select.onclick = () => callbacks.select(node.id);
				toggle.onclick = () => callbacks.toggle(node.id);
				card.append(select, toggle);
				cards.append(card);
				view = { card, select, toggle, name, meta, summary };
				cardViews.set(node.id, view);
			}
			view.card.style.left = `${node.x}px`;
			view.card.style.top = `${node.y}px`;
			view.card.classList.toggle(
				"rst-diagram-selected",
				node.id === data.selectedId
			);
			view.select.setAttribute(
				"aria-pressed",
				String(node.id === data.selectedId)
			);
			const name = safeText(node.name) || safeText(node.kind) || "Unnamed";
			view.select.setAttribute("aria-label", `Inspect diagram ${name}`);
			view.name.textContent = name;
			view.meta.textContent = [
				safeText(node.kind),
				safeText(node.className),
				safeText(node.status),
				typeof node.contextCount === "number" && node.contextCount > 0
					? `${node.contextCount} context`
					: "",
			]
				.filter(Boolean)
				.join(" · ");
			view.summary.textContent = safeText(node.summary);
			view.select.title = [
				name,
				view.meta.textContent,
				view.summary.textContent,
			]
				.filter(Boolean)
				.join("\n");
			view.toggle.hidden = !node.expandable;
			view.toggle.textContent = node.expanded ? "−" : "+";
			view.toggle.setAttribute(
				"aria-label",
				`${node.expanded ? "Collapse" : "Expand"} diagram ${name}`
			);
			view.toggle.setAttribute("aria-expanded", String(!!node.expanded));
		}
		scene.style.width = `${layout.width}px`;
		scene.style.height = `${layout.height}px`;
		svg.setAttribute("width", String(layout.width));
		svg.setAttribute("height", String(layout.height));
		svg.replaceChildren();
		const byId = new Map(layout.nodes.map((node) => [node.id, node]));
		for (const edge of layout.edges) {
			const from = byId.get(edge.from)!;
			const to = byId.get(edge.to)!;
			const path = document.createElementNS(svg.namespaceURI, "path");
			const x1 = from.x + CARD_WIDTH / 2;
			const y1 = from.y + CARD_HEIGHT;
			const x2 = to.x + CARD_WIDTH / 2;
			const y2 = to.y;
			const middle = (y1 + y2) / 2;
			path.setAttribute("class", `rst-diagram-edge rst-diagram-${edge.kind}`);
			path.setAttribute(
				"d",
				edge.from === edge.to
					? `M ${from.x + CARD_WIDTH} ${from.y + 20} C ${from.x + CARD_WIDTH + 24} ${from.y - 16}, ${from.x + CARD_WIDTH + 24} ${from.y + 68}, ${from.x + CARD_WIDTH} ${from.y + 64}`
					: `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`
			);
			svg.append(path);
			if (edge.label) {
				const label = document.createElementNS(svg.namespaceURI, "text");
				label.setAttribute(
					"class",
					`rst-diagram-edge-label rst-diagram-${edge.kind}`
				);
				label.setAttribute("x", String((x1 + x2) / 2 + 5));
				label.setAttribute("y", String(middle - 5));
				label.textContent = safeText(edge.label).slice(0, 80);
				svg.append(label);
			}
		}
		empty.hidden = layout.nodes.length > 0;
		limit.textContent = layout.truncated
			? "Limited to 250 nodes / 500 edges"
			: "";
		if (!fitted && layout.nodes.length) {
			fitted = true;
			frame(true);
		} else if (awaitingSize && dimensions().measured) {
			// Also handle first visibility on update when ResizeObserver is absent.
			frame(awaitingSize === "initial");
		}
	}
	function dispose() {
		if (disposed) return;
		disposed = true;
		endDrag();
		observer?.disconnect();
		viewport.removeEventListener("pointerdown", pointerDown);
		viewport.removeEventListener("pointermove", pointerMove);
		viewport.removeEventListener("pointerup", endDrag);
		viewport.removeEventListener("pointercancel", endDrag);
		viewport.removeEventListener("lostpointercapture", endDrag);
		viewport.removeEventListener("wheel", wheel);
		for (const view of cardViews.values()) {
			view.select.onclick = null;
			view.toggle.onclick = null;
		}
		for (const button of toolbar.querySelectorAll("button"))
			button.onclick = null;
		cardViews.clear();
		root.remove();
	}
	return { update, dispose, fit };
}
