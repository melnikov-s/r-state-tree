import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rStateTreeInspector } from "../../devtools/src/devtools-vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("HMR disconnect, back navigation, and Vite restart recover through the same stdio MCP process", async ({
	page,
}) => {
	const dir = await mkdtemp(join(tmpdir(), "rst-browser-lifecycle-"));
	const file = join(dir, "relay.json");
	const server = await createServer({
		configFile: false,
		root: resolve("tests/fixtures/live-inspector"),
		logLevel: "silent",
		server: { host: "127.0.0.1", port: 0 },
		plugins: [rStateTreeInspector({ relayFile: file })],
	});
	const client = new Client({ name: "lifecycle-roundtrip", version: "1" });
	try {
		await server.listen();
		const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
		await client.connect(
			new StdioClientTransport({
				command: process.execPath,
				args: [resolve("dist/devtools-mcp.cjs")],
				env: { ...process.env, RST_INSPECTOR_RELAY_FILE: file } as Record<
					string,
					string
				>,
			})
		);
		const tool = async (name: string, args: Record<string, unknown> = {}) => {
			const result = await client.callTool({ name, arguments: args });
			return {
				result: JSON.parse((result.content as { text: string }[])[0].text),
				isError: !!result.isError,
			};
		};
		const connected = async () => {
			try {
				return (await tool("rst_list_tabs")).result.value?.tabs.length === 1;
			} catch {
				return false;
			}
		};
		await page.goto(origin);
		await expect.poll(connected).toBe(true);
		const originalTab = (await tool("rst_list_tabs")).result.value.tabs[0]
			.tabId;
		// Exercise a real socket failure rather than a mock reconnect event.
		const loaded = page.waitForEvent("load");
		for (const peer of server.ws.clients) peer.socket.terminate();
		await loaded;
		await expect
			.poll(async () => {
				const tabs = (await tool("rst_list_tabs")).result.value.tabs;
				return tabs.length === 1 && tabs[0].tabId !== originalTab;
			})
			.toBe(true);
		await page.goto("about:blank");
		await expect
			.poll(async () => (await tool("rst_list_tabs")).result.value.tabs.length)
			.toBe(0);
		await page.goBack();
		await expect.poll(connected).toBe(true);
		const before = JSON.parse(await readFile(file, "utf8"));
		const reloaded = page.waitForEvent("load");
		await server.restart();
		await reloaded;
		await expect.poll(connected, { timeout: 15000 }).toBe(true);
		const after = JSON.parse(await readFile(file, "utf8"));
		expect(after.token).not.toBe(before.token);
		const root = (await tool("rst_list_roots")).result.value.roots[0].rootId;
		const state = (await tool("rst_inspect", { rootId: root })).result.value;
		expect(state.fields.find((f: any) => f.name === "count").value).toBe(1);
		expect(state.fields.find((f: any) => f.name === "lazy").value.kind).toBe(
			"uninitialized"
		);
	} finally {
		await page.close();
		await client.close();
		await server.close();
		await rm(dir, { recursive: true, force: true });
	}
});
