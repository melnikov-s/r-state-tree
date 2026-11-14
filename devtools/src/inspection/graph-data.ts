import type { InspectionValue } from "./runtime.js";
import { isRecord } from "./protocol.js";
import type { DiagramData, DiagramNode, DiagramEdge } from "./diagram.js";

export type GraphAddress = { rootId: string; name: string; path: string[] };
export type GraphRoot = { rootId: string; name: string; kind: string };
export type InspectorGraph = DiagramData & {
	addresses: Map<string, GraphAddress>;
	limited: boolean;
};
const objectNode = (
	value: unknown
): value is Record<string, unknown> & { id: string; kind: string } =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.kind === "string" &&
	["Store", "Model", "array", "reference"].includes(value.kind);

/** A bounded ownership projection. Props and references never turn into ownership edges. */
export function buildInspectorGraph(
	roots: GraphRoot[],
	read: (address: GraphAddress) => InspectionValue,
	expansion: ReadonlyMap<string, boolean>,
	selected?: GraphAddress,
	showReferences = false,
	showContext = true,
	selectedValue?: InspectionValue
): InspectorGraph {
	const nodes: DiagramNode[] = [];
	const edges: DiagramEdge[] = [];
	const addresses = new Map<string, GraphAddress>();
	const byId = new Map<string, DiagramNode>();
	const inspected = new Map<string, Record<string, unknown>>();
	const references: DiagramEdge[] = [];
	let limited = false;
	let reads = 0;
	const append = (
		at: GraphAddress,
		value: Record<string, unknown> & { id: string; kind: string },
		depth: number,
		parent?: string
	): void => {
		if (nodes.length >= 160) {
			limited = true;
			return;
		}
		if (parent && edges.length < 500)
			edges.push({ from: parent, to: value.id, kind: "ownership" });
		if (byId.has(value.id)) return;
		const open = at.path.length < 16 && (expansion.get(value.id) ?? depth < 2);
		const node: DiagramNode = {
			id: value.id,
			name: at.name,
			kind: value.kind,
			...(typeof value.className === "string"
				? { className: value.className }
				: {}),
			...(typeof value.status === "string" ? { status: value.status } : {}),
			expandable: false,
			expanded: false,
		};
		nodes.push(node);
		byId.set(node.id, node);
		addresses.set(node.id, at);
		let result: InspectionValue;
		if (reads >= 40) {
			if (isRecord(selectedValue) && selectedValue.id === node.id)
				result = selectedValue;
			else {
				limited = true;
				node.summary = "Select to inspect children";
				return;
			}
		} else {
			try {
				reads++;
				result = read(at);
			} catch {
				node.status = "unavailable";
				return;
			}
		}
		if (!isRecord(result)) {
			node.expanded = false;
			node.expandable = false;
			return;
		}
		// Shallow parent reads can describe an owned child as a reference when an
		// earlier field aliases it. Its resolved runtime, not that marker, defines shape.
		if (typeof result.kind === "string") node.kind = result.kind;
		if (typeof result.className === "string") node.className = result.className;
		if (typeof result.status === "string") node.status = result.status;
		if (!Array.isArray(result.fields)) {
			node.expanded = false;
			node.expandable = false;
			return;
		}
		inspected.set(node.id, result);
		const fields = (result.fields as unknown[]).filter(isRecord);
		const computeds = fields.filter(
			(field) => field.type === "computed"
		).length;
		const methods = Array.isArray(result.methods) ? result.methods.length : 0;
		node.summary = `${fields.length} fields · ${computeds} computed · ${methods} methods`;
		node.contextCount = Array.isArray(result.contexts)
			? result.contexts.length
			: 0;
		// Only offer expansion when it will reveal a child, never just an empty state.
		node.expandable =
			at.path.length < 16 &&
			fields.some(
				(field) =>
					typeof field.name === "string" &&
					(field.edge === "ownership" || node.kind === "array") &&
					(objectNode(field.value) ||
						(isRecord(field.value) && field.value.kind === "uninitialized"))
			);
		node.expanded = open && node.expandable;
		if (result.truncated) limited = true;
		for (const field of fields) {
			if (typeof field.name !== "string") continue;
			const owned = field.edge === "ownership" || node.kind === "array";
			if (!owned) {
				if (objectNode(field.value) && references.length < 500)
					references.push({
						from: node.id,
						to: field.value.id,
						label: field.name,
						kind: "reference",
					});
				continue;
			}
			if (!node.expanded) continue;
			if (objectNode(field.value)) {
				append(
					{
						rootId: at.rootId,
						name: field.name,
						path: at.path.concat(field.name),
					},
					field.value,
					depth + 1,
					node.id
				);
			} else if (
				isRecord(field.value) &&
				field.value.kind === "uninitialized" &&
				nodes.length < 160
			) {
				const id = `lazy:${JSON.stringify([at.rootId, ...at.path, field.name])}`;
				const placeholder: DiagramNode = {
					id,
					name: field.name,
					kind: "Store",
					status: "not initialized",
					summary: "Select its parent to initialize",
				};
				nodes.push(placeholder);
				byId.set(id, placeholder);
				addresses.set(id, at);
				if (edges.length < 500)
					edges.push({ from: node.id, to: id, kind: "ownership" });
			}
		}
	};
	for (const root of roots)
		append({ ...root, path: [] }, { id: root.rootId, kind: root.kind }, 0);
	let selectedId: string | undefined;
	if (selected) {
		let longest = -1;
		for (const [id, at] of addresses) {
			if (
				at.rootId !== selected.rootId ||
				at.path.length > selected.path.length ||
				!at.path.every((part, i) => selected.path[i] === part)
			)
				continue;
			if (at.path.length > longest) {
				selectedId = id;
				longest = at.path.length;
			}
		}
		// References can select the same runtime through a different path/root.
		// Prefer actual identity over a merely matching path prefix.
		const direct = [...addresses].find(
			([, at]) =>
				at.rootId === selected.rootId &&
				at.path.length === selected.path.length &&
				at.path.every((part, index) => selected.path[index] === part)
		);
		let actual: unknown = direct ? inspected.get(direct[0]) : selectedValue;
		if (!actual && direct && reads < 40) {
			try {
				reads++;
				actual = read(selected);
			} catch {
				/* Keep its visible owning ancestor selected. */
			}
		}
		if (
			isRecord(actual) &&
			typeof actual.id === "string" &&
			byId.has(actual.id)
		) {
			selectedId = actual.id;
			inspected.set(actual.id, actual);
			const node = byId.get(actual.id)!;
			node.contextCount = Array.isArray(actual.contexts)
				? actual.contexts.length
				: 0;
		}
	}
	if (showReferences) {
		for (const edge of references)
			if (byId.has(edge.to) && edge.from !== edge.to && edges.length < 500)
				edges.push(edge);
	}
	if (showContext && selectedId) {
		const contexts = inspected.get(selectedId)?.contexts;
		if (Array.isArray(contexts))
			for (const context of contexts) {
				if (
					!isRecord(context) ||
					typeof context.providerId !== "string" ||
					typeof context.name !== "string" ||
					context.status === "redacted" ||
					context.providerId === selectedId ||
					!byId.has(context.providerId) ||
					edges.length >= 500
				)
					continue;
				edges.push({
					from: context.providerId,
					to: selectedId,
					kind: "context",
					label: `${context.name} · available`,
				});
			}
	}
	return { nodes, edges, selectedId, addresses, limited };
}
