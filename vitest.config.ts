import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["tests/**/*.test.ts"],
		setupFiles: ["@tsmetadata/polyfill", "./tests/setup.ts"],
		coverage: {
			provider: "v8",
		},
	},
});
