import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import plugin from "../lint/index.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = resolve(process.argv[2] ?? join(root, "tests/fixtures"));
const temporary = mkdtempSync(join(tmpdir(), "r-state-tree-fixtures-lint-"));

function sources(directory, prefix = "") {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (
			entry.name.startsWith(".") ||
			["node_modules", "dist"].includes(entry.name)
		)
			return [];
		const relative = join(prefix, entry.name);
		return entry.isDirectory()
			? sources(join(directory, entry.name), relative)
			: /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)
				? [relative]
				: [];
	});
}

try {
	const files = sources(fixtures);
	if (!files.length) throw new Error(`No fixture sources found in ${fixtures}`);
	const mirror = join(temporary, "fixtures");
	for (const file of files) {
		const destination = join(mirror, file);
		mkdirSync(dirname(destination), { recursive: true });
		// The syntax-only plugin deliberately recognizes only public imports. Fixtures
		// exercise this checkout's source instead of dist. Normalize just that module
		// specifier in a temporary mirror; leave code and line numbers unchanged.
		const code = readFileSync(join(fixtures, file), "utf8").replace(
			/(from\s+)["'](?:\.\.\/)+src\/index["']/g,
			'$1"r-state-tree"'
		);
		writeFileSync(destination, code);
	}
	const config = join(temporary, "rules.json");
	writeFileSync(
		config,
		JSON.stringify({
			plugins: [],
			categories: { correctness: "off" },
			jsPlugins: [
				{ name: "r-state-tree", specifier: join(root, "lint/index.mjs") },
			],
			rules: Object.fromEntries(
				Object.keys(plugin.rules).map((rule) => [
					`r-state-tree/${rule}`,
					"error",
				])
			),
		})
	);
	const cli = join(
		dirname(require.resolve("oxlint/package.json")),
		"bin/oxlint"
	);
	const run = spawnSync(
		process.execPath,
		[
			cli,
			"--config",
			config,
			"--disable-nested-config",
			"--no-ignore",
			"--deny-warnings",
			"--format",
			"unix",
			mirror,
		],
		{
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			timeout: 60_000,
		}
	);
	if (run.error) throw run.error;
	process.stdout.write(run.stdout.replaceAll(mirror, fixtures));
	process.stderr.write(run.stderr.replaceAll(mirror, fixtures));
	if (run.status === 0)
		console.log(
			`Checked all ${Object.keys(plugin.rules).length} RStateTree rules in ${files.length} fixture files.`
		);
	process.exitCode = run.status ?? 1;
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
