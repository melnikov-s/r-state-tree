import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildSync } from "esbuild";

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
		"inspection/panel.ts",
		"inspection/diagram.ts",
		"inspection/relay.ts",
		"inspection/signature-transform.ts",
		"inspection/context-transform.ts",
		"inspection/mcp.ts",
	])
		expect(devtools).toContain(join("devtools/src", entry));
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
