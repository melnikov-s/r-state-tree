import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

test("diagram, grouped overview and MCP expose ownership and Context without eager provider reads", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const client = new Client({ name: "diagram-context-test", version: "1" });
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
		expect(result.isError).not.toBe(true);
		return JSON.parse((result.content as { text: string }[])[0].text).value;
	};
	try {
		await page.goto("http://127.0.0.1:5198");
		await page.getByText("RStateTree · live inspector").click();
		const panel = page.locator("[data-r-state-tree-inspector]");
		await panel.getByRole("button", { name: "Counter", exact: true }).click();
		const rootId = (await tool("rst_list_roots")).roots[0].rootId;
		const inspect = (path: string[] = []) =>
			tool("rst_inspect", { rootId, path, depth: 1, maxEntries: 500 });
		const field = (value: any, name: string) =>
			value.fields.find((field: any) => field.name === name).value;
		const root = await inspect();
		expect(field(root, "contextReads")).toBe(0);
		expect(root.contexts).toContainEqual(
			expect.objectContaining({ name: "DemoContext", status: "provided" })
		);
		await expect(panel.locator('[data-context="DemoContext"]')).toContainText(
			"Provided here"
		);
		await expect(panel.locator('[data-group="Computed"]')).toContainText(
			"double"
		);
		await expect(panel.locator('[data-group="Methods"]')).toContainText(
			"configure"
		);
		await panel.getByLabel("Configure method add", { exact: true }).click();
		await expect(
			panel.getByRole("button", { name: "Run method add", exact: true })
		).toBeDisabled();
		await panel
			.getByRole("button", { name: "Initialize child lazy", exact: true })
			.click();
		const before = await panel.locator("section").boundingBox();
		await panel.getByRole("button", { name: "Diagram", exact: true }).click();
		await expect(
			panel.getByRole("region", { name: "Ownership diagram" })
		).toBeVisible();
		await expect(
			panel.locator("path.rst-diagram-ownership").first()
		).toBeVisible();
		expect(await panel.locator("section").boundingBox()).toEqual(before);
		await panel
			.getByRole("button", { name: "Inspect diagram lazy", exact: true })
			.click();
		await expect(panel.locator('[aria-current="page"]')).toHaveText("lazy");
		await expect(
			panel.getByRole("button", { name: "Expand diagram lazy", exact: true })
		).toHaveCount(0);
		await expect(
			panel.getByRole("button", { name: "Collapse diagram lazy", exact: true })
		).toHaveCount(0);
		await expect(panel.locator('[data-context="DemoContext"]')).toContainText(
			"Inherited from Counter"
		);
		await expect(panel.locator("path.rst-diagram-context")).toHaveCount(1);
		expect(field(await inspect(), "contextReads")).toBe(0);
		const leaf = await inspect(["lazy"]);
		const context = leaf.contexts.find(
			(context: any) => context.name === "DemoContext"
		);
		expect(context).toMatchObject({
			status: "inherited",
			providerId: rootId,
			declared: true,
		});
		const read = await tool("rst_inspect_context", {
			rootId,
			path: ["lazy"],
			contextId: context.contextId,
		});
		expect(read.ok).toBe(true);
		expect(field(read.result, "label")).toBe("Counter services");
		expect(field(await inspect(), "contextReads")).toBe(1);
		await panel
			.getByRole("button", { name: "Read Context DemoContext", exact: true })
			.click();
		await expect(panel.locator(".context-result")).toContainText(
			"Counter services"
		);
		await panel
			.getByRole("button", { name: "Zoom in diagram", exact: true })
			.click();
		const transform = await panel
			.locator(".rst-diagram-scene")
			.getAttribute("style");
		await panel.getByRole("button", { name: "Refresh", exact: true }).click();
		expect(
			await panel.locator(".rst-diagram-scene").getAttribute("style")
		).toBe(transform);
		await panel
			.getByRole("checkbox", {
				name: "Show available Context routes",
				exact: true,
			})
			.uncheck();
		await expect(panel.locator("path.rst-diagram-context")).toHaveCount(0);
		await panel
			.getByRole("checkbox", {
				name: "Show available Context routes",
				exact: true,
			})
			.check();
		await panel
			.getByRole("button", { name: "Fit diagram", exact: true })
			.click();
		await panel.screenshot({
			path: `/tmp/rst-inspector-diagram-${test.info().project.name}.png`,
		});
		await page.setViewportSize({ width: 375, height: 700 });
		await expect(panel.locator(".rst-diagram-selected")).toBeInViewport();
		for (const selector of ["section", ".diagram-pane", ".details-pane"])
			expect(
				await panel
					.locator(selector)
					.evaluate((node) => node.scrollWidth <= node.clientWidth)
			).toBe(true);
		await panel.screenshot({
			path: `/tmp/rst-inspector-diagram-mobile-${test.info().project.name}.png`,
		});
		expect(errors).toEqual([]);
	} finally {
		await client.close();
	}
});
