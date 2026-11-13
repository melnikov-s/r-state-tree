// @vitest-environment jsdom
import {
	layoutDiagram,
	mountStateDiagram,
	type DiagramData,
	type DiagramNode,
} from "../src/inspection/diagram";

const node = (id: string): DiagramNode => ({ id, name: id, kind: "Store" });
const ownership = (from: string, to: string) => ({
	from,
	to,
	kind: "ownership" as const,
});
const sample = (): DiagramData => ({
	nodes: [node("root"), node("left"), node("right"), node("other")],
	edges: [ownership("root", "left"), ownership("root", "right")],
});
const largeForest = (): DiagramData => ({
	nodes: Array.from({ length: 25 }, (_, i) =>
		node(`root-${String(i).padStart(2, "0")}`)
	),
	edges: [],
	selectedId: "root-24",
});
const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	document.body.replaceChildren();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function rectangle(width: number, height: number) {
	return {
		x: 20,
		y: 30,
		left: 20,
		top: 30,
		width,
		height,
		right: width + 20,
		bottom: height + 30,
		toJSON() {},
	};
}
function mount(data = sample()) {
	const container = document.createElement("div");
	document.body.append(container);
	const select = vi.fn();
	const toggle = vi.fn();
	const diagram = mountStateDiagram(container, { select, toggle });
	cleanups.push(diagram.dispose);
	const viewport = container.querySelector<HTMLElement>(
		".rst-diagram-viewport"
	)!;
	vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
		x: 20,
		y: 30,
		left: 20,
		top: 30,
		width: 800,
		height: 400,
		right: 820,
		bottom: 430,
		toJSON() {},
	});
	const scene = container.querySelector<HTMLElement>(".rst-diagram-scene")!;
	const button = (label: string) => {
		const result = [...container.querySelectorAll("button")].find(
			(item) => item.getAttribute("aria-label") === label
		);
		expect(result, label).toBeDefined();
		return result!;
	};
	diagram.update(data);
	return { ...diagram, container, select, toggle, viewport, scene, button };
}
function pointer(
	target: HTMLElement,
	type: string,
	x: number,
	y: number,
	id = 1,
	button = 0
) {
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
		button,
	});
	Object.defineProperty(event, "pointerId", { value: id });
	target.dispatchEvent(event);
}
function transform(scene: HTMLElement) {
	const numbers = scene.style.transform.match(/-?[\d.]+/g)!.map(Number);
	return { x: numbers[0], y: numbers[1], zoom: numbers[2] };
}

test("deterministic forest layout centers parents above branches without overlapping cards", () => {
	const data = sample();
	data.nodes.push(node("grandchild"));
	data.edges.push(ownership("left", "grandchild"));
	const layout = layoutDiagram(data);
	expect(
		layoutDiagram({
			nodes: [...data.nodes].reverse(),
			edges: [...data.edges].reverse(),
		})
	).toEqual(layout);
	expect(layout.nodes).toHaveLength(5);
	for (const a of layout.nodes) {
		expect(a.x).toBeGreaterThanOrEqual(0);
		expect(a.y).toBeGreaterThanOrEqual(0);
		expect(a.x + 200).toBeLessThanOrEqual(layout.width);
		expect(a.y + 84).toBeLessThanOrEqual(layout.height);
		for (const b of layout.nodes) {
			if (a === b) continue;
			expect(
				a.x + 200 <= b.x ||
					b.x + 200 <= a.x ||
					a.y + 84 <= b.y ||
					b.y + 84 <= a.y
			).toBe(true);
		}
	}
	const byId = new Map(layout.nodes.map((item) => [item.id, item]));
	expect(byId.get("root")!.y).toBeLessThan(byId.get("left")!.y);
	expect(byId.get("left")!.y).toBeLessThan(byId.get("grandchild")!.y);
	expect(byId.get("root")!.x).toBe(
		(byId.get("left")!.x + byId.get("right")!.x) / 2
	);
});

test("cycles, self edges, shared ownership and disconnected components are finite and unique", () => {
	const layout = layoutDiagram({
		nodes: [node("a"), node("b"), node("c"), node("d"), node("e")],
		edges: [
			ownership("a", "b"),
			ownership("b", "a"),
			ownership("a", "a"),
			ownership("c", "b"),
			ownership("d", "e"),
			ownership("e", "d"),
		],
	});
	expect(new Set(layout.nodes.map((item) => item.id)).size).toBe(5);
	expect(layout.edges).toHaveLength(6);
	expect(layout.width).toBeLessThan(2000);
	expect(layout.height).toBeLessThan(1000);
	expect(
		layout.nodes.every(
			(item) => Number.isFinite(item.x) && Number.isFinite(item.y)
		)
	).toBe(true);
});

test("cross references and context overlays never influence ownership layout", () => {
	const data = sample();
	const basic = layoutDiagram(data);
	data.edges.push(
		{ from: "left", to: "root", kind: "context", label: "Theme" },
		{ from: "other", to: "right", kind: "reference" }
	);
	const overlays = layoutDiagram(data);
	expect(overlays.nodes).toEqual(basic.nodes);
	expect(overlays.width).toBe(basic.width);
	expect(overlays.height).toBe(basic.height);
	expect(overlays.edges).toHaveLength(4);
});

test("malformed, duplicate and oversized data is bounded before graph traversal", () => {
	const nodes = Array.from({ length: 10000 }, (_, i) => node(String(i)));
	const edges = Array.from({ length: 10000 }, (_, i) =>
		ownership(String(i % 250), String((i + 1) % 250))
	);
	const layout = layoutDiagram({ nodes, edges });
	expect(layout.nodes).toHaveLength(250);
	expect(layout.edges).toHaveLength(500);
	expect(layout.truncated).toBe(true);
	expect(Number.isFinite(layout.height)).toBe(true);
	const malformed = layoutDiagram({
		nodes: [null, node("a"), node("a"), {}, node("b")],
		edges: [
			null,
			ownership("a", "missing"),
			{ from: "a", to: "b", kind: "bad" },
		],
	} as unknown as DiagramData);
	expect(malformed.nodes).toHaveLength(2);
	expect(malformed.edges).toHaveLength(0);
	expect(
		layoutDiagram({ nodes: null, edges: null } as unknown as DiagramData).nodes
	).toEqual([]);
});

test("accessible selectable cards expose metadata, context and selection while keeping text inert", () => {
	const unsafe = '<img src=x onerror="alert(1)">';
	const data: DiagramData = {
		nodes: [
			{
				id: "unsafe",
				name: unsafe,
				kind: "Model",
				className: "Theme",
				status: "mounted",
				summary: "3 props · 4 computeds · 5 methods",
				contextCount: 2,
				expandable: true,
			},
		],
		edges: [
			{
				from: "unsafe",
				to: "unsafe",
				kind: "context",
				label: "<script>bad()</script>",
			},
		],
		selectedId: "unsafe",
	};
	const { container, button, select, toggle, update } = mount(data);
	expect(
		container.querySelector('[aria-label="Ownership diagram"]')
	).not.toBeNull();
	const inspect = button(`Inspect diagram ${unsafe}`);
	expect(inspect.tagName).toBe("BUTTON");
	expect(inspect.getAttribute("aria-pressed")).toBe("true");
	expect(inspect.closest(".rst-diagram-selected")).not.toBeNull();
	expect(inspect.textContent).toContain("Model · Theme · mounted · 2 context");
	expect(inspect.textContent).toContain(data.nodes[0].summary);
	expect(container.querySelector("img,script,foreignObject")).toBeNull();
	expect(container.querySelector("svg text")!.textContent).toBe(
		"<script>bad()</script>"
	);
	inspect.click();
	expect(select).toHaveBeenCalledExactlyOnceWith("unsafe");
	button(`Expand diagram ${unsafe}`).click();
	expect(toggle).toHaveBeenCalledExactlyOnceWith("unsafe");
	expect(select).toHaveBeenCalledTimes(1);
	inspect.focus();
	update({
		...data,
		selectedId: undefined,
		nodes: [{ ...data.nodes[0], expanded: true }],
	});
	expect(button(`Inspect diagram ${unsafe}`)).toBe(inspect);
	expect(document.activeElement).toBe(inspect);
	expect(inspect.getAttribute("aria-pressed")).toBe("false");
	expect(container.querySelector(".rst-diagram-selected")).toBeNull();
	expect(
		button(`Collapse diagram ${unsafe}`).getAttribute("aria-expanded")
	).toBe("true");
});

test("SVG connectors, labels and legend distinguish ownership, reference and context", () => {
	const data = sample();
	data.edges.push(
		{ from: "left", to: "right", kind: "reference" },
		{ from: "other", to: "root", kind: "context", label: "Theme" }
	);
	const { container } = mount(data);
	expect(container.querySelectorAll("svg path")).toHaveLength(4);
	expect(container.querySelectorAll("svg .rst-diagram-ownership")).toHaveLength(
		2
	);
	expect(
		container.querySelector("svg path.rst-diagram-reference")
	).not.toBeNull();
	expect(
		container.querySelector("svg path.rst-diagram-context")
	).not.toBeNull();
	expect(container.querySelector("svg text")!.textContent).toBe("Theme");
	expect(container.querySelector(".rst-diagram-legend")!.textContent).toBe(
		"OwnershipReferenceContext"
	);
});

test("initial fit, ordinary wheel pan and selection/refresh preserve viewport until explicit Fit", () => {
	const { viewport, scene, update, button } = mount();
	const initial = scene.style.transform;
	expect(transform(scene).zoom).toBeGreaterThan(0);
	viewport.dispatchEvent(
		new WheelEvent("wheel", { deltaX: 20, deltaY: 30, cancelable: true })
	);
	const panned = scene.style.transform;
	expect(panned).not.toBe(initial);
	update({ ...sample(), selectedId: "left" });
	expect(scene.style.transform).toBe(panned);
	update(sample());
	expect(scene.style.transform).toBe(panned);
	button("Fit diagram").click();
	expect(scene.style.transform).toBe(initial);
});

test("zoom controls clamp scale and Ctrl/Meta wheel zoom stays anchored at the pointer", () => {
	const { viewport, scene, button } = mount();
	const before = transform(scene);
	viewport.dispatchEvent(
		new WheelEvent("wheel", {
			clientX: 180,
			clientY: 130,
			deltaY: -15,
			ctrlKey: true,
			cancelable: true,
		})
	);
	const after = transform(scene);
	expect(after.zoom).toBeGreaterThan(before.zoom);
	expect((160 - before.x) / before.zoom).toBeCloseTo(
		(160 - after.x) / after.zoom
	);
	expect((100 - before.y) / before.zoom).toBeCloseTo(
		(100 - after.y) / after.zoom
	);
	viewport.dispatchEvent(
		new WheelEvent("wheel", { deltaY: 15, metaKey: true })
	);
	expect(transform(scene).zoom).toBeCloseTo(before.zoom);
	for (let i = 0; i < 50; i++) button("Zoom in diagram").click();
	expect(transform(scene).zoom).toBe(2);
	for (let i = 0; i < 50; i++) button("Zoom out diagram").click();
	expect(transform(scene).zoom).toBe(0.15);
});

test("pointer canvas drag ignores cards, secondary pointers and buttons; cancel releases capture", () => {
	const { viewport, scene, button } = mount();
	const capture = vi.fn();
	const release = vi.fn();
	viewport.setPointerCapture = capture;
	viewport.releasePointerCapture = release;
	const initial = transform(scene);
	pointer(button("Inspect diagram root"), "pointerdown", 20, 30);
	pointer(viewport, "pointermove", 40, 50);
	expect(transform(scene)).toEqual(initial);
	pointer(viewport, "pointerdown", 20, 30, 1, 2);
	expect(capture).not.toHaveBeenCalled();
	pointer(viewport, "pointerdown", 20, 30);
	expect(capture).toHaveBeenCalledWith(1);
	pointer(viewport, "pointermove", 200, 200, 2);
	expect(transform(scene)).toEqual(initial);
	pointer(viewport, "pointermove", 40, 60);
	expect(transform(scene)).toEqual({
		...initial,
		x: initial.x + 20,
		y: initial.y + 30,
	});
	pointer(viewport, "pointercancel", 40, 60);
	expect(release).toHaveBeenCalledWith(1);
	expect(viewport.classList.contains("rst-diagram-dragging")).toBe(false);
	const canceled = scene.style.transform;
	pointer(viewport, "pointermove", 100, 100);
	expect(scene.style.transform).toBe(canceled);
});

test("dispose removes handlers, active capture and observers; later updates/fit are inert", () => {
	const disconnect = vi.fn();
	const observe = vi.fn();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = observe;
			disconnect = disconnect;
		}
	);
	const { container, viewport, scene, button, select, update, fit, dispose } =
		mount();
	const inspect = button("Inspect diagram root");
	const zoom = button("Zoom in diagram");
	const release = vi.fn();
	viewport.releasePointerCapture = release;
	pointer(viewport, "pointerdown", 10, 10);
	const previous = scene.style.transform;
	dispose();
	dispose();
	expect(observe).toHaveBeenCalledWith(viewport);
	expect(disconnect).toHaveBeenCalledTimes(1);
	expect(release).toHaveBeenCalledWith(1);
	expect(container.childElementCount).toBe(0);
	inspect.click();
	zoom.click();
	pointer(viewport, "pointerdown", 5, 5);
	pointer(viewport, "pointermove", 50, 50);
	viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 20 }));
	update(sample());
	fit();
	expect(scene.style.transform).toBe(previous);
	expect(select).not.toHaveBeenCalled();
});

test("empty-to-loaded data fits once; node removals and graph limits are visible", () => {
	const { container, scene, update } = mount({ nodes: [], edges: [] });
	expect(
		container.querySelector<HTMLElement>(".rst-diagram-empty")!.hidden
	).toBe(false);
	update(sample());
	expect(
		container.querySelector<HTMLElement>(".rst-diagram-empty")!.hidden
	).toBe(true);
	const firstFit = scene.style.transform;
	update({ nodes: [node("only")], edges: [] });
	expect(container.querySelectorAll(".rst-diagram-card")).toHaveLength(1);
	expect(scene.style.transform).toBe(firstFit);
	update({
		nodes: Array.from({ length: 300 }, (_, i) => node(String(i))),
		edges: [],
	});
	expect(container.querySelectorAll(".rst-diagram-card")).toHaveLength(250);
	expect(container.querySelector(".rst-diagram-limit")!.textContent).toContain(
		"250 nodes / 500 edges"
	);
});

test("large forests open at readable scale centered on selected node; explicit Fit allows overview", () => {
	const data = largeForest();
	const { scene, update, button } = mount(data);
	const initial = transform(scene);
	const focus = layoutDiagram(data).nodes.find(
		(item) => item.id === data.selectedId
	)!;
	expect(initial.zoom).toBe(0.6);
	expect(initial.x + (focus.x + 100) * initial.zoom).toBeCloseTo(400);
	expect(initial.y + (focus.y + 42) * initial.zoom).toBeCloseTo(200);
	update({ ...data, selectedId: "root-00" });
	expect(transform(scene)).toEqual(initial);
	button("Fit diagram").click();
	expect(transform(scene).zoom).toBeLessThan(0.6);
	const overview = transform(scene);
	update(data);
	expect(transform(scene)).toEqual(overview);
});

test("large forest without valid selection initially centers the first ownership root", () => {
	const data = { ...largeForest(), selectedId: "not-present" };
	const { scene } = mount(data);
	const initial = transform(scene);
	const root = layoutDiagram(data).nodes[0];
	expect(initial.zoom).toBe(0.6);
	expect(initial.x + (root.x + 100) * initial.zoom).toBeCloseTo(400);
	expect(initial.y + (root.y + 42) * initial.zoom).toBeCloseTo(200);
});

test("first visible ResizeObserver measurement re-frames hidden initial data only once", () => {
	let notify = () => {};
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: () => void) {
				notify = callback;
			}
			observe() {}
			disconnect() {}
		}
	);
	const { viewport, scene, update } = mount({ nodes: [], edges: [] });
	const rect = rectangle(800, 400);
	const getRect = vi.mocked(viewport.getBoundingClientRect);
	getRect.mockReturnValue({ ...rect, width: 0, height: 0 });
	const data = largeForest();
	update(data);
	getRect.mockReturnValue({ ...rect, width: 1000, height: 600 });
	notify();
	const visible = transform(scene);
	const focus = layoutDiagram(data).nodes.find(
		(item) => item.id === data.selectedId
	)!;
	expect(visible.zoom).toBe(0.6);
	expect(visible.x + (focus.x + 100) * visible.zoom).toBeCloseTo(500);
	expect(visible.y + (focus.y + 42) * visible.zoom).toBeCloseTo(300);
	getRect.mockReturnValue({ ...rect, width: 1200, height: 800 });
	notify();
	expect(transform(scene)).toEqual(visible);
});

test("hidden explicit Fit retains overview mode on visibility, with update fallback when no observer exists", () => {
	vi.stubGlobal("ResizeObserver", undefined);
	const { viewport, scene, update, button } = mount({ nodes: [], edges: [] });
	const rect = rectangle(800, 400);
	const getRect = vi.mocked(viewport.getBoundingClientRect);
	getRect.mockReturnValue({ ...rect, width: 0, height: 0 });
	update(largeForest());
	expect(transform(scene).zoom).toBe(0.6);
	button("Fit diagram").click();
	getRect.mockReturnValue({ ...rect, width: 1600, height: 600 });
	update(largeForest());
	const overview = transform(scene);
	expect(overview.zoom).toBeGreaterThan(0.15);
	expect(overview.zoom).toBeLessThan(0.6);
	const layout = layoutDiagram(largeForest());
	expect(overview.x + (layout.width * overview.zoom) / 2).toBeCloseTo(800);
});

test.each([
	{ width: 375, height: 90 },
	{ width: 90, height: 400 },
])(
	"genuine resize to $width × $height recenters wholly clipped selection without changing zoom",
	({ width, height }) => {
		let notify = () => {};
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: () => void) {
					notify = callback;
				}
				observe() {}
				disconnect() {}
			}
		);
		const data = largeForest();
		const { viewport, scene, update } = mount(data);
		const before = transform(scene);
		vi.mocked(viewport.getBoundingClientRect).mockReturnValue(
			rectangle(width, height)
		);
		notify();
		const after = transform(scene);
		const focus = layoutDiagram(data).nodes.find(
			(item) => item.id === data.selectedId
		)!;
		expect(after.zoom).toBe(before.zoom);
		expect(after.x + (focus.x + 100) * after.zoom).toBeCloseTo(width / 2);
		expect(after.y + (focus.y + 42) * after.zoom).toBeCloseTo(height / 2);
		// A selection/refresh and a same-size observer delivery must not re-center.
		update({ ...data, selectedId: "root-00" });
		notify();
		expect(transform(scene)).toEqual(after);
	}
);

test("real resize preserves user pan/zoom when selected card remains visible", () => {
	let notify = () => {};
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: () => void) {
				notify = callback;
			}
			observe() {}
			disconnect() {}
		}
	);
	const { viewport, scene } = mount(largeForest());
	viewport.dispatchEvent(new WheelEvent("wheel", { deltaX: 15, deltaY: 10 }));
	const before = transform(scene);
	vi.mocked(viewport.getBoundingClientRect).mockReturnValue(
		rectangle(750, 380)
	);
	notify();
	expect(transform(scene)).toEqual(before);
});
