import { test, expect } from "@playwright/test";
import { launchExtension } from "./extension-driver";

test("Chromium MV3 panel renders real app state outside the app, explicit children and opted-in controls, then reconnects", async ({
	browserName,
}) => {
	test.skip(
		browserName !== "chromium",
		"The DevTools extension is Chromium MV3 only; MCP is tested on all three browsers"
	);
	const driver = await launchExtension();
	try {
		await driver.page.goto("http://127.0.0.1:5198");
		await expect(driver.page.locator("#count")).toHaveText("1");
		await expect
			.poll(async () =>
				(await driver.targets()).some((t) => t.url.endsWith("/devtools.html"))
			)
			.toBe(true);
		// The content bridge is independent of whether the extension panel is open.
		expect(
			(await driver.targets()).some((t) => t.url.endsWith("/panel.html"))
		).toBe(false);
		const devtools = await driver.openPanel();
		await expect
			.poll(async () =>
				(await driver.targets()).some((t) => t.url.endsWith("/panel.html"))
			)
			.toBe(true);
		const panelTarget = (await driver.targets()).find((t) =>
			t.url.endsWith("/panel.html")
		)!;
		const panel = await driver.connect(panelTarget.targetId);
		const text = (selector: string) =>
			panel.evaluate(
				`document.querySelector(${JSON.stringify(selector)})?.textContent`
			);
		const click = (selector: string) =>
			panel.evaluate(
				`document.querySelector(${JSON.stringify(selector)}).click()`
			);
		const value = (name: string) => text(`[data-field="${name}"] code`);
		await expect.poll(() => text("#roots")).toContain("Counter");
		await click("#roots button");
		await expect.poll(() => value("count")).toBe("1");
		await expect.poll(() => value("lazy")).toBe("Not initialized");
		expect(await value("double")).toBe("Not evaluated");
		expect(await value("password")).toBe("Redacted");
		expect(await text("#mode")).toContain("Read-only");
		expect(
			await panel.evaluate("document.querySelectorAll('textarea').length")
		).toBe(0);
		await click("#computeds");
		await expect.poll(() => value("double")).toBe("2");
		await driver.page
			.getByRole("button", { name: "Increment app state" })
			.click();
		await click("#refresh");
		await expect.poll(() => value("count")).toBe("2");
		expect(await value("double")).toBe("4");
		expect(await value("lazy")).toBe("Not initialized");
		await devtools.screenshot("/tmp/rst-extension-live-readonly.png");
		await click("#roots button:nth-child(2)");
		await expect.poll(() => value("title")).toBe('"Live document"');
		expect(await value("upper")).toBe('"LIVE DOCUMENT"');
		await devtools.screenshot("/tmp/rst-extension-live-model.png");
		await click("#roots button");
		await expect.poll(() => value("count")).toBe("2");
		await click('[data-field="lazy"] button');
		await expect.poll(() => value("lazy")).toBe("Leaf");
		expect(await value("mountedChildren")).toBe("1");
		await click('[data-field="lazy"] button');
		await expect
			.poll(() => value("value"))
			.toBe('"Hello from an initialized child"');
		await click("#up");
		await expect.poll(() => value("count")).toBe("2");
		await click('[data-field="broken"] button');
		await expect.poll(() => text("#status")).toContain("initialization failed");
		await expect(
			driver.page.locator("[data-r-state-tree-inspector], #inspector-slot")
		).toHaveCount(0);
		// A real navigation replaces the instance/root capabilities and refreshes discovery.
		await driver.page.goto("http://127.0.0.1:5198?controls=1&activity=1");
		await expect
			.poll(() => text("#mode"))
			.toContain("Controls explicitly enabled");
		await click("#roots button");
		await expect.poll(() => value("count")).toBe("1");
		await panel.evaluate(
			`document.querySelector('[aria-label="JSON value for count"]').value = '7'`
		);
		await click('[data-field="count"] details button');
		await expect(driver.page.locator("#count")).toHaveText("7");
		await expect.poll(() => value("count")).toBe("7");
		await panel.evaluate(
			`document.querySelector('[aria-label="JSON arguments for add"]').value = '[3]'`
		);
		await click('[data-method="add"] button');
		await expect(driver.page.locator("#count")).toHaveText("10");
		await expect.poll(() => value("count")).toBe("10");
		await expect.poll(() => text("#status")).toBe("Returned: 10");
		await devtools.screenshot("/tmp/rst-extension-live-controls.png");
		await click("#operations");
		await expect.poll(() => text("#history")).toContain('"name": "add"');
		await click("#history button");
		await expect
			.poll(() =>
				panel.evaluate(
					'JSON.parse(document.querySelector("#history pre").textContent).records.length'
				)
			)
			.toBe(0);
		await driver.page.goto("http://127.0.0.1:5198?instances=2");
		await expect
			.poll(() => text("#status"))
			.toContain("Multiple registered bridges");
		expect(await text("#roots")).toBe("");
		await panel.evaluate(
			`const instances = document.querySelector("#instances"); instances.value = instances.options[1].value; instances.dispatchEvent(new Event("change"));`
		);
		await expect.poll(() => text("#roots")).not.toBe("");

		await driver.page.goto("about:blank");
		await expect.poll(() => text("#status")).toContain("No development bridge");
		await driver.page.goto("http://127.0.0.1:5198");
		await expect.poll(() => text("#mode")).toContain("Read-only");
		await click("#roots button");
		await expect.poll(() => value("count")).toBe("1");
	} finally {
		await driver.close();
	}
});
