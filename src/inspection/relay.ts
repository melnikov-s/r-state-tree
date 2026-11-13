import { createServer } from "node:http";
import {
	randomBytes,
	randomUUID,
	createHmac,
	timingSafeEqual,
} from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
	isRecord,
	isInspectionResponse,
	validateRequest,
	MAX_FRAME_BYTES,
	type InspectionRequest,
} from "./protocol";

export type RelayRecord = { version: 1; url: string; token: string };
export type BrowserPeer = { send(frame: unknown): void };
type Tab = { tabId: string; title: string; url: string; peer: BrowserPeer };
type Pending = {
	client: WebSocket;
	id: string;
	tab: Tab;
	control: boolean;
	timer: ReturnType<typeof setTimeout>;
};
const rawText = (raw: RawData) =>
	(Array.isArray(raw)
		? Buffer.concat(raw)
		: Buffer.isBuffer(raw)
			? raw
			: Buffer.from(raw)
	).toString("utf8");
export const proof = (token: string, role: string, challenge: string) =>
	createHmac("sha256", token).update(`${role}:${challenge}`).digest("hex");
function equal(a: unknown, b: string) {
	if (typeof a !== "string") return false;
	const actual = Buffer.from(a);
	const expected = Buffer.from(b);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Separate loopback listener. Never binds to 0.0.0.0, never accepts browser Origins. */
export async function createInspectionRelay(
	options: { timeoutMs?: number } = {}
) {
	if (
		options.timeoutMs !== undefined &&
		(!Number.isInteger(options.timeoutMs) ||
			options.timeoutMs < 1 ||
			options.timeoutMs > 6000)
	)
		throw new Error("Browser timeout must be an integer from 1 to 6000 ms");
	const token = randomBytes(32).toString("hex");
	const browserToken = randomBytes(32).toString("hex");
	const tabs = new Map<string, Tab>();
	const pending = new Map<string, Pending>();
	const http = createServer((_req, res) => {
		res.writeHead(404);
		res.end();
	});
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_FRAME_BYTES,
	});
	const send = (client: WebSocket, frame: unknown) => {
		if (client.readyState === WebSocket.OPEN)
			client.send(JSON.stringify(frame));
	};
	const finish = (id: string, response: unknown) => {
		const item = pending.get(id);
		if (!item) return;
		pending.delete(id);
		clearTimeout(item.timer);
		if (
			item.control &&
			isRecord(response) &&
			typeof response.error === "string"
		)
			response = {
				error:
					response.error +
					"; control may already have run. Inspect state before retrying.",
			};
		send(item.client, { id: item.id, response });
	};
	http.on("upgrade", (req, socket, head) => {
		socket.on("error", () => socket.destroy());
		const challenge = req.headers["x-rst-challenge"];
		const port = (http.address() as { port: number }).port;
		if (
			req.url !== "/inspector" ||
			req.headers.host !== `127.0.0.1:${port}` ||
			req.headers.origin ||
			typeof challenge !== "string" ||
			!/^[a-f0-9]{64}$/.test(challenge) ||
			!equal(req.headers["x-rst-proof"], proof(token, "client", challenge)) ||
			wss.clients.size >= 32
		) {
			socket.end(
				"HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
			);
			return;
		}
		wss.handleUpgrade(req, socket, head, (client) =>
			wss.emit("connection", client, req)
		);
	});
	wss.on("headers", (headers, req) =>
		headers.push(
			`X-Rst-Proof: ${proof(token, "server", String(req.headers["x-rst-challenge"]))}`
		)
	);
	wss.on("connection", (client) => {
		client.on("error", () => {
			/* close cancels outstanding requests */
		});
		client.on("close", () => {
			for (const [id, p] of pending)
				if (p.client === client) {
					clearTimeout(p.timer);
					pending.delete(id);
				}
		});
		client.on("message", (raw) => {
			let originalId = "invalid";
			try {
				const frame: unknown = JSON.parse(rawText(raw));
				if (
					!isRecord(frame) ||
					typeof frame.id !== "string" ||
					frame.id.length > 100
				)
					throw new Error("Invalid frame");
				originalId = frame.id;
				if (
					Object.keys(frame).some(
						(k) => !["id", "tabId", "request"].includes(k)
					)
				)
					throw new Error("Invalid frame keys");
				if (
					isRecord(frame.request) &&
					frame.request.op === "tabs" &&
					Object.keys(frame.request).length === 1
				) {
					send(client, {
						id: originalId,
						response: {
							value: {
								tabs: [...tabs.values()].map(({ tabId, title, url }) => ({
									tabId,
									title,
									url,
								})),
							},
						},
					});
					return;
				}
				validateRequest(frame.request);
				if (
					frame.tabId !== undefined &&
					(typeof frame.tabId !== "string" || frame.tabId.length > 100)
				)
					throw new Error("Invalid tabId");
				if (!frame.tabId && tabs.size !== 1)
					throw new Error(
						"Select tabId with rst_list_tabs (exactly one tab required otherwise)"
					);
				const tab = frame.tabId
					? tabs.get(frame.tabId as string)
					: tabs.values().next().value;
				if (!tab) throw new Error("No connected tab; open the development app");
				if (pending.size >= 100)
					throw new Error("Too many outstanding requests");
				const id = randomUUID();
				const timer = setTimeout(
					() => finish(id, { error: "Browser request timed out" }),
					options.timeoutMs ?? 5000
				);
				pending.set(id, {
					client,
					id: originalId,
					tab,
					timer,
					control: frame.request.op === "set" || frame.request.op === "call",
				});
				try {
					tab.peer.send({
						id,
						tabId: tab.tabId,
						token: browserToken,
						request: frame.request,
					});
				} catch {
					finish(id, { error: "Browser send failed" });
				}
			} catch (error) {
				send(client, {
					id: originalId,
					response: {
						error: error instanceof Error ? error.message : "Invalid request",
					},
				});
			}
		});
	});
	await new Promise<void>((resolve, reject) => {
		http.once("error", reject);
		http.listen(0, "127.0.0.1", resolve);
	});
	const record: RelayRecord = {
		version: 1,
		url: `ws://127.0.0.1:${(http.address() as { port: number }).port}/inspector`,
		token,
	};
	function disconnect(peer: BrowserPeer, tabId?: string) {
		for (const [id, tab] of tabs)
			if (tab.peer === peer && (!tabId || id === tabId)) {
				tabs.delete(id);
				for (const [requestId, p] of pending)
					if (p.tab === tab)
						finish(requestId, { error: "Browser disconnected" });
			}
	}
	return {
		record,
		browserToken,
		browserMessage(
			peer: BrowserPeer,
			event: "hello" | "bye" | "response",
			data: unknown
		) {
			if (
				!isRecord(data) ||
				!equal(data.token, browserToken) ||
				typeof data.tabId !== "string" ||
				!/^[a-zA-Z0-9-]{1,100}$/.test(data.tabId)
			)
				return;
			if (event === "hello") {
				if (
					typeof data.title !== "string" ||
					typeof data.url !== "string" ||
					data.title.length > 100 ||
					data.url.length > 2048
				)
					return;
				// A page id is bound to its actual HMR socket, not an arbitrary claimed id.
				const previous = tabs.get(data.tabId);
				if (previous && previous.peer !== peer) return;
				if (!previous && tabs.size >= 100) return;
				if (!previous)
					tabs.set(data.tabId, {
						tabId: data.tabId,
						title: data.title,
						url: data.url,
						peer,
					});
			} else if (tabs.get(data.tabId)?.peer === peer) {
				if (event === "bye") {
					disconnect(peer, data.tabId);
					return;
				}
				if (typeof data.id !== "string") return;
				const p = pending.get(data.id);
				if (!p || p.tab.peer !== peer || p.tab.tabId !== data.tabId) return;
				try {
					if (
						!isInspectionResponse(data.response) ||
						Buffer.byteLength(JSON.stringify(data.response), "utf8") >
							MAX_FRAME_BYTES - 1024
					)
						throw new Error("Invalid response");
					finish(data.id, data.response);
				} catch {
					finish(data.id, { error: "Invalid browser response" });
				}
			}
		},
		disconnect,
		async close() {
			for (const id of pending.keys()) finish(id, { error: "Relay closed" });
			tabs.clear();
			for (const client of wss.clients) client.terminate();
			await new Promise<void>((resolve) => wss.close(() => resolve()));
			await new Promise<void>((resolve) => http.close(() => resolve()));
		},
	};
}

/** One bounded connection per call; correlation is rewritten and socket-bound by the relay. */
export function relayRequest(
	record: RelayRecord,
	request: InspectionRequest | { op: "tabs" },
	tabId?: string,
	timeoutMs = 7000,
	signal?: AbortSignal
): Promise<unknown> {
	const url = new URL(record.url);
	if (
		record.version !== 1 ||
		url.protocol !== "ws:" ||
		url.hostname !== "127.0.0.1" ||
		url.pathname !== "/inspector" ||
		url.search ||
		url.hash ||
		url.username ||
		url.password ||
		!/^[a-f0-9]{64}$/.test(record.token)
	)
		throw new Error("Invalid loopback relay record");
	if (signal?.aborted)
		return Promise.reject(new Error("Inspection request cancelled"));
	return new Promise((resolve, reject) => {
		const challenge = randomBytes(32).toString("hex");
		const id = randomUUID();
		let authenticated = false;
		const ws = new WebSocket(record.url, {
			headers: {
				"x-rst-challenge": challenge,
				"x-rst-proof": proof(record.token, "client", challenge),
			},
			maxPayload: MAX_FRAME_BYTES,
			handshakeTimeout: timeoutMs,
		});
		const timer = setTimeout(
			() => done(new Error("Relay timed out")),
			timeoutMs
		);
		let settled = false;
		const abort = () => done(new Error("Inspection request cancelled"));
		function done(error?: Error, value?: unknown) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			if (error || ws.readyState === WebSocket.CONNECTING) ws.terminate();
			else ws.close();
			if (error) reject(error);
			else resolve(value);
		}
		ws.on("upgrade", (response) => {
			authenticated = equal(
				response.headers["x-rst-proof"],
				proof(record.token, "server", challenge)
			);
		});
		ws.on("open", () => {
			if (!authenticated) {
				done(new Error("Relay authentication failed"));
				return;
			}
			ws.send(JSON.stringify({ id, tabId, request }));
		});
		ws.on("error", () =>
			done(
				new Error(
					"Cannot connect to authenticated relay; start the Vite dev server"
				)
			)
		);
		ws.on("close", () => done(new Error("Relay disconnected")));
		ws.on("message", (raw) => {
			try {
				const frame: unknown = JSON.parse(rawText(raw));
				if (isRecord(frame) && frame.id === id) {
					if (
						Object.keys(frame).some((k) => !["id", "response"].includes(k)) ||
						!isInspectionResponse(frame.response)
					)
						throw new Error("Invalid response");
					done(undefined, frame.response);
				}
			} catch {
				done(new Error("Malformed relay response"));
			}
		});
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
	});
}
