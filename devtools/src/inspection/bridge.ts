/// <reference lib="dom" />
import type { Inspector } from "./runtime.js";
import { isRecord, MAX_FRAME_BYTES, validateRequest } from "./protocol.js";

/** Same bounded protocol for both transports; no JS expressions or relay credentials. */
export function dispatchInspection(
	inspector: Inspector,
	request: unknown,
	send: (response: unknown) => void
) {
	const failure = {
		error:
			"Inspection failed; check controls opt-in, root/path, redaction, and field/method",
	};
	const reply = (response: unknown) => {
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
		send(response);
	};
	try {
		validateRequest(request);
		const result = inspector.query(request);
		if (result instanceof Promise)
			void result.then(
				(value) => reply({ value }),
				() => reply(failure)
			);
		else reply({ value: result });
	} catch {
		reply(failure);
	}
}

/** Installed only by the development Vite connection. Never inserts page UI. */
export function connectExtensionBridge(
	inspector: Inspector,
	instanceId: string
) {
	let disposed = false;
	const origin = location.origin;
	const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
	if (!local || !/^https?:$/.test(location.protocol)) return () => {};
	const receive = (event: MessageEvent) => {
		const frame: unknown = event.data;
		if (
			disposed ||
			event.source !== window ||
			event.origin !== origin ||
			!isRecord(frame) ||
			frame.source !== "r-state-tree:extension" ||
			frame.version !== 1 ||
			typeof frame.id !== "string" ||
			!/^[a-zA-Z0-9-]{1,100}$/.test(frame.id)
		)
			return;
		const reply = (payload: object) => {
			if (!disposed)
				window.postMessage(
					{
						source: "r-state-tree:page",
						version: 1,
						id: frame.id,
						instanceId,
						...payload,
					},
					origin
				);
		};
		if (frame.type === "discover") {
			reply({
				type: "instance",
				title: document.title.slice(0, 100),
				url: origin,
			});
		} else if (frame.type === "query" && frame.instanceId === instanceId) {
			try {
				if (
					new TextEncoder().encode(JSON.stringify(frame)).byteLength >
					MAX_FRAME_BYTES
				)
					return;
			} catch {
				return;
			}
			dispatchInspection(inspector, frame.request, (response) =>
				reply({ type: "response", response })
			);
		}
	};
	window.addEventListener("message", receive);
	window.postMessage(
		{ source: "r-state-tree:page", version: 1, type: "ready", instanceId },
		origin
	);
	return () => {
		disposed = true;
		window.removeEventListener("message", receive);
	};
}
