import { test, expect } from "@playwright/test";

test("a blur save preserves the first navigation or method-configuration click", async ({
	page,
}) => {
	await page.goto("http://127.0.0.1:5198/?controls=1");
	await page.getByText("RStateTree · live inspector").click();
	const panel = page.locator("[data-r-state-tree-inspector]");
	await panel.getByRole("button", { name: "Counter", exact: true }).click();
	const count = panel.getByRole("textbox", {
		name: "Value for count",
		exact: true,
	});
	const selected = panel.locator('[aria-current="page"]');
	await count.fill("7");
	await panel
		.getByRole("button", { name: "Inspect settings", exact: true })
		.click();
	await expect(page.locator("#count")).toHaveText("7");
	await expect(selected).toHaveText("settings");
	await panel
		.getByRole("button", { name: "Go to Counter", exact: true })
		.click();
	await count.fill("8");
	await panel
		.getByRole("button", { name: "Select settings", exact: true })
		.click();
	await expect(page.locator("#count")).toHaveText("8");
	await expect(selected).toHaveText("settings");
	await panel
		.getByRole("button", { name: "Go to Counter", exact: true })
		.click();
	await count.fill("9");
	await panel.getByLabel("Configure method configure", { exact: true }).click();
	await expect(page.locator("#count")).toHaveText("9");
	await expect(panel.locator('[data-method="configure"]')).toHaveAttribute(
		"open",
		""
	);
});

test("tree workspace stays put while navigating, editing inline and supplying typed parameters", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("http://127.0.0.1:5198/?controls=1");
	await page.getByText("RStateTree · live inspector").click();
	const panel = page.locator("[data-r-state-tree-inspector]");
	await panel.getByRole("button", { name: "Counter", exact: true }).click();
	const initialBounds = await panel.locator("section").boundingBox();
	const tree = panel.getByRole("tree", { name: "Models and Stores" });
	await expect(
		tree.getByRole("button", { name: "Expand settings", exact: true })
	).toHaveCount(0);
	await expect(
		tree.getByRole("button", { name: "Expand props", exact: true })
	).toHaveCount(0);
	await tree
		.getByRole("button", { name: "Select settings", exact: true })
		.click();
	await expect(
		panel.getByRole("textbox", { name: "Value for title", exact: true })
	).toHaveValue("Counter");
	await expect(panel.locator("section")).toHaveJSProperty(
		"clientHeight",
		Math.round(initialBounds!.height)
	);
	const settingsBounds = await panel.locator("section").boundingBox();
	expect(settingsBounds).toEqual(initialBounds);
	await expect(
		tree.getByRole("treeitem", { name: "settings", exact: true })
	).toHaveAttribute("aria-selected", "true");
	await panel
		.getByRole("textbox", { name: "Value for title", exact: true })
		.fill("Inline title");
	await panel
		.getByRole("textbox", { name: "Value for title", exact: true })
		.press("Enter");
	await expect(panel.getByRole("status")).toHaveText("Saved title.");
	await panel
		.getByRole("checkbox", { name: "Value for enabled", exact: true })
		.uncheck();
	await expect(panel.getByRole("status")).toHaveText("Saved enabled.");
	await panel
		.getByRole("button", { name: "Go to Counter", exact: true })
		.click();
	await expect(
		tree.getByRole("treeitem", { name: "settings", exact: true })
	).not.toHaveAttribute("aria-expanded");
	await panel.getByLabel("Configure method configure", { exact: true }).click();
	const method = panel.locator('[data-method="configure"]');
	await expect(method).toContainText("title: string");
	await method
		.getByRole("textbox", { name: "Parameter title", exact: true })
		.fill("Typed method title");
	await method
		.getByRole("combobox", { name: "Parameter enabled", exact: true })
		.selectOption("true");
	await method
		.getByRole("combobox", { name: "Parameter density", exact: true })
		.selectOption('"compact"');
	await expect(
		method.getByRole("textbox", { name: "Parameter step", exact: true })
	).toBeDisabled();
	await method
		.getByRole("checkbox", { name: "Supply step", exact: true })
		.check();
	await method
		.getByRole("textbox", { name: "Parameter step", exact: true })
		.fill("3");
	const scroll = await panel
		.locator(".details-pane")
		.evaluate((element) => element.scrollTop);
	await panel.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(
		method.getByRole("textbox", { name: "Parameter title", exact: true })
	).toHaveValue("Typed method title");
	await expect(
		method.getByRole("checkbox", { name: "Supply step", exact: true })
	).toBeChecked();
	expect(
		await panel
			.locator(".details-pane")
			.evaluate((element) => element.scrollTop)
	).toBe(scroll);
	await panel.screenshot({
		path: `/tmp/rst-inspector-methods-${test.info().project.name}.png`,
	});
	await method
		.getByRole("button", { name: "Run method configure", exact: true })
		.click();
	await expect(panel.getByRole("status")).toHaveText(
		'Returned: "Typed method title"'
	);
	await tree
		.getByRole("button", { name: "Select settings", exact: true })
		.click();
	await expect(
		panel.getByRole("textbox", { name: "Value for title", exact: true })
	).toHaveValue("Typed method title");
	await expect(
		panel.getByRole("checkbox", { name: "Value for enabled", exact: true })
	).toBeChecked();
	await expect(
		panel.getByRole("textbox", { name: "Value for density", exact: true })
	).toHaveValue("compact");
	await expect(
		panel.getByRole("textbox", { name: "Value for step", exact: true })
	).toHaveValue("3");
	await panel.screenshot({
		path: `/tmp/rst-inspector-tree-${test.info().project.name}.png`,
	});
	await page.setViewportSize({ width: 375, height: 700 });
	for (const selector of ["section", ".tree-pane", ".details-pane"]) {
		expect(
			await panel
				.locator(selector)
				.evaluate((element) => element.scrollWidth <= element.clientWidth)
		).toBe(true);
	}
	await panel.screenshot({
		path: `/tmp/rst-inspector-tree-mobile-${test.info().project.name}.png`,
	});
	expect(errors).toEqual([]);
});
