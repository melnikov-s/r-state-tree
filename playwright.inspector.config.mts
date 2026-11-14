import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./tests/browser",
	outputDir: "./test-results/inspector",
	testMatch: "*.test.ts",
	workers: 1,
	projects: [
		{ name: "chromium", use: { browserName: "chromium" } },
		{ name: "firefox", use: { browserName: "firefox" } },
		{ name: "webkit", use: { browserName: "webkit" } },
	],
	use: { headless: true },
	webServer: {
		command: "pnpm test:inspector:serve",
		url: "http://127.0.0.1:5198",
		reuseExistingServer: false,
	},
});
