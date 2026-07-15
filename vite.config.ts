import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	build: {
		emptyOutDir: true,
		minify: false,
		lib: {
			entry: {
				index: resolve(rootDir, "src/index.ts"),
				react: resolve(rootDir, "src/react.ts"),
			},
			name: "RStateTree",
			formats: ["es", "cjs"],
			fileName: (format, entryName) => {
				if (entryName === "index") {
					return format === "es" ? "r-state-tree.js" : "r-state-tree.cjs";
				}

				return format === "es" ? `${entryName}.js` : `${entryName}.cjs`;
			},
		},
		rollupOptions: {
			external: [
				"@preact/signals-core",
				"@preact/signals-react/runtime",
				"react",
			],
			output: {
				exports: "named",
			},
		},
	},
});
