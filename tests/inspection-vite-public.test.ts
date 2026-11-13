import { createServer } from "vite";
import { rStateTreeInspector } from "../src/devtools-vite";

test("credentials may not be placed in Vite's public directory", async () => {
	await expect(
		createServer({
			configFile: false,
			root: "/tmp/rst-public-guard",
			publicDir: "public",
			plugins: [rStateTreeInspector({ relayFile: "public/relay.json" })],
		})
	).rejects.toThrow("cannot be stored in publicDir");
});
