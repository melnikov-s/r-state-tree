import { build } from "esbuild";
import { deepStrictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

// Run from the repository root. Compare current source with an optional
// DIFF_BENCH_BASELINE=<git revision> in isolated bundles, never rewriting source.
// DIFF_BENCH_VERIFY_ONLY=1 requires each supplied version to pass the current
// public diff regression suite (a pre-fix baseline is expected to fail).
// DIFF_BENCH_SIZES, DIFF_BENCH_SAMPLES, and DIFF_BENCH_SAMPLE_MS control
// the workload sizes and sampling, not the production code.
const root = process.cwd();
const files = [
	"src/utils.ts",
	"src/api.ts",
	"src/model/ModelAdministration.ts",
];
const utilsPath = resolve(files[0]);
const baseline = process.env.DIFF_BENCH_BASELINE;
const candidates: Record<string, Map<string, string>> = {
	current: new Map(
		await Promise.all(
			files.map(
				async (file) => [resolve(file), await readFile(file, "utf8")] as const
			)
		)
	),
};
if (baseline) {
	candidates.baseline = new Map(
		files.map((file) => [
			resolve(file),
			execFileSync("git", ["show", `${baseline}:${file}`], {
				encoding: "utf8",
			}),
		])
	);
}

if (process.env.DIFF_BENCH_VERIFY_ONLY === "1") {
	const { startVitest } = await import("vitest/node");
	for (const [name, contents] of Object.entries(candidates)) {
		const filters = ["tests/Model.snapshotDiff.test.ts"];
		if (name === "current")
			filters.push("tests/snapshotDiff.optimization.test.ts");
		let transformed = 0;
		const ctx = await startVitest(
			"test",
			filters,
			{ watch: false, maxWorkers: 1 },
			{
				plugins: [
					{
						name: `verify-${name}`,
						enforce: "pre",
						transform(_code, id) {
							const code = contents.get(id.split("?")[0]);
							if (code !== undefined) transformed++;
							return code;
						},
					},
				],
			}
		);
		const files = ctx.state.getFiles();
		const passed =
			transformed > 0 &&
			files.length === filters.length &&
			files.every((file) => file.result?.state === "pass") &&
			ctx.state.getUnhandledErrors().length === 0;
		await ctx.close();
		if (!passed) throw new Error(`Candidate failed regression suite: ${name}`);
		console.log(`Regression suite passed with source transform: ${name}`);
	}
	process.exit(0);
}

// Plain snapshot preparation isolates diff generation from Model/reaction work.
// Snapshot pairs share unchanged children just like memoized Model snapshots.
// Runtime workloads additionally create fresh changed snapshots on every edit.
const source = `
import assert from "node:assert/strict";
import { Model, child, id, toSnapshot, onSnapshot, onSnapshotDiff, applySnapshot } from ${JSON.stringify(resolve("src/index.ts"))};
import { getDiff } from ${JSON.stringify(utilsPath)};
import { childType, idType } from ${JSON.stringify(resolve("src/types.ts"))};
const configs = new WeakMap();
const lookup = snapshot => configs.get(snapshot);
const rootConfig = { items: childType };
const itemConfig = { id: idType };
let sink;
export function latest() { return sink; }
function consume(diff) { sink = diff; }
function pair(before, after, getConfig = lookup) {
 return { undo: getDiff(after, before, getConfig), redo: getDiff(before, after, getConfig) };
}
export function prepareDiff(n, fields, operation) {
 const item = index => {
  const snapshot = { id: index, value: 10 };
  for (let k = 0; k < fields; k++) snapshot["field" + k] = k;
  configs.set(snapshot, itemConfig);
  return snapshot;
 };
 const items = Array.from({ length: n }, (_, index) => item(index));
 const nextItems = items.slice();
 const before = { scalar: 0, items };
 const after = { scalar: 0, items: nextItems };
 if (operation === "edit") {
  const changed = { ...items[n >> 1], value: 11 };
  configs.set(changed, itemConfig);
  nextItems[n >> 1] = changed;
 } else if (operation === "delete") nextItems.shift();
 else if (operation === "reverse") nextItems.reverse();
 else { after.items = items; after.scalar = 1; }
 configs.set(before, rootConfig);
 configs.set(after, rootConfig);
 return {
  output() { return pair(before, after); },
  run(iterations) { for (let i = 0; i < iterations; i++) consume(pair(before, after)); },
  dispose() {},
 };
}
${[8, 64]
	.map(
		(fields) => `
class Item${fields} extends Model {
 static types = { id };
 id = 0;
 value = 0;
 ${Array.from({ length: fields }, (_, k) => `field${k} = ${k};`).join("\n ")}
}
class Root${fields} extends Model {
 static types = { items: child(Item${fields}) };
 scalar = 0;
 items = [];
}
`
	)
	.join("\n")}
class CollectionRoot extends Root8 {
 tags = Array.from({ length: 128 }, (_, i) => "tag" + i);
 details = { values: Array.from({ length: 128 }, (_, i) => ({ count: i })) };
}
export function prepareRuntime(n, fields, observer, operation = "edit") {
 const Root = operation === "scalar-collections" ? CollectionRoot : fields === 64 ? Root64 : Root8;
 const root = Root.create({ items: Array.from({ length: n }, (_, index) => ({ id: index, value: 10 })) });
 const children = Array.from(root.items);
 let callbacks = 0;
 const callback = diff => { callbacks++; consume(diff); };
 const stop = observer === "diff" ? onSnapshotDiff(root, callback)
  : observer === "snapshot" ? onSnapshot(root, callback) : () => {};
 let cursor = 0;
 return {
  run(iterations) {
   const before = callbacks;
   for (let i = 0; i < iterations; i++) {
    if (operation === "edit") { const item = children[(cursor++ * 97) % n]; item.value++; }
    else root.scalar++;
   }
   assert.equal(callbacks - before, observer === "none" ? 0 : iterations);
  },
  verify(current) {
   const snapshot = toSnapshot(root);
   if (observer === "snapshot") assert.strictEqual(sink, snapshot);
   if (operation === "edit") {
    const index = ((cursor - 1) * 97) % n;
    const value = children[index].value;
    assert.strictEqual(snapshot.items[index].value, value);
    if (observer === "diff") {
     const expected = value => ({ items: children.map((_, id) => id === index ? { id, value } : { id }) });
     assert.deepStrictEqual(sink, { undo: expected(value - 1), redo: expected(value) });
    }
   } else {
    assert.strictEqual(snapshot.scalar, root.scalar);
    if (observer === "diff") {
     assert.strictEqual(sink.undo.scalar, root.scalar - 1);
     assert.strictEqual(sink.redo.scalar, root.scalar);
     if (current || operation === "scalar") {
      assert.deepStrictEqual(sink, { undo: { scalar: root.scalar - 1 }, redo: { scalar: root.scalar } });
     }
    }
   }
   // Optional payload size measurement is outside all timed samples.
   return observer === "diff" ? Buffer.byteLength(JSON.stringify(sink)) : null;
  },
  dispose() { stop(); },
 };
}
export function verify() {
 const Root = Root8;
 const initial = { items: [{ id: 1, value: 10 }, { id: 2, value: 10 }] };
 const root = Root.create(initial);
 let captured;
 const stop = onSnapshotDiff(root, diff => { captured = diff; });
 const before = structuredClone(toSnapshot(root));
 root.items.splice(0, 1);
 const after = structuredClone(toSnapshot(root));
 stop();
 assert.deepEqual(captured, {
  undo: { items: [before.items[0], { id: 2 }] },
  redo: { items: [{ id: 2 }] },
 });
 for (let i = 0; i < 2; i++) {
  applySnapshot(root, structuredClone(captured.undo));
  assert.deepEqual(toSnapshot(root), before);
  applySnapshot(root, structuredClone(captured.redo));
  assert.deepEqual(toSnapshot(root), after);
 }
 for (const operation of ["edit", "delete", "reverse", "scalar"]) {
  const workload = prepareDiff(20, 8, operation);
  const diff = workload.output();
  assert.ok(diff.undo && diff.redo);
 }
}
`;

type Workload = {
	run(iterations: number): void;
	dispose(): void;
};
type Harness = {
	verify(): void;
	prepareDiff(
		n: number,
		fields: number,
		operation: string
	): Workload & { output(): unknown };
	prepareRuntime(
		n: number,
		fields: number,
		observer: string,
		operation?: string
	): Workload & { verify(current: boolean): number | null };
};
const require = createRequire(import.meta.url);
const harnesses: Record<string, Harness> = {};
const bundlePaths: Record<string, string> = {};
for (const [name, contents] of Object.entries(candidates)) {
	const outfile = resolve(`node_modules/.cache/snapshot-diff-${name}.cjs`);
	await build({
		stdin: { contents: source, resolveDir: root, loader: "ts" },
		bundle: true,
		platform: "node",
		format: "cjs",
		outfile,
		logLevel: "silent",
		plugins: [
			{
				name: "snapshot-diff-version",
				setup(build) {
					build.onLoad({ filter: /\/src\/.*\.ts$/ }, ({ path }) => {
						const code = contents.get(path);
						return code === undefined
							? undefined
							: { contents: code, loader: "ts" };
					});
				},
			},
		],
	});
	bundlePaths[name] = outfile;
	harnesses[name] = require(outfile);
	harnesses[name].verify();
}

const environment = {
	node: process.version,
	platform: process.platform,
	arch: process.arch,
	cpu: cpus()[0]?.model,
	nodeEnv: process.env.NODE_ENV ?? "unset",
	baseline: baseline ?? null,
	productionSourceDirty: Boolean(
		execFileSync("git", ["diff", "HEAD", "--name-only", "--", ...files], {
			encoding: "utf8",
		}).trim()
	),
	productionSourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
};
const samples = Number(process.env.DIFF_BENCH_SAMPLES ?? 7);
const targetMs = Number(process.env.DIFF_BENCH_SAMPLE_MS ?? 25);
const sizes = (process.env.DIFF_BENCH_SIZES ?? "10,100,1000,10000")
	.split(",")
	.map(Number);
if (
	!Number.isInteger(samples) ||
	samples < 3 ||
	!Number.isFinite(targetMs) ||
	targetMs <= 0 ||
	sizes.some((n) => !Number.isInteger(n) || n < 2)
) {
	throw new Error(
		"Expected >=3 samples, positive sample duration, and integer sizes >=2"
	);
}
const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function elapsed(workload: Workload, iterations: number): number {
	const start = performance.now();
	workload.run(iterations);
	return performance.now() - start;
}
function calibrate(workload: Workload): number {
	let iterations = 1;
	while (iterations < 65536) {
		const ms = elapsed(workload, iterations);
		if (ms >= targetMs / 2)
			return Math.max(1, Math.ceil((iterations * targetMs) / ms));
		iterations *= 2;
	}
	return iterations;
}
type Result = {
	mode: string;
	operation: string;
	n: number;
	fields: number;
	observer: string;
	microseconds: Record<string, number>;
	sampleMicroseconds: Record<string, number[]>;
	payloadBytes?: Record<string, number>;
};
const results: Result[] = [];
// Runtime variants each get their own process and one live Model tree. Keeping
// multiple 10k-Model trees alive together distorts GC costs and JIT specialization.
const runtimeWorker = `
const [bundle, n, fields, observer, operation, samples, targetMs, candidate] = process.argv.slice(1);
const workload = require(bundle).prepareRuntime(+n, +fields, observer, operation);
if (global.gc) global.gc();
function elapsed(iterations) {
 const start = performance.now(); workload.run(iterations); return performance.now() - start;
}
let iterations = 1;
while (iterations < 65536) {
 const ms = elapsed(iterations);
 if (ms >= +targetMs / 2) { iterations = Math.max(1, Math.ceil(iterations * +targetMs / ms)); break; }
 iterations *= 2;
}
elapsed(iterations);
const timings = [];
for (let sample = 0; sample < +samples; sample++) timings.push(elapsed(iterations) * 1000 / iterations);
const payloadBytes = workload.verify(candidate === "current");
workload.dispose();
console.log(JSON.stringify({ timings, payloadBytes }));
`;
function recordResult(
	mode: string,
	operation: string,
	n: number,
	fields: number,
	observer: string,
	timings: Record<string, number[]>,
	payloadBytes?: Record<string, number>
) {
	const result = {
		mode,
		operation,
		n,
		fields,
		observer,
		microseconds: Object.fromEntries(
			Object.keys(timings).map((name) => [name, median(timings[name])])
		),
		sampleMicroseconds: timings,
		payloadBytes,
	};
	results.push(result);
	const { sampleMicroseconds: _samples, ...summary } = result;
	console.log(JSON.stringify(summary));
}
async function measure(
	mode: string,
	operation: string,
	n: number,
	fields: number,
	observer: string,
	names: string[]
) {
	if (mode === "runtime") {
		const timings: Record<string, number[]> = {};
		const payloadBytes: Record<string, number> = {};
		for (let offset = 0; offset < names.length; offset++) {
			const name = names[(results.length + offset) % names.length];
			const sample: { timings: number[]; payloadBytes: number | null } =
				JSON.parse(
					execFileSync(
						process.execPath,
						[
							"--expose-gc",
							"--eval",
							runtimeWorker,
							bundlePaths[name],
							String(n),
							String(fields),
							observer,
							operation,
							String(samples),
							String(targetMs),
							name,
						],
						{ encoding: "utf8" }
					)
				);
			timings[name] = sample.timings;
			if (sample.payloadBytes !== null)
				payloadBytes[name] = sample.payloadBytes;
		}
		recordResult(
			mode,
			operation,
			n,
			fields,
			observer,
			timings,
			observer === "diff" ? payloadBytes : undefined
		);
		return;
	}
	const workloads = Object.fromEntries(
		names.map((name) => [
			name,
			mode === "diff"
				? harnesses[name].prepareDiff(n, fields, operation)
				: harnesses[name].prepareRuntime(n, fields, observer, operation),
		])
	);
	// All variants must preserve exact compact payloads, not just run faster.
	if (mode === "diff") {
		const output = (
			workloads.current as ReturnType<Harness["prepareDiff"]>
		).output();
		for (const name of names) {
			deepStrictEqual(
				(workloads[name] as ReturnType<Harness["prepareDiff"]>).output(),
				output
			);
		}
	}
	const iterations: Record<string, number> = {};
	const timings = Object.fromEntries(
		names.map((name) => [name, [] as number[]])
	);
	for (const name of names) {
		iterations[name] = calibrate(workloads[name]);
		elapsed(workloads[name], iterations[name]);
	}
	for (let sample = 0; sample < samples; sample++) {
		// Rotate the order to avoid always giving one variant the first slot.
		for (let offset = 0; offset < names.length; offset++) {
			const name = names[(sample + offset) % names.length];
			timings[name].push(
				(elapsed(workloads[name], iterations[name]) * 1000) / iterations[name]
			);
		}
	}
	for (const workload of Object.values(workloads)) workload.dispose();
	recordResult(mode, operation, n, fields, observer, timings);
}
console.log(
	`${JSON.stringify(environment)}; median of ${samples} warmed wall-time samples, target ${targetMs} ms/sample; microseconds per undo+redo pair or observed edit. fields means extra scalar fields beyond id/value. No serialization, I/O, rendering, or history retention in timed code.`
);
for (const n of sizes) {
	for (const fields of [8, 64]) {
		await measure("diff", "edit", n, fields, "diff", Object.keys(harnesses));
	}
	for (const operation of ["delete", "reverse", "scalar"]) {
		await measure("diff", operation, n, 8, "diff", Object.keys(harnesses));
	}
	for (const fields of [8, 64]) {
		for (const observer of ["none", "snapshot", "diff"]) {
			await measure(
				"runtime",
				"edit",
				n,
				fields,
				observer,
				Object.keys(harnesses)
			);
		}
	}
	for (const operation of ["scalar", "scalar-collections"]) {
		await measure("runtime", operation, n, 8, "diff", Object.keys(harnesses));
	}
}
const output = resolve("node_modules/.cache/snapshot-diff-results.json");
await writeFile(
	output,
	JSON.stringify({ environment, samples, targetMs, results }, null, 2) + "\n"
);
console.log(`Raw medians: ${output}`);
