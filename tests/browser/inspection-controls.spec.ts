import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

test("panel and real stdio MCP control the same running app only after consumer opt-in", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const client = new Client({ name: "browser-controls", version: "1" });
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
		const text = (result.content as { text: string }[])[0].text;
		try {
			return { ...JSON.parse(text), isError: !!result.isError };
		} catch {
			return { error: text, isError: true };
		}
	};
	try {
		await page.goto("http://127.0.0.1:5198");
		await expect
			.poll(async () => (await tool("rst_list_tabs")).value.tabs.length)
			.toBe(1);
		const oldTabId = (await tool("rst_list_tabs")).value.tabs[0].tabId;
		let rootId = (await tool("rst_list_roots")).value.roots[0].rootId;
		expect(
			(await tool("rst_set_field", { rootId, field: "count", value: 99 }))
				.isError
		).toBe(true);
		expect(
			(await tool("rst_call_method", { rootId, method: "add", args: [99] }))
				.isError
		).toBe(true);
		await expect(page.locator("#count")).toHaveText("1");

		await page.goto("http://127.0.0.1:5198/?controls=1");
		await expect
			.poll(async () => {
				const tabs = (await tool("rst_list_tabs")).value.tabs;
				return tabs.length === 1 && tabs[0].tabId !== oldTabId;
			})
			.toBe(true);
		rootId = (await tool("rst_list_roots")).value.roots[0].rootId;
		const inspected = (await tool("rst_inspect", { rootId })).value;
		expect(inspected.controls).toBe(true);
		expect(inspected.methods).toContainEqual(
			expect.objectContaining({
				name: "add",
				parameters: [
					expect.objectContaining({
						name: "amount",
						type: "number",
						kind: "number",
					}),
				],
			})
		);
		await page.getByText("RStateTree · live inspector").click();
		await page.getByRole("button", { name: "Counter", exact: true }).click();
		const panel = page.locator("[data-r-state-tree-inspector]");
		await expect(panel.locator(".controls-warning")).toContainText(
			"real services"
		);
		await expect(
			panel.getByRole("textbox", { name: "Value for password", exact: true })
		).toHaveCount(0);
		const countInput = panel.getByRole("textbox", {
			name: "Value for count",
			exact: true,
		});
		await countInput.fill("10");
		await countInput.press("Enter");
		await expect(page.locator("#count")).toHaveText("10");
		await expect(panel.getByRole("status")).toHaveText("Saved count.");

		await panel.getByLabel("Configure method add", { exact: true }).click();
		await panel
			.getByRole("textbox", { name: "Parameter amount", exact: true })
			.fill("2");
		await panel
			.getByRole("button", { name: "Run method add", exact: true })
			.click();
		await expect(page.locator("#count")).toHaveText("12");
		await expect(panel.getByRole("status")).toHaveText("Returned: 12");
		expect(
			(await tool("rst_inspect", { rootId })).value.fields.find(
				(f: any) => f.name === "count"
			).value
		).toBe(12);

		expect(
			(await tool("rst_set_field", { rootId, field: "count", value: 20 }))
				.isError
		).toBe(false);
		await expect(page.locator("#count")).toHaveText("20");
		expect(
			(await tool("rst_call_method", { rootId, method: "add", args: [3] }))
				.value
		).toEqual({ ok: true, result: 23 });
		await expect(page.locator("#count")).toHaveText("23");
		await panel.getByRole("button", { name: "Refresh", exact: true }).click();
		await expect(countInput).toHaveValue("23");

		const failed = await tool("rst_call_method", { rootId, method: "fail" });
		expect(failed.isError).toBe(true);
		expect(failed.value.error).toContain("state may have changed");
		expect(JSON.stringify(failed)).not.toContain(
			"fixture-error-never-transport"
		);
		await expect(page.locator("#count")).toHaveText("24");
		for (const [name, args] of [
			["rst_set_field", { field: "password", value: "changed" }],
			["rst_set_field", { field: "lazy", value: null }],
			["rst_call_method", { method: "constructor" }],
			["rst_call_method", { method: "effect" }],
		] as const)
			expect((await tool(name, { rootId, ...args })).isError).toBe(true);
		await expect(page.locator("#count")).toHaveText("24");
		await panel.getByLabel("Configure method fail", { exact: true }).click();
		await panel
			.getByRole("button", { name: "Run method fail", exact: true })
			.click();
		await expect(panel.getByRole("alert")).toContainText(
			"state may have changed"
		);
		await expect(page.locator("#count")).toHaveText("25");
		await page.setViewportSize({ width: 375, height: 700 });
		await expect(countInput).toBeVisible();
		expect(
			await panel
				.locator("section")
				.evaluate((node) => node.scrollWidth <= node.clientWidth)
		).toBe(true);
		await panel.screenshot({
			path: `/tmp/rst-inspector-controls-${test.info().project.name}.png`,
		});
		expect(errors).toEqual([]);
		await page.close();
	} finally {
		await client.close();
	}
});
