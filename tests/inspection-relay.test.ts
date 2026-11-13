import { WebSocket } from "ws";
import {
	createInspectionRelay,
	relayRequest,
	proof,
	type BrowserPeer,
} from "../src/inspection/relay";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	createInspectorMcpServer,
	readRelayRecord,
} from "../src/inspection/mcp";
import { mkdtemp, writeFile, chmod, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInspector } from "../src/inspection/runtime";
import { Store, createStore, mount } from "../src/index";

async function setup(timeoutMs = 100) {
	const relay = await createInspectionRelay({ timeoutMs });
	const hello = (
		peer: BrowserPeer,
		tabId: string,
		token = relay.browserToken
	) =>
		relay.browserMessage(peer, "hello", {
			token,
			tabId,
			title: tabId,
			url: "http://localhost/app",
		});
	return { relay, hello };
}

test("relay correlates concurrent clients, refuses forged browser responses, and selects multiple tabs explicitly", async () => {
	const { relay, hello } = await setup(500);
	try {
		const frames: any[] = [];
		const one = {
			send: (frame: unknown) => {
				frames.push(frame);
			},
		};
		const two = {
			send: (frame: unknown) => {
				frames.push(frame);
			},
		};
		hello(one, "one");
		hello(two, "two");
		expect(await relayRequest(relay.record, { op: "tabs" })).toMatchObject({
			value: { tabs: [{ tabId: "one" }, { tabId: "two" }] },
		});
		expect(await relayRequest(relay.record, { op: "roots" })).toMatchObject({
			error: expect.stringContaining("Select tabId"),
		});
		const p1 = relayRequest(relay.record, { op: "roots" }, "one");
		const p2 = relayRequest(relay.record, { op: "roots" }, "two");
		await vi.waitFor(() => expect(frames.length).toBe(2));
		const f1 = frames.find((f) => f.tabId === "one"),
			f2 = frames.find((f) => f.tabId === "two");
		relay.browserMessage(two, "response", {
			...f1,
			response: { value: "forged" },
		});
		relay.browserMessage(two, "response", {
			...f2,
			response: { value: "two" },
		});
		relay.browserMessage(one, "response", {
			...f1,
			response: { value: "one" },
		});
		expect(await p1).toEqual({ value: "one" });
		expect(await p2).toEqual({ value: "two" });
		relay.disconnect(one);
		expect(
			await relayRequest(relay.record, { op: "roots" }, "one")
		).toMatchObject({ error: expect.stringContaining("No connected") });
	} finally {
		await relay.close();
	}
});

test("disconnects and timeouts settle outstanding requests; browser authentication is required", async () => {
	const { relay, hello } = await setup();
	try {
		let received!: () => void;
		const signal = new Promise<void>((resolve) => {
			received = resolve;
		});
		const peer = {
			send() {
				received();
			},
		};
		hello(peer, "fake", "wrong");
		expect(await relayRequest(relay.record, { op: "tabs" })).toEqual({
			value: { tabs: [] },
		});
		hello(peer, "one");
		const pending = relayRequest(relay.record, { op: "roots" });
		await signal;
		relay.disconnect(peer);
		expect(await pending).toEqual({ error: "Browser disconnected" });
		hello(peer, "one");
		expect(await relayRequest(relay.record, { op: "roots" })).toEqual({
			error: "Browser request timed out",
		});
	} finally {
		await relay.close();
	}
});

test("malformed browser responses fail explicitly, and invalid timeout configuration is rejected", async () => {
	await expect(createInspectionRelay({ timeoutMs: -1 })).rejects.toThrow(
		"Browser timeout"
	);
	const { relay, hello } = await setup();
	const peer = {
		send(frame: any) {
			relay.browserMessage(peer, "response", {
				...frame,
				response: { value: 1, error: "ambiguous" },
			});
		},
	};
	try {
		hello(peer, "one");
		expect(await relayRequest(relay.record, { op: "roots" })).toEqual({
			error: "Invalid browser response",
		});
	} finally {
		await relay.close();
	}
});

test("MCP cancellation tears down its relay request rather than waiting for the browser timeout", async () => {
	const { relay, hello } = await setup(5000);
	try {
		let received!: () => void;
		const signal = new Promise<void>((resolve) => {
			received = resolve;
		});
		const peer = {
			send() {
				received();
			},
		};
		hello(peer, "one");
		const controller = new AbortController();
		const pending = relayRequest(
			relay.record,
			{ op: "roots" },
			undefined,
			7000,
			controller.signal
		);
		await signal;
		controller.abort();
		await expect(pending).rejects.toThrow("cancelled");
		expect(await relayRequest(relay.record, { op: "tabs" })).toMatchObject({
			value: { tabs: [{ tabId: "one" }] },
		});
		await expect(
			relayRequest(
				relay.record,
				{ op: "roots" },
				undefined,
				7000,
				controller.signal
			)
		).rejects.toThrow("cancelled");
	} finally {
		await relay.close();
	}
});

test("loopback relay rejects unauthenticated access, wrong path, browser Origins, and malformed requests", async () => {
	const { relay } = await setup();
	const refused = (
		headers: Record<string, string> = {},
		url = relay.record.url
	) =>
		new Promise<number>((resolve, reject) => {
			const ws = new WebSocket(url, { headers });
			ws.on("open", () => {
				ws.close();
				reject(new Error("Unexpected authorization"));
			});
			ws.on("unexpected-response", (_req, res) => {
				res.resume();
				ws.terminate();
				resolve(res.statusCode!);
			});
			ws.on("error", () => {});
		});
	try {
		expect(await refused()).toBe(401);
		const challenge = randomBytes(32).toString("hex");
		const headers = {
			"x-rst-challenge": challenge,
			"x-rst-proof": proof(relay.record.token, "client", challenge),
		};
		expect(await refused({ ...headers, origin: "http://evil.example" })).toBe(
			401
		);
		expect(await refused(headers, relay.record.url + "/wrong")).toBe(401);
		expect(await refused({ ...headers, "x-rst-proof": "é".repeat(64) })).toBe(
			401
		);
		await expect(
			relayRequest({ ...relay.record, token: "a".repeat(64) }, { op: "tabs" })
		).rejects.toThrow("authenticated relay");
		expect(
			await relayRequest(relay.record, { op: "eval" } as any)
		).toMatchObject({ error: expect.stringContaining("Unknown operation") });
		expect(() =>
			relayRequest(
				{ ...relay.record, url: "ws://0.0.0.0:1/inspector" },
				{ op: "tabs" }
			)
		).toThrow("loopback");
	} finally {
		await relay.close();
	}
});

test("MCP tools use shared validation and relay, and relay descriptors are owner-only", async () => {
	const { relay, hello } = await setup();
	const peer = {
		send(frame: any) {
			relay.browserMessage(peer, "response", {
				...frame,
				response: {
					value:
						frame.request.op === "context"
							? { ok: true, result: "context-value" }
							: { roots: [] },
				},
			});
		},
	};
	hello(peer, "one");
	const dir = await mkdtemp(join(tmpdir(), "rst-inspector-"));
	const file = join(dir, "relay.json");
	const server = createInspectorMcpServer(() => readRelayRecord(file));
	const client = new Client({ name: "test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	try {
		await writeFile(file, JSON.stringify(relay.record), { mode: 0o600 });
		await server.connect(a);
		await client.connect(b);
		expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
			"rst_list_operations",
			"rst_list_tabs",
			"rst_list_roots",
			"rst_inspect",
			"rst_inspect_context",
			"rst_initialize_child",
			"rst_set_field",
			"rst_call_method",
		]);
		expect(
			await client.callTool({ name: "rst_list_roots", arguments: {} })
		).toMatchObject({
			isError: false,
			content: [{ type: "text", text: '{"value":{"roots":[]}}' }],
		});
		expect(
			await client.callTool({
				name: "rst_list_roots",
				arguments: { extra: "bad" },
			})
		).toMatchObject({ isError: true });
		expect(
			await client.callTool({
				name: "rst_inspect",
				arguments: { rootId: "x", depth: 99 },
			})
		).toMatchObject({ isError: true });
		expect(
			await client.callTool({
				name: "rst_inspect_context",
				arguments: {
					rootId: "x",
					path: ["leaf"],
					contextId: "page-context-1",
					depth: 2,
					maxEntries: 20,
				},
			})
		).toMatchObject({
			isError: false,
			content: [
				{
					type: "text",
					text: '{"value":{"ok":true,"result":"context-value"}}',
				},
			],
		});
		expect(
			await client.callTool({
				name: "rst_inspect_context",
				arguments: { rootId: "x", contextId: "c", maxEntries: 501 },
			})
		).toMatchObject({ isError: true });
		await chmod(file, 0o644);
		await expect(readRelayRecord(file)).rejects.toThrow("owner-only");
		const link = join(dir, "link");
		await symlink(file, link);
		await expect(readRelayRecord(link)).rejects.toThrow("owner-only");
	} finally {
		await client.close();
		await server.close();
		await relay.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("MCP field writes and async method calls reach the shared runtime, with errors and opt-in enforced", async () => {
	const { relay, hello } = await setup(500);
	class Counter extends Store {
		count = 1;
		async add(n: number) {
			await Promise.resolve();
			this.count += n;
			return this.count;
		}
		fail() {
			this.count++;
			throw new Error("private-runtime-exception");
		}
	}
	const root = mount(createStore(Counter));
	const inspector = createInspector({ controls: true });
	const readonly = createInspector();
	const { rootId } = inspector.registerRoot("Counter", root);
	readonly.registerRoot("Counter", root);
	const attach = (target: typeof inspector, tabId: string) => {
		const peer = {
			send: async (frame: any) => {
				let response;
				try {
					response = { value: await target.query(frame.request) };
				} catch {
					response = { error: "Inspection failed; check controls opt-in" };
				}
				relay.browserMessage(peer, "response", { ...frame, response });
			},
		};
		hello(peer, tabId);
	};
	attach(inspector, "controlled");
	attach(readonly, "readonly");
	const server = createInspectorMcpServer(async () => relay.record);
	const client = new Client({ name: "controls-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(a);
		await client.connect(b);
		const tools = (await client.listTools()).tools;
		for (const name of ["rst_set_field", "rst_call_method"])
			expect(tools.find((t) => t.name === name)?.annotations).toMatchObject({
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
			});
		expect(
			await client.callTool({
				name: "rst_set_field",
				arguments: { tabId: "controlled", rootId, field: "count", value: 5 },
			})
		).toMatchObject({ isError: false });
		expect(root.count).toBe(5);
		const result = await client.callTool({
			name: "rst_call_method",
			arguments: { tabId: "controlled", rootId, method: "add", args: [3] },
		});
		expect(result).toMatchObject({
			isError: false,
			content: [{ type: "text", text: '{"value":{"ok":true,"result":8}}' }],
		});
		const failed = await client.callTool({
			name: "rst_call_method",
			arguments: { tabId: "controlled", rootId, method: "fail" },
		});
		expect(failed.isError).toBe(true);
		expect(JSON.stringify(failed)).not.toContain("private-runtime-exception");
		expect(root.count).toBe(9);
		const readonlyRoots = await client.callTool({
			name: "rst_list_roots",
			arguments: { tabId: "readonly" },
		});
		const readonlyRootId = JSON.parse(
			(readonlyRoots.content as { text: string }[])[0].text
		).value.roots[0].rootId;
		for (const [name, args] of [
			["rst_set_field", { field: "count", value: 99 }],
			["rst_call_method", { method: "add", args: [99] }],
		] as const)
			expect(
				(
					await client.callTool({
						name,
						arguments: { tabId: "readonly", rootId: readonlyRootId, ...args },
					})
				).isError
			).toBe(true);
		for (const args of [
			{ field: "count" },
			{ field: "count", value: 1, extra: true },
			{ field: "constructor", value: 1 },
		])
			expect(
				(
					await client.callTool({
						name: "rst_set_field",
						arguments: { tabId: "controlled", rootId, ...args },
					})
				).isError
			).toBe(true);
		expect(root.count).toBe(9);
	} finally {
		await client.close();
		await server.close();
		await relay.close();
		inspector.dispose();
		readonly.dispose();
		root[Symbol.dispose]();
	}
});

test("lost control responses warn that execution may have happened", async () => {
	const { relay, hello } = await setup(10);
	hello({ send() {} }, "one");
	try {
		expect(
			await relayRequest(relay.record, {
				op: "call",
				rootId: "root",
				method: "add",
			})
		).toMatchObject({
			error: expect.stringContaining("control may already have run"),
		});
	} finally {
		await relay.close();
	}
});
