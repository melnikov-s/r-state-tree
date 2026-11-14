import { normalizePath, type Plugin, type WebSocketClient } from "vite";
import { resolve, relative, isAbsolute, dirname, basename } from "node:path";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { writeFile, rename, readFile, unlink } from "node:fs/promises";
import { createInspectionRelay, type BrowserPeer } from "./inspection/relay.js";
import { CHANNEL } from "./inspection/protocol.js";
import { transformInspectionSignatures } from "./inspection/signature-transform.js";
import { transformInspectionContexts } from "./inspection/context-transform.js";

export const DEFAULT_RELAY_FILE = ".r-state-tree-inspector.json";
function physicalFile(file: string): string {
	try {
		return normalizePath(resolve(realpathSync(dirname(file)), basename(file)));
	} catch {
		return normalizePath(file);
	}
}
/** Development-only local relay; virtual module is inert in production builds. */
export function rStateTreeInspector(
	options: { relayFile?: string; timeoutMs?: number } = {}
): Plugin {
	let token = "";
	let root = "";
	let recordFile = "";
	let development = false;
	const protectedFile = (id: string) => {
		const file = physicalFile(id.split("?")[0]);
		return (
			!!recordFile &&
			(file === recordFile ||
				(file.startsWith(recordFile + ".") && file.endsWith(".tmp")))
		);
	};
	return {
		name: "r-state-tree-inspector",
		enforce: "pre",
		config(config) {
			const file = normalizePath(
				resolve(
					config.root ?? process.cwd(),
					options.relayFile ?? DEFAULT_RELAY_FILE
				)
			);
			const protectedPaths = [...new Set([file, physicalFile(file)])].flatMap(
				(path) => {
					const escaped = path.replace(/[\\*?[\]{}()!+@]/g, "\\$&");
					return [escaped, escaped + ".*.tmp"];
				}
			);
			// Vite 8 defaults must be retained when supplying an fs.deny array.
			const deny = config.server?.fs?.deny ?? [
				".env",
				".env.*",
				"*.{crt,pem,key,p12,pfx,cer,der}",
				".npmrc",
				".yarnrc.yml",
				"**/.git/**",
			];
			return {
				server: { fs: { deny: [...deny, ...protectedPaths] } },
			};
		},
		configResolved(config) {
			root = config.root;
			development = config.command === "serve" && !config.isProduction;
			recordFile = physicalFile(
				resolve(root, options.relayFile ?? DEFAULT_RELAY_FILE)
			);
			if (config.command === "serve") {
				if (!config.server.fs.strict)
					throw new Error(
						"RStateTree inspection requires Vite filesystem access checks"
					);
				if (config.publicDir) {
					let publicDir = config.publicDir;
					try {
						publicDir = realpathSync(publicDir);
					} catch {
						/* missing public directory */
					}
					const path = normalizePath(relative(publicDir, recordFile));
					if (path !== ".." && !path.startsWith("../") && !isAbsolute(path))
						throw new Error(
							"RStateTree relay credentials cannot be stored in publicDir"
						);
				}
				const loopback = (host: unknown) =>
					host === undefined ||
					host === false ||
					(typeof host === "string" &&
						["localhost", "127.0.0.1", "::1"].includes(host));
				const ws = config.server.ws;
				const hmr = config.server.hmr;
				if (
					!loopback(config.server.host) ||
					(ws && !loopback(ws.host)) ||
					(typeof hmr === "object" && !loopback(hmr.host))
				)
					throw new Error(
						"RStateTree inspection requires a loopback-only Vite host"
					);
				if (
					config.server.middlewareMode ||
					(ws && (ws.server || ws.port)) ||
					(typeof hmr === "object" && (hmr.server || hmr.port))
				)
					throw new Error(
						"RStateTree inspection does not support external/middleware WebSocket servers or separate HMR ports"
					);
			}
		},
		transform(source, id) {
			const [file, query = ""] = id.split("?");
			if (
				!development ||
				file.includes("/node_modules/") ||
				/(?:^|&)(?:raw|url)(?:&|=|$)/.test(query)
			)
				return undefined;
			const contexts = transformInspectionContexts(source, file);
			return (
				transformInspectionSignatures(contexts?.code ?? source, file) ??
				contexts
			);
		},
		resolveId(id) {
			if (id === "virtual:r-state-tree-inspector")
				return "\0r-state-tree-inspector";
			return undefined;
		},
		load(id) {
			if (protectedFile(id))
				throw new Error(
					"RStateTree relay credentials cannot be loaded as app modules"
				);
			if (id === "\0r-state-tree-inspector")
				return `export const token = ${JSON.stringify(token)};`;
			return undefined;
		},
		async configureServer(server) {
			// fs.deny protects static/@fs reads; load also rejects ?raw/?url imports.
			const relay = await createInspectionRelay({
				timeoutMs: options.timeoutMs,
			});
			token = relay.browserToken;
			const file = resolve(root, options.relayFile ?? DEFAULT_RELAY_FILE);
			const temporary = `${file}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, JSON.stringify(relay.record), {
					mode: 0o600,
					flag: "wx",
				});
				await rename(temporary, file);
			} catch (error) {
				await relay.close();
				await unlink(temporary).catch(() => {});
				throw error;
			}
			const peers = new WeakMap<WebSocketClient, BrowserPeer>();
			const peerFor = (client: WebSocketClient) => {
				let peer = peers.get(client);
				if (!peer) {
					peer = {
						send(frame) {
							client.send(CHANNEL + ":request", frame);
						},
					};
					peers.set(client, peer);
					const bound = peer;
					client.socket.once("close", () => relay.disconnect(bound));
				}
				return peer;
			};
			const hello = (data: unknown, client: WebSocketClient) =>
				relay.browserMessage(peerFor(client), "hello", data);
			const bye = (data: unknown, client: WebSocketClient) =>
				relay.browserMessage(peerFor(client), "bye", data);
			const response = (data: unknown, client: WebSocketClient) =>
				relay.browserMessage(peerFor(client), "response", data);
			server.ws.on(CHANNEL + ":hello", hello);
			server.ws.on(CHANNEL + ":bye", bye);
			server.ws.on(CHANNEL + ":response", response);
			let closed = false;
			const close = async () => {
				if (closed) return;
				closed = true;
				// Vite starts the replacement before closing the old server. A reused
				// plugin instance must not clear the replacement's browser capability.
				if (token === relay.browserToken) token = "";
				server.ws.off(CHANNEL + ":hello", hello);
				server.ws.off(CHANNEL + ":bye", bye);
				server.ws.off(CHANNEL + ":response", response);
				await relay.close();
				try {
					if (
						JSON.parse(await readFile(file, "utf8")).token ===
						relay.record.token
					)
						await unlink(file);
				} catch {
					/* removed or replaced by another dev server */
				}
			};
			server.httpServer?.once("close", () => {
				void close();
			});
			// Also clean up programmatically created Vite servers.
			const originalClose = server.close.bind(server);
			server.close = async () => {
				await close();
				await originalClose();
			};
		},
	};
}
