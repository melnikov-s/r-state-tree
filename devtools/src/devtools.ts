/// <reference lib="dom" />
export { createInspector } from "./inspection/runtime";
export { createOperationTimeline } from "./inspection/operations";
export type { ActivityOptions, ActivityRecord } from "./inspection/activity";
export type {
	OperationTimeline,
	OperationRecord,
	OperationTimelineOptions,
	OperationRunOptions,
} from "./inspection/operations";
export type {
	Inspector,
	InspectorOptions,
	InspectionValue,
} from "./inspection/runtime";
export type { InspectionRequest, ControlValue } from "./inspection/protocol";
import type { Inspector } from "./inspection/runtime";
import {
	CHANNEL,
	MAX_FRAME_BYTES,
	validateRequest,
	isRecord,
} from "./inspection/protocol";

export interface InspectorHot {
	on(event: string, callback: (data: any) => void): void;
	off(event: string, callback: (data: any) => void): void;
	send(event: string, data: any): void;
	dispose(callback: () => void): void;
}

/** Call only behind import.meta.hot. Does not need the visual panel. */
export function connectViteInspector(
	inspector: Inspector,
	hot: InspectorHot,
	token: string
) {
	if (!token) throw new Error("Inspector Vite plugin is not enabled");
	const tabId = crypto.randomUUID();
	let disposed = false;
	const announce = () => {
		if (!disposed)
			hot.send(CHANNEL + ":hello", {
				token,
				tabId,
				title: "RStateTree",
				url: location.origin,
			});
	};
	const handle = (frame: unknown) => {
		if (
			disposed ||
			!isRecord(frame) ||
			frame.token !== token ||
			frame.tabId !== tabId ||
			typeof frame.id !== "string" ||
			frame.id.length > 100
		)
			return;
		const failure = {
			error:
				"Inspection failed; check controls opt-in, root/path, redaction, and field/method",
		};
		const send = (response: unknown) => {
			if (disposed) return;
			try {
				if (
					new TextEncoder().encode(JSON.stringify(response)).byteLength >
					MAX_FRAME_BYTES - 1024
				)
					response = {
						error:
							"Inspection exceeds transport byte limit; lower maxEntries or depth. Control effects may already have happened; do not retry automatically.",
					};
			} catch {
				response = failure;
			}
			hot.send(CHANNEL + ":response", { token, tabId, id: frame.id, response });
		};
		try {
			validateRequest(frame.request);
			const result = inspector.query(frame.request);
			if (result instanceof Promise)
				void result.then(
					(value) => send({ value }),
					() => send(failure)
				);
			else send({ value: result });
		} catch {
			send(failure);
		}
	};
	const dispose = () => {
		if (disposed) return;
		hot.send(CHANNEL + ":bye", { token, tabId });
		disposed = true;
		hot.off(CHANNEL + ":request", handle);
		hot.off("vite:ws:connect", announce);
		window.removeEventListener("pageshow", announce);
	};
	hot.on(CHANNEL + ":request", handle);
	hot.on("vite:ws:connect", announce);
	window.addEventListener("pageshow", announce);
	hot.dispose(dispose);
	announce();
	return dispose;
}

export {
	mountInspectorPanel,
	type InspectorPanelOptions,
} from "./inspection/panel";
