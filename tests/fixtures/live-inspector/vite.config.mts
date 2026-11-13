import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { rStateTreeInspector } from "../../../src/devtools-vite";
export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	cacheDir: fileURLToPath(
		new URL("../../../node_modules/.vite/live-inspector", import.meta.url)
	),
	plugins: [rStateTreeInspector()],
	server: { host: "127.0.0.1", port: 5198, strictPort: true },
});
