import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

test("actual browser → Vite HMR → authenticated relay → stdio MCP → live state", async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const client = new Client({ name: "browser-roundtrip", version: "1" });
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [resolve("dist/devtools-mcp.cjs")],
		env: {
			...process.env,
			RST_INSPECTOR_RELAY_FILE: resolve(
				"tests/fixtures/live-inspector/.r-state-tree-inspector.json"
			),
		} as Record<string, string>,
	});
	await client.connect(transport);
	const tool = async (name: string, args: Record<string, unknown> = {}) => {
		const result = await client.callTool({ name, arguments: args });
		const text = (result.content as { text: string }[])[0].text;
		try {
			return { ...JSON.parse(text), isError: !!result.isError };
		} catch {
			return { error: text, isError: true };
		}
	};
	const field = (value: any, name: string) =>
		value.fields.find((f: any) => f.name === name);
	try {
		await page.goto("http://127.0.0.1:5198");
		await expect
			.poll(async () => (await tool("rst_list_tabs")).value.tabs.length)
			.toBe(1);
		const tabs = (await tool("rst_list_tabs")).value.tabs;
		const tabId = tabs[0].tabId;
		const roots = (await tool("rst_list_roots", { tabId })).value.roots;
		expect(roots).toHaveLength(1);
		const rootId = roots[0].rootId;
		const inspect = async () =>
			(await tool("rst_inspect", { tabId, rootId, depth: 3 })).value;
		let value = await inspect();
		expect(field(value, "count").value).toBe(1);
		expect(field(value, "double").value).toBe(2);
		expect(field(value, "lazy").value.kind).toBe("uninitialized");
		expect(JSON.stringify(value)).not.toContain(
			"fixture-secret-never-transport"
		);
		await page.getByRole("button", { name: "Increment app state" }).click();
		await expect(page.locator("#count")).toHaveText("2");
		value = await inspect();
		expect(field(value, "count").value).toBe(2);
		expect(field(value, "double").value).toBe(4);
		await page.getByText("RStateTree · live inspector").click();
		await page.getByRole("button", { name: "Counter", exact: true }).click();
		const panel = page.locator("[data-r-state-tree-inspector]");
		const lazyRow = panel.locator('.row[data-field="lazy"]');
		await expect(lazyRow).toContainText("Not initialized");
		await expect(
			panel.locator('.row[data-field="count"] .value-text')
		).toHaveText("2");
		await expect(
			panel.locator('.row[data-field="double"] .field-meta')
		).toHaveText("Computed");
		await expect(
			panel.locator('.row[data-field="password"] .value-text')
		).toHaveText("Redacted");
		await expect(panel.locator("section")).not.toContainText('"kind"');
		await expect(panel.locator("section")).not.toContainText('"id"');
		await panel.screenshot({
			path: `/tmp/rst-live-inspector-readable-${test.info().project.name}.png`,
		});
		await lazyRow
			.getByRole("button", { name: "Initialize child lazy" })
			.click();
		value = await inspect();
		expect(field(value, "lazy").value.kind).toBe("Store");
		expect(field(value, "lazy").value.key).toBe("selected");
		expect(field(value, "mountedChildren").value).toBe(1);
		// Subtree navigation uses the same live selection API as MCP.
		await lazyRow
			.getByRole("button", { name: "Inspect lazy", exact: true })
			.click();
		await expect(
			page.getByText("Hello from an initialized child", { exact: false })
		).toBeVisible();
		await page.getByRole("button", { name: "Up", exact: true }).click();
		// Failed explicit initialization is visible in UI and a tool error, not a false success.
		await panel
			.getByRole("button", { name: "Initialize child broken" })
			.click();
		await expect(panel.getByRole("alert")).toHaveText(
			"Could not initialize broken. Error details are hidden."
		);
		const failed = await tool("rst_initialize_child", {
			tabId,
			rootId,
			field: "broken",
		});
		expect(failed.isError).toBe(true);
		expect(failed.value).toMatchObject({
			initialized: 0,
			errors: [{ kind: "error" }],
		});
		expect(JSON.stringify(failed)).not.toContain(
			"fixture-error-never-transport"
		);
		await page.screenshot({
			path: `/tmp/rst-live-inspector-${test.info().project.name}.png`,
		});
		await page.setViewportSize({ width: 375, height: 700 });
		const bounds = await panel.boundingBox();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
		expect(
			await panel
				.locator("section")
				.evaluate((node) => node.scrollWidth <= node.clientWidth)
		).toBe(true);
		await expect(
			panel.getByRole("button", { name: "Inspect lazy" })
		).toBeVisible();
		await page.screenshot({
			path: `/tmp/rst-live-inspector-mobile-${test.info().project.name}.png`,
		});
		await page.setViewportSize({ width: 1280, height: 720 });
		// Second real tab: MCP must refuse an ambiguous implicit target.
		const second = await context.newPage();
		await second.goto("http://127.0.0.1:5198");
		await expect
			.poll(async () => (await tool("rst_list_tabs")).value.tabs.length)
			.toBe(2);
		expect((await tool("rst_list_roots")).error).toContain("Select tabId");
		const secondTab = (await tool("rst_list_tabs")).value.tabs.find(
			(t: any) => t.tabId !== tabId
		);
		const secondRoot = (
			await tool("rst_list_roots", { tabId: secondTab.tabId })
		).value.roots[0].rootId;
		expect(
			(
				await tool("rst_initialize_child", {
					tabId: secondTab.tabId,
					rootId: secondRoot,
					field: "lazy",
				})
			).value.initialized
		).toBe(1);
		expect(
			field(
				(
					await tool("rst_inspect", {
						tabId: secondTab.tabId,
						rootId: secondRoot,
					})
				).value,
				"mountedChildren"
			).value
		).toBe(1);
		await second.close();
		await expect
			.poll(async () => (await tool("rst_list_tabs")).value.tabs.length)
			.toBe(1);
		// A full navigation removes old page/root IDs and registers the replacement.
		await page.reload();
		await expect
			.poll(async () => {
				const tabs = (await tool("rst_list_tabs")).value.tabs;
				return tabs.length === 1 && tabs[0].tabId !== tabId;
			})
			.toBe(true);
		expect((await tool("rst_list_roots", { tabId })).isError).toBe(true);
		const replacementRoot = (await tool("rst_list_roots")).value.roots[0]
			.rootId;
		expect(replacementRoot).not.toBe(rootId);
		expect(
			field(
				(await tool("rst_inspect", { rootId: replacementRoot })).value,
				"lazy"
			).value.kind
		).toBe("uninitialized");
		await page.close();
		await expect
			.poll(async () => (await tool("rst_list_tabs")).value.tabs.length)
			.toBe(0);
		expect(errors).toEqual([]);
	} finally {
		await client.close();
	}
});
