import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	build: {
		emptyOutDir: true,
		minify: false,
		lib: {
			entry: resolve(rootDir, "src/index.ts"),
			name: "RStateTree",
			formats: ["es", "cjs"],
			fileName: (format) =>
				format === "es" ? "r-state-tree.js" : "r-state-tree.cjs",
		},
		rollupOptions: {
			external: ["@preact/signals-core"],
			output: {
				exports: "named",
			},
		},
	},
});
