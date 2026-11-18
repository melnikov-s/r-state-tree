import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const compiler = join(
	dirname(require.resolve("typescript/package.json")),
	"bin/tsc"
);
const temporary = mkdtempSync(join(tmpdir(), "r-state-tree-consumers-"));
const fixtures = join(root, "scripts/consumer-fixtures");
const local = process.argv.includes("--local");

// Resolve imports from the isolated consumer directory. Don't inherit loader
// hooks or the checkout's ambient types.
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

function checkPackedLinks(directory) {
	// Follow relative Markdown file links from the shipped README. Fragments
	// and external URLs are not file targets.
	const pending = new Set([join(directory, "README.md")]);
	for (const path of pending) {
		const markdown = readFileSync(path, "utf8");
		for (const [, link] of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
			const target = link.split("#")[0];
			if (!target || /^[a-z][a-z\d+.-]*:|^\/\//i.test(target)) continue;
			const file = resolve(dirname(path), target);
			assert.ok(
				file.startsWith(directory + sep) &&
					statSync(file, { throwIfNoEntry: false })?.isFile(),
				`Packed ${path.slice(directory.length + 1)} links to missing ${target}`
			);
			if (extname(file) === ".md") pending.add(file);
		}
	}
}

function linkLocalDependencies(directory, packageDirectory, names) {
	const modules = join(directory, "node_modules");
	mkdirSync(modules);
	cpSync(packageDirectory, join(modules, "r-state-tree"), { recursive: true });
	for (const name of names) {
		const source = join(root, "node_modules", name);
		assert.ok(existsSync(source), `Missing local dependency ${name}`);
		const target = join(modules, name);
		mkdirSync(dirname(target), { recursive: true });
		symlinkSync(source, target, "junction");
	}
}

try {
	const [packed] = JSON.parse(
		run("npm", [
			"pack",
			"--json",
			"--ignore-scripts",
			"--offline",
			"--pack-destination",
			temporary,
		]).stdout
	);
	const tarball = join(temporary, packed.filename);
	const packedDirectory = join(temporary, "package");
	run("tar", ["-xzf", tarball, "-C", temporary]);
	checkPackedLinks(packedDirectory);
	console.log("PASS packed README and linked documentation file targets");

	const packedManifest = JSON.parse(
		readFileSync(join(packedDirectory, "package.json"), "utf8")
	);
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
		if (local) {
			// Keep testing the exact tarball contents, but supply packages from the
			// checkout. This does not simulate npm peer or dependency resolution.
			linkLocalDependencies(directory, packedDirectory, [
				...Object.keys(packedManifest.dependencies ?? {}),
				...(name === "react" ? Object.keys(peers) : []),
			]);
		} else {
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
		}
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
			console.log("PASS core without optional peers");
			const mixed = run(
				process.execPath,
				["--trace-warnings", "mixed.js"],
				directory
			);
			assert.equal(mixed.stderr, "", "mixed runtime must not emit warnings");
			console.log(
				"PASS mixed: both formats load, with separate Store/Model runtimes"
			);
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
			`PASS ${name}: ${local ? "local dependencies" : "clean install"}, CJS, ESM, and strict declarations`
		);
	}
} finally {
	if (process.env.KEEP_PACKAGE_CONSUMERS === "1") {
		console.log(`Kept consumers at ${temporary}`);
	} else {
		rmSync(temporary, { recursive: true, force: true });
	}
}
