import { test, expect } from "@playwright/test";

test("Props shows values and callback parameters inline, with correct scope and control opt-in", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("http://127.0.0.1:5198");
	await page.getByText("RStateTree · live inspector").click();
	const panel = page.locator("[data-r-state-tree-inspector]");
	await panel.getByRole("button", { name: "Counter", exact: true }).click();
	const props = panel.locator('[data-group="Props"]');
	await expect(props.locator('[data-field="props"]')).toHaveCount(0);
	await expect(
		props.getByRole("button", { name: "Inspect props", exact: true })
	).toHaveCount(0);
	await expect(props).not.toContainText("Observable");
	await expect(
		panel
			.getByRole("treeitem", { name: "props", exact: true })
			.locator(".tree-kind")
			.first()
	).toBeEmpty();
	await expect(props.locator('[data-field="title"]')).toContainText(
		"Counter controls"
	);
	await expect(props.locator('[data-prop-method="onAdd"]')).toContainText(
		"amount: number"
	);
	await props
		.getByLabel("Configure callback prop onAdd", { exact: true })
		.click();
	await expect(
		props.getByRole("button", { name: "Run callback prop onAdd", exact: true })
	).toBeDisabled();
	await expect(page.locator("#count")).toHaveText("1");

	await page.goto("http://127.0.0.1:5198/?controls=1");
	await page.getByText("RStateTree · live inspector").click();
	await panel.getByRole("button", { name: "Counter", exact: true }).click();
	await expect(props.locator(".overview-heading").first()).toHaveText("Props3");
	await expect(
		panel.getByRole("button", { name: "3 Props", exact: true })
	).toContainText("title · onAdd · onRename");
	await props
		.getByLabel("Configure callback prop onAdd", { exact: true })
		.click();
	const add = props.locator('[data-prop-method="onAdd"]');
	await add
		.getByRole("textbox", { name: "Parameter amount", exact: true })
		.fill("4");
	await add
		.getByRole("button", { name: "Run callback prop onAdd", exact: true })
		.click();
	await expect(page.locator("#count")).toHaveText("5");
	await expect(panel.getByRole("status")).toHaveText("Returned: 5");
	await props
		.getByLabel("Configure callback prop onRename", { exact: true })
		.click();
	const rename = props.locator('[data-prop-method="onRename"]');
	await rename
		.getByRole("textbox", { name: "Parameter title", exact: true })
		.fill("Updated by a prop method");
	await rename
		.getByRole("button", { name: "Run callback prop onRename", exact: true })
		.click();
	await expect(panel.getByRole("status")).toHaveText(
		'Returned: "Updated by a prop method"'
	);
	await expect(
		props.getByRole("textbox", { name: "Value for prop title", exact: true })
	).toHaveValue("Updated by a prop method");
	await expect(page.locator("#count")).toHaveText("5");
	await props
		.getByLabel("Configure callback prop onAdd", { exact: true })
		.click();
	await props
		.getByLabel("Configure callback prop onRename", { exact: true })
		.click();
	await panel.locator(".details-pane").evaluate((element) => {
		element.scrollTop = 0;
	});
	await panel.screenshot({
		path: `/tmp/rst-inspector-inline-props-${test.info().project.name}.png`,
	});
	await page.setViewportSize({ width: 375, height: 700 });
	expect(
		await panel
			.locator(".details-pane")
			.evaluate((element) => element.scrollWidth <= element.clientWidth)
	).toBe(true);
	expect(errors).toEqual([]);
});
