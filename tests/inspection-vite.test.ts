import { createServer, build } from "vite";
import { fileURLToPath } from "node:url";
import { rStateTreeInspector } from "../devtools/src/devtools-vite";
import { readRelayRecord } from "../devtools/src/inspection/mcp";
import { relayRequest } from "../devtools/src/inspection/relay";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Vite plugin publishes a private record, serves a distinct browser capability, and cleans up", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rst-vite-"));
	const file = join(dir, "relay.json");
	// Create .env before Vite starts watching: changing it while listening restarts Vite.
	await writeFile(join(dir, ".env"), "INSPECTOR_FIXTURE_ENV=ENV_SECRET");
	const server = await createServer({
		configFile: false,
		root: dir,
		server: { host: "127.0.0.1", port: 0 },
		logLevel: "silent",
		resolve: { alias: { "/alias.json": file } },
		plugins: [rStateTreeInspector({ relayFile: file })],
	});
	try {
		const record = await readRelayRecord(file);
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		expect(await relayRequest(record, { op: "tabs" })).toEqual({
			value: { tabs: [] },
		});
		const module = await server.pluginContainer.resolveId(
			"virtual:r-state-tree-inspector"
		);
		const loaded = await server.pluginContainer.load(module!.id);
		const code = typeof loaded === "string" ? loaded : loaded!.code;
		expect(code).toContain("export const token");
		expect(code).not.toContain(record.token);
		await server.listen();
		const port = (server.httpServer!.address() as { port: number }).port;
		await writeFile(file + ".nonce.tmp", JSON.stringify(record));
		for (const path of [
			"/relay.json",
			"/%72elay.json",
			"/relay.json?raw",
			"/relay.json?url",
			"/@fs" + file,
			"/alias.json",
			"/relay.json.nonce.tmp",
			"/.env",
		]) {
			const response = await fetch(`http://127.0.0.1:${port}${path}`);
			expect(response.status, path).toBeGreaterThanOrEqual(400);
			expect(await response.text(), path).not.toContain(record.token);
		}
		await expect(server.pluginContainer.load(file + "?raw")).rejects.toThrow(
			"credentials"
		);
	} finally {
		await server.close();
	}
	await expect(stat(file)).rejects.toThrow();
	await rm(dir, { recursive: true, force: true });
});

test("production build has no active inspector setup or relay record", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rst-production-"));
	const file = join(dir, "relay.json");
	try {
		const result = await build({
			configFile: false,
			root: fileURLToPath(
				new URL("./fixtures/live-inspector", import.meta.url)
			),
			logLevel: "silent",
			plugins: [rStateTreeInspector({ relayFile: file })],
			build: { write: false },
		});
		if (Array.isArray(result) || !("output" in result))
			throw new Error("Unexpected build output");
		const code = result.output
			.map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
			.join("\n");
		expect(code).not.toContain("RStateTree · live inspector");
		expect(code).not.toContain("r-state-tree:inspector");
		expect(code).not.toContain("r-state-tree:extension");
		expect(code).not.toContain("r-state-tree:page");
		expect(code).not.toContain("data-r-state-tree-inspector");
		await expect(stat(file)).rejects.toThrow();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("Vite plugin rejects public hosts, external middleware servers, and separate HMR ports", async () => {
	for (const server of [
		{ host: true },
		{ host: "0.0.0.0" },
		{ host: "127.0.0.1", ws: { host: "0.0.0.0" } },
		{ host: "127.0.0.1", middlewareMode: true },
		{ host: "127.0.0.1", ws: { port: 9999 } },
		{ host: "127.0.0.1", fs: { strict: false } },
	]) {
		await expect(
			createServer({
				configFile: false,
				server,
				plugins: [rStateTreeInspector()],
			})
		).rejects.toThrow("RStateTree inspection");
	}
});
