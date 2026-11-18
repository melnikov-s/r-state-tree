import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

test("MCP discovers and reads updates without any extension; selects real instances, initializes only explicitly, and gates controls", async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const client = new Client({ name: "browser-roundtrip", version: "1" });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [resolve("dist/devtools-mcp.cjs")],
			env: {
				...process.env,
				RST_INSPECTOR_RELAY_FILE: resolve(
					"tests/fixtures/live-inspector/.r-state-tree-inspector.json"
				),
			} as Record<string, string>,
		})
	);
	const tool = async (name: string, args: Record<string, unknown> = {}) => {
		const result = await client.callTool({ name, arguments: args });
		return {
			...JSON.parse((result.content as { text: string }[])[0].text),
			isError: !!result.isError,
		};
	};
	const field = (value: any, name: string) =>
		value.fields.find((f: any) => f.name === name).value;
	try {
		await page.goto("http://127.0.0.1:5198");
		await expect
			.poll(async () => (await tool("rst_list_tabs")).value.tabs.length)
			.toBe(1);
		const tabId = (await tool("rst_list_tabs")).value.tabs[0].tabId;
		const rootId = (await tool("rst_list_roots", { tabId })).value.roots[0]
			.rootId;
		const inspect = async (options = {}) =>
			(await tool("rst_inspect", { tabId, rootId, depth: 3, ...options }))
				.value;
		let state = await inspect();
		expect(field(state, "count")).toBe(1);
		expect(field(state, "double").kind).toBe("deferred");
		expect(field(await inspect({ evaluateComputeds: true }), "double")).toBe(2);
		expect(field(state, "lazy").kind).toBe("uninitialized");
		expect(JSON.stringify(state)).not.toContain(
			"fixture-secret-never-transport"
		);
		await expect(
			page.locator("[data-r-state-tree-inspector], #inspector-slot")
		).toHaveCount(0);
		await page.getByRole("button", { name: "Increment app state" }).click();
		await expect(page.locator("#count")).toHaveText("2");
		state = await inspect({ evaluateComputeds: true });
		expect(field(state, "count")).toBe(2);
		expect(field(state, "double")).toBe(4);
		expect(field(state, "lazy").kind).toBe("uninitialized");
		expect(
			(
				await tool("rst_set_field", {
					tabId,
					rootId,
					field: "count",
					value: 99,
				})
			).isError
		).toBe(true);
		expect(
			(
				await tool("rst_call_method", {
					tabId,
					rootId,
					method: "add",
					args: [99],
				})
			).isError
		).toBe(true);
		expect(field(await inspect(), "count")).toBe(2);
		expect(
			(await tool("rst_initialize_child", { tabId, rootId, field: "lazy" }))
				.value.initialized
		).toBe(1);
		state = await inspect({ evaluateComputeds: true });
		expect(field(state, "lazy").kind).toBe("Store");
		expect(field(state, "lazy").key).toBe("selected");
		expect(field(state, "mountedChildren")).toBe(1);
		const failed = await tool("rst_initialize_child", {
			tabId,
			rootId,
			field: "broken",
		});
		expect(failed.isError).toBe(true);
		expect(JSON.stringify(failed)).not.toContain(
			"fixture-error-never-transport"
		);
		const second = await context.newPage();
		await second.goto("http://127.0.0.1:5198?controls=1");
		await expect
			.poll(async () => (await tool("rst_list_tabs")).value.tabs.length)
			.toBe(2);
		expect((await tool("rst_list_roots")).error).toContain("Select tabId");
		const secondTab = (await tool("rst_list_tabs")).value.tabs.find(
			(t: any) => t.tabId !== tabId
		).tabId;
		const secondRoot = (await tool("rst_list_roots", { tabId: secondTab }))
			.value.roots[0].rootId;
		expect(
			(
				await tool("rst_set_field", {
					tabId: secondTab,
					rootId: secondRoot,
					field: "count",
					value: 10,
				})
			).value.ok
		).toBe(true);
		expect(
			(
				await tool("rst_call_method", {
					tabId: secondTab,
					rootId: secondRoot,
					method: "add",
					args: [3],
				})
			).value.result
		).toBe(13);
		await expect(second.locator("#count")).toHaveText("13");
		expect(field(await inspect(), "count")).toBe(2);
		await second.close();
		await expect
			.poll(async () => (await tool("rst_list_tabs")).value.tabs.length)
			.toBe(1);
		await page.reload();
		await expect
			.poll(
				async () => (await tool("rst_list_tabs")).value.tabs[0]?.tabId !== tabId
			)
			.toBe(true);
		expect((await tool("rst_list_roots", { tabId })).isError).toBe(true);
		expect((await tool("rst_list_roots")).value.roots[0].rootId).not.toBe(
			rootId
		);
		expect(errors).toEqual([]);
	} finally {
		await client.close();
	}
});
