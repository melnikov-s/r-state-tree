import type { Inspector } from "./runtime";
import { isRecord } from "./protocol";

/** Independent, manually refreshed view. Keeps operation UI out of tree/navigation state. */
export function createOperationsView(
	inspector: Inspector,
	operationsPane: HTMLElement,
	report: (message: string, error?: boolean) => void
) {
	let removed = false;
	const document = operationsPane.ownerDocument;
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
	function button(label: string, action: () => void) {
		const node = element("button", label);
		node.type = "button";
		node.onclick = () => {
			if (!removed) action();
		};
		return node;
	}
	function renderOperations() {
		if (removed) return;
		const scroll = operationsPane.scrollTop;
		operationsPane.replaceChildren(
			element("h3", "Application operations"),
			element(
				"p",
				"Method calls, writes and optional app operations · grouped by synchronous batch · manual refresh · no replay",
				"node-meta"
			)
		);
		try {
			const result = inspector.query({ op: "operations" });
			if (!isRecord(result) || result.enabled !== true) {
				operationsPane.append(
					element(
						"p",
						"No operation timeline attached. Enable createInspector({ activity: true }) for automatic calls and writes, or attach an operations timeline.",
						"message"
					)
				);
				return;
			}
			if (result.redacted === true) {
				operationsPane.append(
					element("p", "Operation timeline redacted.", "message")
				);
				return;
			}
			if (
				result.truncated === true ||
				(isRecord(result.activity) &&
					result.activity.discoveryTruncated === true)
			)
				operationsPane.append(
					element(
						"p",
						"Activity is partial: history output or retained-object discovery reached its limit. Register a smaller root for more detail.",
						"message"
					)
				);
			const clear = button("Clear operations", () => {
				try {
					inspector.query({ op: "clearOperations" });
					renderOperations();
					report("Operation history cleared; running work was not cancelled.");
				} catch {
					report("Could not clear operations. Controls must be enabled.", true);
				}
			});
			clear.disabled = result.canClear !== true;
			operationsPane.append(
				clear,
				element(
					"p",
					"Abort requested does not mean work stopped or rolled back. Unobserved means observation expired or the return was a custom thenable; work may still finish.",
					"node-meta"
				)
			);
			const records: unknown[] = Array.isArray(result.records)
				? result.records
				: [];
			if (
				!records.some((record) => isRecord(record) && record.kind !== "batch")
			)
				operationsPane.append(
					element("p", "No recorded operations", "message")
				);
			const list = element("ol", undefined, "operations-list");
			const batches = new Map<string, HTMLOListElement>();
			const batchRecords = records
				.filter(isRecord)
				.filter((record) => record.kind === "batch");
			function batchList(id: string): HTMLOListElement {
				const existing = batches.get(id);
				if (existing) return existing;
				const members = records
					.filter(isRecord)
					.filter((record) => record.batchId === id);
				const row = element("li", undefined, "operation-batch");
				const details = element("details");
				details.open = true;
				const failed =
					batchRecords.find((record) => record.id === id)?.status === "failed";
				details.append(
					element(
						"summary",
						`Batch · ${members.filter((record) => record.kind === "method").length} calls · ${members.filter((record) => record.kind === "write").length} writes${failed ? " · failed (not rolled back)" : ""}`
					)
				);
				const children = element(
					"ol",
					undefined,
					"operations-list batch-records"
				);
				details.append(children);
				row.append(details);
				list.append(row);
				batches.set(id, children);
				return children;
			}
			for (const record of records) {
				if (!isRecord(record) || record.kind === "batch") continue;
				const row = element("li", undefined, "operation-record");
				row.append(
					element(
						"strong",
						record.name === "$items"
							? "Array contents"
							: typeof record.name === "string"
								? record.name
								: "Unnamed operation"
					),
					element(
						"span",
						typeof record.status === "string" ? record.status : "unknown",
						`operation-status ${record.status === "failed" ? "error" : ""}`
					)
				);
				const date =
					typeof record.startedAt === "number"
						? new Date(record.startedAt).toLocaleTimeString()
						: "Unknown start";
				row.append(
					element(
						"p",
						`${date} · ${typeof record.durationMs === "number" ? Math.round(record.durationMs) : 0} ms${record.abortRequested === true ? " · abort requested" : ""}`,
						"node-meta"
					)
				);
				if (Array.isArray(record.path))
					row.append(
						element(
							"p",
							`${typeof record.rootName === "string" ? record.rootName : "Root"} › ${record.path.filter((part) => typeof part === "string").join(" › ")}`,
							"node-meta"
						)
					);
				if (record.kind === "write")
					row.append(
						element(
							"p",
							record.operation === "splice" &&
								typeof record.before === "number" &&
								typeof record.after === "number"
								? `splice · ${record.before} removed · ${record.after} added`
								: ["fill", "reverse", "sort", "copyWithin"].includes(
											String(record.operation)
									  )
									? `${String(record.operation)} · array changed`
									: `${typeof record.operation === "string" ? record.operation : "write"}: ${String(record.before)} → ${String(record.after)}`,
							"operation-change"
						)
					);
				if (record.kind === "method")
					row.prepend(element("span", "Call · ", "node-meta"));
				if (typeof record.error === "string")
					row.append(element("p", record.error, "operation-error error"));
				(typeof record.batchId === "string"
					? batchList(record.batchId)
					: list
				).append(row);
			}
			operationsPane.append(list);
		} catch {
			report("Operation timeline unavailable. Error details hidden.", true);
		}
		operationsPane.scrollTop = scroll;
	}

	return {
		render: renderOperations,
		dispose() {
			removed = true;
			operationsPane.replaceChildren();
		},
	};
}
