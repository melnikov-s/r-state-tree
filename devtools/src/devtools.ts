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
import { CHANNEL, isRecord } from "./inspection/protocol";
import {
	connectExtensionBridge,
	dispatchInspection,
} from "./inspection/bridge";

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
	const disconnectExtension = connectExtensionBridge(inspector, tabId);
	let disposed = false;
	const announce = () => {
		if (!disposed)
			hot.send(CHANNEL + ":hello", {
				token,
				tabId,
				title: document.title.slice(0, 100) || "RStateTree",
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
		dispatchInspection(inspector, frame.request, (response) => {
			if (!disposed)
				hot.send(CHANNEL + ":response", {
					token,
					tabId,
					id: frame.id,
					response,
				});
		});
	};
	const dispose = () => {
		if (disposed) return;
		hot.send(CHANNEL + ":bye", { token, tabId });
		disposed = true;
		disconnectExtension();
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
