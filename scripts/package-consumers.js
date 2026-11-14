import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const compiler = join(
	dirname(require.resolve("typescript/package.json")),
	"bin/tsc"
);
const temporary = mkdtempSync(join(tmpdir(), "r-state-tree-consumers-"));
const fixtures = join(root, "scripts/consumer-fixtures");

// Use the current toolchain, but resolve consumer imports only from the clean
// installation. Don't inherit loader hooks or the checkout's ambient types.
const env = Object.fromEntries(
	Object.entries(process.env).filter(
		([key]) =>
			!/^npm_/i.test(key) && !["NODE_PATH", "NODE_OPTIONS"].includes(key)
	)
);
env.npm_config_cache = join(temporary, "npm-cache");
env.npm_config_update_notifier = "false";

function run(command, args, cwd = root) {
	const result = spawnSync(command, args, {
		cwd,
		env,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
		timeout: 180_000,
	});
	if (result.error) throw result.error;
	assert.equal(
		result.status,
		0,
		`${command} ${args.join(" ")}\n${result.stdout}${result.stderr}`
	);
	return result;
}

try {
	const [packed] = JSON.parse(
		run("npm", [
			"pack",
			"--json",
			"--ignore-scripts",
			"--pack-destination",
			temporary,
		]).stdout
	);
	const tarball = join(temporary, packed.filename);
	const peers = Object.fromEntries(
		[
			"react",
			"react-dom",
			"@types/react",
			"@types/react-dom",
			"@preact/signals-react",
		].map((name) => [
			name,
			JSON.parse(
				readFileSync(join(root, "node_modules", name, "package.json"), "utf8")
			).version,
		])
	);
	console.log(
		`Testing ${packed.filename} with Node ${process.versions.node} and TypeScript ${require("typescript/package.json").version}`
	);

	for (const name of ["core", "react"]) {
		const directory = join(temporary, name);
		mkdirSync(directory);
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({
				private: true,
				type: "module",
				dependencies: {
					"r-state-tree": `file:${tarball}`,
					...(name === "react" ? peers : {}),
				},
			})
		);
		run(
			"npm",
			[
				"install",
				"--ignore-scripts",
				"--strict-peer-deps",
				"--no-audit",
				"--no-fund",
			],
			directory
		);
		cpSync(fixtures, directory, { recursive: true });

		if (name === "core") {
			const packageDirectory = join(directory, "node_modules/r-state-tree");
			const manifest = JSON.parse(
				readFileSync(join(packageDirectory, "package.json"), "utf8")
			);
			assert.equal(manifest.type, "module");
			for (const entry of Object.values(manifest.exports)) {
				if (typeof entry === "object") {
					if (entry.import) assert.match(entry.import, /\.js$/);
					if (entry.require) assert.match(entry.require, /\.cjs$/);
				}
			}
			const entries = [
				manifest.main,
				manifest.module,
				manifest.types,
				...Object.values(manifest.bin),
				...Object.values(manifest.exports).flatMap((entry) =>
					typeof entry === "string" ? [entry] : Object.values(entry)
				),
			];
			for (const entry of entries) {
				assert.ok(statSync(join(packageDirectory, entry)).isFile(), entry);
			}
			assert.match(
				readFileSync(join(packageDirectory, "dist/src/react.d.ts"), "utf8"),
				/Makes a realized Store available to descendants/
			);
			run(process.execPath, ["absent-peers.cjs"], directory);
		}

		for (const extension of ["cjs", "js"]) {
			const result = run(
				process.execPath,
				["--trace-warnings", `${name}.${extension}`],
				directory
			);
			assert.equal(result.stderr, "", "runtime must not emit warnings");
		}

		for (const [moduleResolution, module, extension] of [
			["NodeNext", "NodeNext", "cts"],
			["NodeNext", "NodeNext", "mts"],
			["Bundler", "ESNext", "ts"],
		]) {
			const file = `consumer.${extension}`;
			cpSync(join(fixtures, `${name}.ts`), join(directory, file));
			writeFileSync(
				join(directory, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						module,
						moduleResolution,
						lib: ["ES2022", "DOM", "ESNext.Disposable"],
						types: [],
						strict: true,
						skipLibCheck: false,
						noEmit: true,
						experimentalDecorators: false,
						useDefineForClassFields: true,
						noUncheckedSideEffectImports: true,
					},
					files: [file],
				})
			);
			run(process.execPath, [compiler, "-p", "tsconfig.json"], directory);
		}
		console.log(
			`PASS ${name}: clean install, CJS, ESM, and strict declarations`
		);
	}
} finally {
	if (process.env.KEEP_PACKAGE_CONSUMERS === "1") {
		console.log(`Kept consumers at ${temporary}`);
	} else {
		rmSync(temporary, { recursive: true, force: true });
	}
}
