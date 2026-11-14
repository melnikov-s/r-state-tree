import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, relative } from "node:path";

// Compare disabled/active recording on identical workloads. An optional historical
// revision adds a pre-hook baseline; no application-demo commit is required.
const baseline = process.env.ACTIVITY_BASELINE;
const root = process.cwd();
const source = `
import { Store, createStore, mount, observable, batch } from ${JSON.stringify(resolve("src/index.ts"))};
import { createInspector } from ${JSON.stringify(resolve("devtools/src/devtools.ts"))};
class Counter extends Store {
 count = 0;
 list = observable([]);
 children = observable(Array.from({ length: 100 }, () => observable({ value: 0 })));
 increment() { this.count++; this.count++; }
 lookup() { return this.children[0]; }
}
const workloads = [
 ["field writes", 50000, (s, i) => { s.count = i; }],
 ["method calls (2 writes)", 25000, s => s.increment()],
 ["array push/pop", 20000, s => { s.list.push(1); s.list.pop(); }],
 ["batch (20 writes)", 2500, (s, i) => batch(() => { for(let j=0;j<20;j++) s.count = i*20+j; })],
 ["100-object tree", 50000, (s, i) => { s.children[i % 100].value = i; }],
 ["object-returning lookups", 25000, s => s.lookup()],
];
export const count = workloads.length;
export function prepare(index, recording = false) {
 const [name, iterations, work] = workloads[index];
 const s = mount(createStore(Counter));
 const inspector = recording ? createInspector({ activity: true }) : undefined;
 inspector?.registerRoot("Counter", s);
 return {
  name, iterations,
  run(n = iterations) { for(let i=0;i<n;i++) work(s, i); },
  dispose() { inspector?.dispose(); s[Symbol.dispose](); },
 };
}
`;
const paths = {
	current: resolve("node_modules/.cache/activity-current.cjs"),
	...(baseline
		? { baseline: resolve("node_modules/.cache/activity-baseline.cjs") }
		: {}),
};
for (const [name, outfile] of Object.entries(paths)) {
	await build({
		stdin: { contents: source, resolveDir: root, loader: "ts" },
		bundle: true,
		platform: "node",
		format: "cjs",
		outfile,
		logLevel: "silent",
		plugins:
			name === "baseline"
				? [
						{
							name: "pre-debugger-core",
							setup(build) {
								build.onLoad({ filter: /\/src\/.*\.ts$/ }, ({ path }) => {
									const local = relative(root, path);
									if (local.startsWith("../")) return;
									const contents = execFileSync(
										"git",
										["show", `${baseline}:${local}`],
										{ encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }
									);
									return { contents, loader: "ts" };
								});
							},
						},
					]
				: [],
	});
}
type Workload = {
	name: string;
	iterations: number;
	run(n?: number): void;
	dispose(): void;
};
type Harness = {
	count: number;
	prepare(index: number, recording?: boolean): Workload;
};
const require = createRequire(import.meta.url);
const before: Harness | undefined = paths.baseline
	? require(paths.baseline)
	: undefined;
const current: Harness = require(paths.current);
function measure(workload: Workload) {
	const start = process.cpuUsage();
	workload.run();
	const elapsed = process.cpuUsage(start);
	return (elapsed.user + elapsed.system) / 1000;
}
const median = (samples: number[]) =>
	samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
const rows = [];
for (let i = 0; i < current.count; i++) {
	const old = before?.prepare(i);
	const off = current.prepare(i);
	const a: number[] = [],
		b: number[] = [];
	for (let warm = 0; warm < 4; warm++) {
		old?.run();
		off.run();
	}
	for (let repeat = 0; repeat < 9; repeat++) {
		if (repeat % 2) {
			b.push(measure(off));
			if (old) a.push(measure(old));
		} else {
			if (old) a.push(measure(old));
			b.push(measure(off));
		}
	}
	// Never keep an active recorder while measuring the disabled current runtime.
	old?.dispose();
	off.dispose();
	const on = current.prepare(i, true);
	on.run();
	const active = Array.from({ length: 9 }, () => measure(on));
	on.dispose();
	const disabledMs = median(b),
		recordingMs = median(active);
	rows.push({
		workload: off.name,
		iterations: off.iterations,
		...(old
			? {
					"before (CPU ms)": +median(a).toFixed(2),
					"off / before": +(disabledMs / median(a)).toFixed(2),
				}
			: {}),
		"off (CPU ms)": +disabledMs.toFixed(2),
		"recording (CPU ms)": +recordingMs.toFixed(2),
		"recording / off": +(recordingMs / disabledMs).toFixed(2),
	});
}
console.log(
	`Node ${process.version}; ${baseline ? `baseline ${baseline}` : "disabled versus active recording"}; median of 9 warmed CPU-time samples. Microbenchmarks, not browser latency.`
);
console.table(rows);
console.log(
	`Compiled core + devtools sizes: ${paths.baseline ? `before ${(await readFile(paths.baseline)).length} bytes; ` : ""}current ${(await readFile(paths.current)).length} bytes (unminified, bundled signals).`
);
