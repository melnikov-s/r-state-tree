import { test, expect } from "@playwright/test";

test("fullscreen startup fills the app viewport and preserves the inspector when restored", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("http://127.0.0.1:5198/?controls=1&fullscreen=1");
	const panel = page.locator("[data-r-state-tree-inspector]");
	await expect(panel).toHaveAttribute("data-fullscreen", "");
	await expect(panel).toHaveAttribute("role", "dialog");
	await expect(panel).toHaveAttribute("aria-modal", "true");
	const viewport = page.viewportSize()!;
	expect(await panel.boundingBox()).toEqual({
		x: 0,
		y: 0,
		width: viewport.width,
		height: viewport.height,
	});
	const section = await panel.locator("section").boundingBox();
	expect(section!.y + section!.height).toBeGreaterThanOrEqual(
		viewport.height - 2
	);
	await panel.getByRole("button", { name: "Counter", exact: true }).click();
	await panel
		.getByLabel("Configure callback prop onRename", { exact: true })
		.click();
	const draft = panel
		.locator('[data-prop-method="onRename"]')
		.getByRole("textbox", { name: "Parameter title", exact: true });
	await draft.fill("Unsubmitted argument");
	await panel
		.getByRole("button", { name: "Exit fullscreen", exact: true })
		.click();
	await expect(panel).not.toHaveAttribute("data-fullscreen");
	await expect(panel).not.toHaveAttribute("aria-modal");
	await expect(draft).toHaveValue("Unsubmitted argument");
	await expect(panel.locator('[aria-current="page"]')).toHaveText("Counter");
	expect((await panel.boundingBox())!.width).toBeLessThan(viewport.width);
	await panel.getByRole("button", { name: "Fullscreen", exact: true }).click();
	const count = panel.getByRole("textbox", {
		name: "Value for count",
		exact: true,
	});
	await count.fill("99");
	await count.press("Escape");
	await expect(count).toHaveValue("1");
	await expect(panel).toHaveAttribute("data-fullscreen", "");
	await expect(page.locator("#count")).toHaveText("1");
	// Tab wraps inside the inspector, never into the covered application.
	await panel.evaluate((host) => {
		const root = host.shadowRoot!;
		const elements = [
			...root.querySelectorAll<HTMLElement>(
				"button,input,select,textarea,summary,[tabindex]"
			),
		].filter(
			(node) =>
				node.tabIndex >= 0 &&
				!node.matches(":disabled") &&
				node.getClientRects().length > 0
		);
		elements.at(-1)!.focus();
	});
	await page.keyboard.press("Tab");
	expect(
		await panel.evaluate((host) => {
			const root = host.shadowRoot!;
			const elements = [
				...root.querySelectorAll<HTMLElement>(
					"button,input,select,textarea,summary,[tabindex]"
				),
			].filter(
				(node) =>
					node.tabIndex >= 0 &&
					!node.matches(":disabled") &&
					node.getClientRects().length > 0
			);
			return root.activeElement === elements[0];
		})
	).toBe(true);
	await page.setViewportSize({ width: 375, height: 700 });
	expect(await panel.boundingBox()).toEqual({
		x: 0,
		y: 0,
		width: 375,
		height: 700,
	});
	expect(
		await panel
			.locator("section")
			.evaluate((node) => node.scrollWidth <= node.clientWidth)
	).toBe(true);
	await panel.screenshot({
		path: `/tmp/rst-inspector-fullscreen-${test.info().project.name}.png`,
	});
	await page.keyboard.press("Escape");
	await expect(panel).not.toHaveAttribute("data-fullscreen");
	expect(
		await page.evaluate(() => document.documentElement.style.overflow)
	).toBe("");
	expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
	expect(errors).toEqual([]);
});

test("embedded inspector fills its app pane, escapes clipping for fullscreen, and returns to the same pane", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("http://127.0.0.1:5198/?layout=embedded&controls=1");
	const slot = page.locator("#inspector-slot");
	const panel = page.locator("[data-r-state-tree-inspector]");
	await expect(
		panel.getByRole("button", { name: "Counter", exact: true })
	).toBeVisible();
	await expect(slot.locator("[data-r-state-tree-inspector]")).toHaveCount(1);
	await expect(panel).toHaveAttribute("data-inspector-layout", "embedded");
	expect(await panel.boundingBox()).toEqual(await slot.boundingBox());
	const initialSection = await panel.locator("section").boundingBox();
	const original = (await slot.boundingBox())!;
	expect(initialSection!.y + initialSection!.height).toBeGreaterThanOrEqual(
		original.y + original.height - 2
	);
	await panel.getByRole("button", { name: "Counter", exact: true }).click();
	await panel.getByRole("button", { name: "Fullscreen", exact: true }).click();
	await expect(slot.locator("[data-r-state-tree-inspector]")).toHaveCount(0);
	expect(await panel.boundingBox()).toEqual({
		x: 0,
		y: 0,
		...page.viewportSize()!,
	});
	await page.keyboard.press("Escape");
	await expect(slot.locator("[data-r-state-tree-inspector]")).toHaveCount(1);
	expect(await panel.boundingBox()).toEqual(await slot.boundingBox());
	await expect(panel.locator('[aria-current="page"]')).toHaveText("Counter");
	await slot.evaluate((node) => {
		node.style.width = "700px";
		node.style.height = "430px";
	});
	await expect(panel).toHaveCSS("height", "430px");
	expect(await panel.boundingBox()).toEqual(await slot.boundingBox());
	await panel.screenshot({
		path: `/tmp/rst-inspector-embedded-${test.info().project.name}.png`,
	});
	// Layout responds to the pane's width, not the wider application window.
	await slot.evaluate((node) => {
		node.style.width = "350px";
		node.style.height = "550px";
	});
	await expect(
		panel.getByRole("button", { name: "Fullscreen", exact: true })
	).toBeInViewport();
	expect(
		await panel
			.locator("section")
			.evaluate((node) => node.scrollWidth <= node.clientWidth)
	).toBe(true);
	await panel.getByRole("button", { name: "Diagram", exact: true }).click();
	expect(
		(await panel.locator(".diagram-pane").boundingBox())!.width
	).toBeGreaterThan(300);
	expect(
		await panel
			.locator("section")
			.evaluate((node) => node.scrollWidth <= node.clientWidth)
	).toBe(true);
	// Starting fullscreen from an embedded mount retains the return container too.
	await page.goto("http://127.0.0.1:5198/?layout=embedded&fullscreen=1");
	await expect(panel).toHaveAttribute("data-fullscreen", "");
	await page.keyboard.press("Escape");
	await expect(slot.locator("[data-r-state-tree-inspector]")).toHaveCount(1);
	await expect(panel).toHaveAttribute("data-inspector-layout", "embedded");
	expect(errors).toEqual([]);
});
