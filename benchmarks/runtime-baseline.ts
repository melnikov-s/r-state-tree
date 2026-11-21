import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build, version as esbuildVersion } from "esbuild";
import type { Sampling, measureCase } from "./runtime-workloads.js";

type Row = ReturnType<typeof measureCase>;
const driver = "benchmarks/runtime-baseline.ts";
const workloads = "benchmarks/runtime-workloads.ts";
const target = "node22";
const outputSchema = 1;

function json<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function git(args: string[]) {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function commit(ref: string) {
	return git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
}

function environment() {
	const cpu = cpus();
	return {
		node: process.version,
		v8: process.versions.v8,
		nodeEnv: process.env.NODE_ENV ?? "unset",
		os: platform(),
		osRelease: release(),
		arch: arch(),
		cpu: cpu[0]?.model ?? "unknown",
		logicalCpuCount: cpu.length,
		compiler: {
			esbuild: esbuildVersion,
			target,
			format: "esm",
			decorators: "standard",
			minify: false,
		},
		dependencies: Object.fromEntries(
			["@preact/signals-core", "@tsmetadata/polyfill"].map((name) => [
				name,
				json<{ version: string }>(join("node_modules", name, "package.json"))
					.version,
			])
		),
	};
}

type Report = {
	schema: number;
	recordedAt: string;
	runtime: { commit: string; packageVersion: string };
	harness: { checkoutCommit: string; sourceSha256: string };
	environment: ReturnType<typeof environment>;
	measurement: Sampling & {
		clock: string;
		processIsolation: string;
		gc: string;
	};
	cases: Row[];
};

function compare(beforePath: string, afterPath: string) {
	const before = json<Report>(beforePath);
	const after = json<Report>(afterPath);
	assert.equal(before.schema, outputSchema, "Unsupported before report schema");
	assert.equal(after.schema, outputSchema, "Unsupported after report schema");
	assert.equal(
		after.harness.sourceSha256,
		before.harness.sourceSha256,
		"Run both revisions from the same harness checkout"
	);
	assert.deepEqual(
		after.environment,
		before.environment,
		"Run both revisions on the same machine with the same Node and dependencies"
	);
	assert.deepEqual(
		after.measurement,
		before.measurement,
		"Run both revisions with identical sampling options"
	);
	assert.equal(
		before.measurement.smoke,
		false,
		"Smoke runs are for correctness, not timing comparisons"
	);
	const comparable = ({ usPerOperation: _, ...rest }: Row) => rest;
	assert.deepEqual(
		after.cases.map(comparable),
		before.cases.map(comparable),
		"Case settings or deterministic counters differ"
	);
	console.log(
		`${before.runtime.commit} -> ${after.runtime.commit}; wall µs/op (p25–p75)`
	);
	console.table(
		before.cases.map((row, i) => {
			const a = row.usPerOperation;
			const b = after.cases[i].usPerOperation;
			return {
				case: row.id,
				before: a.median,
				"before IQR": `${a.p25}–${a.p75}`,
				after: b.median,
				"after IQR": `${b.p25}–${b.p75}`,
				"median change %": +((b.median / a.median - 1) * 100).toFixed(1),
			};
		})
	);
}

const worker = `
const { caseIds, measureCase } = await import(process.argv[1]);
const id = process.argv[2];
console.log(JSON.stringify(id ? measureCase(id, JSON.parse(process.argv[3])) : caseIds));
`;

async function run(ref: string, smoke: boolean, reportPath?: string) {
	// Use exact committed sources, including for the default HEAD, but the same
	// installed toolchain/dependencies and harness for every runtime revision.
	const runtime = commit(ref);
	const { version: packageVersion } = JSON.parse(
		git(["show", `${runtime}:package.json`])
	) as { version: string };
	const harness = {
		checkoutCommit: commit("HEAD"),
		sourceSha256: createHash("sha256")
			.update(readFileSync(driver))
			.update(readFileSync(workloads))
			.digest("hex"),
	};
	const env = environment();
	const recordedAt = new Date().toISOString();
	const measurement = {
		smoke,
		warmups: smoke ? 1 : 4,
		samples: smoke ? 3 : 9,
		clock: "performance.now (wall time)",
		processIsolation: "one Node process per case",
		gc: "default, not forced",
	};
	const cache = resolve("node_modules/.cache");
	mkdirSync(cache, { recursive: true });
	const stage = mkdtempSync(join(cache, "runtime-baseline-"));
	const entry = join(stage, "workloads.mjs");
	let cases: Row[];
	try {
		execFileSync("tar", ["-xf", "-", "-C", stage], {
			input: execFileSync("git", ["archive", "--format=tar", runtime, "src"], {
				maxBuffer: 32 * 1024 * 1024,
			}),
		});
		await build({
			entryPoints: [workloads],
			outfile: entry,
			bundle: true,
			platform: "node",
			format: "esm",
			target,
			packages: "external",
			tsconfigRaw: {
				compilerOptions: {
					useDefineForClassFields: true,
					experimentalDecorators: false,
				},
			},
			plugins: [
				{
					name: "committed-public-entry",
					setup(builder) {
						builder.onResolve({ filter: /^\.\.\/src\/index\.js$/ }, () => ({
							path: join(stage, "src/index.ts"),
						}));
					},
				},
			],
		});
		function runWorker<T>(...args: string[]): T {
			return JSON.parse(
				execFileSync(
					process.execPath,
					[
						"--input-type=module",
						"--eval",
						worker,
						pathToFileURL(entry).href,
						...args,
					],
					{ encoding: "utf8" }
				)
			) as T;
		}
		const ids = runWorker<string[]>();
		assert.ok(
			ids.length > 0 && new Set(ids).size === ids.length,
			"Expected unique case IDs"
		);
		cases = ids.map((id) => runWorker<Row>(id, JSON.stringify(measurement)));
	} finally {
		rmSync(stage, { recursive: true, force: true });
	}
	const report: Report = {
		schema: outputSchema,
		recordedAt,
		runtime: { commit: runtime, packageVersion },
		harness,
		environment: env,
		measurement,
		cases,
	};
	console.log(
		`Runtime ${runtime} (r-state-tree ${packageVersion}); harness checkout ${harness.checkoutCommit}\nHarness source SHA-256 ${harness.sourceSha256}`
	);
	console.log(
		`Node ${env.node} / V8 ${env.v8}; ${env.os} ${env.osRelease} ${env.arch} ${env.cpu} (${env.logicalCpuCount} logical CPUs)`
	);
	console.log(
		`esbuild ${esbuildVersion} (${target}, standard decorators); ${Object.entries(
			env.dependencies
		)
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`
	);
	console.log(
		`${smoke ? "Smoke: " : ""}${measurement.warmups} warmups, ${measurement.samples} samples; wall µs per operation; process per case, default GC. See JSON for full parameters/counters.`
	);
	console.table(
		cases.map((row) => ({
			case: row.id,
			phase: row.phase,
			"ops/sample": row.iterations,
			median: row.usPerOperation.median,
			"p25–p75": `${row.usPerOperation.p25}–${row.usPerOperation.p75}`,
			"min–max": `${row.usPerOperation.min}–${row.usPerOperation.max}`,
		}))
	);
	if (reportPath)
		writeFileSync(reportPath, `${JSON.stringify(report, null, "\t")}\n`);
}

const { values, positionals } = parseArgs({
	options: {
		help: { type: "boolean" },
		smoke: { type: "boolean" },
		runtime: { type: "string" },
		json: { type: "string" },
		compare: { type: "boolean" },
	},
	allowPositionals: true,
});

if (values.help) {
	console.log(
		"pnpm benchmark:baseline [--runtime GIT_REF] [--smoke] [--json FILE]\npnpm benchmark:baseline --compare BEFORE.json AFTER.json\nRuntime defaults to committed HEAD; see docs/benchmarks.md."
	);
} else {
	assert.ok(
		!process.env.NODE_OPTIONS,
		"Unset NODE_OPTIONS for controlled benchmark runs"
	);
	if (values.compare) {
		assert.ok(
			positionals.length === 2 &&
				!values.runtime &&
				!values.smoke &&
				!values.json,
			"Expected --compare BEFORE.json AFTER.json only"
		);
		compare(positionals[0], positionals[1]);
	} else {
		assert.equal(
			positionals.length,
			0,
			"Unexpected positional arguments (see --help)"
		);
		await run(values.runtime ?? "HEAD", values.smoke ?? false, values.json);
	}
}
