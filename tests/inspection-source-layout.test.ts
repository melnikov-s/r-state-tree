import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildSync } from "esbuild";
import * as publicDevtools from "../devtools/src/devtools";

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? sourceFiles(path) : [path];
	});
}

test("inspector sources and entry points live outside core src", () => {
	const core = sourceFiles("src");
	expect(core.some((path) => /inspection|devtools/.test(path))).toBe(false);
	const devtools = sourceFiles("devtools/src");
	for (const entry of [
		"devtools.ts",
		"devtools-vite.ts",
		"devtools-vite-client.ts",
		"devtools-mcp.ts",
		"inspection/runtime.ts",
		"inspection/bridge.ts",
		"inspection/diagram.ts",
		"inspection/relay.ts",
		"inspection/signature-transform.ts",
		"inspection/context-transform.ts",
		"inspection/mcp.ts",
	])
		expect(devtools).toContain(join("devtools/src", entry));
});

test("the public browser entry has no UI mount or UI implementation dependency", () => {
	expect(Object.keys(publicDevtools).sort()).toEqual([
		"connectViteInspector",
		"createInspector",
		"createOperationTimeline",
	]);
	const result = buildSync({
		entryPoints: ["devtools/src/devtools.ts"],
		bundle: true,
		write: false,
		metafile: true,
		platform: "browser",
		logLevel: "silent",
	});
	expect(
		Object.keys(result.metafile!.inputs).some((path) =>
			/extension|panel|diagram/.test(path)
		)
	).toBe(false);
	const code = result.outputFiles[0].text;
	expect(code).not.toMatch(
		/attachShadow|createElement|data-r-state-tree-inspector/
	);
});

test("MV3 extension is a separate static DevTools-only UI with loopback content access, not arbitrary browser automation", () => {
	const directory = "devtools/extension";
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	expect(pkg.files).toContain(directory);
	const manifest = JSON.parse(
		readFileSync(join(directory, "manifest.json"), "utf8")
	);
	expect(manifest.manifest_version).toBe(3);
	expect(manifest.devtools_page).toBe("devtools.html");
	expect(manifest.permissions ?? []).toEqual([]);
	expect(manifest.host_permissions ?? []).toEqual([]);
	expect(manifest.background).toBeUndefined();
	expect(manifest.externally_connectable).toBeUndefined();
	expect(manifest.web_accessible_resources).toBeUndefined();
	expect(manifest.content_scripts).toHaveLength(1);
	expect(manifest.content_scripts[0].all_frames).toBe(false);
	expect(manifest.content_scripts[0].matches).toEqual([
		"http://localhost/*",
		"http://127.0.0.1/*",
		"http://[::1]/*",
		"https://localhost/*",
		"https://127.0.0.1/*",
		"https://[::1]/*",
	]);
	for (const file of sourceFiles(directory)) {
		const code = readFileSync(file, "utf8");
		expect(code).not.toMatch(
			/inspectedWindow\.eval|chrome\.scripting|new Function|innerHTML\s*=/
		);
	}
});

test("all core and React source dependency graphs exclude devtools", () => {
	const core = sourceFiles("src").filter((path) => path.endsWith(".ts"));
	// Include type-only imports, which a bundler would erase.
	for (const file of core) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(
			/\b(?:from|import|require)\s*(?:\(\s*)?["']([^"']+)["']/g
		)) {
			const specifier = match[1];
			expect(specifier).not.toMatch(/^r-state-tree\/devtools(?:\/|$)/);
			if (specifier.startsWith("."))
				expect(resolve(dirname(file), specifier)).not.toMatch(
					/[/\\]devtools(?:[/\\]|$)/
				);
		}
	}
	const result = buildSync({
		entryPoints: core,
		bundle: true,
		write: false,
		metafile: true,
		platform: "browser",
		outdir: "unused",
		logLevel: "silent",
	});
	expect(
		Object.keys(result.metafile!.inputs).some((path) =>
			path.startsWith("devtools/")
		)
	).toBe(false);
});
