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
				devtools: resolve(rootDir, "src/devtools.ts"),
				"devtools-vite": resolve(rootDir, "src/devtools-vite.ts"),
				"devtools-mcp": resolve(rootDir, "src/devtools-mcp.ts"),
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
		rolldownOptions: {
			external: [
				"@preact/signals-core",
				"@preact/signals-react/runtime",
				"react",
				"ws",
				"vite",
				/^node:/,
				/^@modelcontextprotocol\/sdk\//,
			],
			output: {
				exports: "named",
			},
		},
	},
});
