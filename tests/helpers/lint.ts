import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

const cli = join(dirname(require.resolve("oxlint/package.json")), "bin/oxlint");

const plugin = resolve("lint/index.mjs");

const header = `import { Store, Model, computed, observable, toObservableTree, child, createStore, batch, untracked } from "r-state-tree";\n`;

type Case = [title: string, code: string, count: number];

const getter = (
	body: string,
	fields = "rows = observable([]); count = 0; data = observable({});"
) => `class S extends Store { ${fields} get derived() { ${body} } }`;

const childStore = (
	body: string,
	declaration = "@child get worker() { return createStore(Worker) }"
) =>
	`class Worker extends Store {} class S extends Store { ${declaration} run() { ${body} } }`;

// No async-commit diagnostic is shipped. These scope fixtures deliberately include
// unsafe and valid policies; zero reports is NOT evidence of lifetime safety.
const asyncReviewCases: Case[] = [
	[
		"advisory: unguarded late success",
		"class S extends Store { value = 0; async run() { await work(); this.value = 1 } }",
		0,
	],
	[
		"advisory: unguarded late error",
		"class S extends Store { error = null; async run() { try { await work() } catch (error) { this.error = error } } }",
		0,
	],
	[
		"advisory: explicit lifetime guard",
		"class S extends Store { value = 0; async run() { await work(); if (this.signal.aborted) return; this.value = 1 } }",
		0,
	],
	[
		"advisory: operation signal",
		"class S extends Store { value = 0; async run(signal: AbortSignal) { await work(signal); if (signal.aborted) return; this.value = 1 } }",
		0,
	],
	[
		"advisory: controller and revision guard",
		"class S extends Store { value = 0; revision = 0; async run() { const revision = ++this.revision; const operation = new AbortController(); await work(operation.signal); if (operation.signal.aborted || revision !== this.revision) return; this.value = 1 } }",
		0,
	],
	[
		"advisory: helper lifetime check",
		"class S extends Store { value = 0; async run() { await work(); assertLive(this); this.value = 1 } }",
		0,
	],
	[
		"advisory: guard before await is insufficient",
		"class S extends Store { value = 0; async run() { if (this.signal.aborted) return; await work(); this.value = 1 } }",
		0,
	],
	[
		"advisory: later await invalidates guard",
		"class S extends Store { value = 0; async run() { await work(); if (this.signal.aborted) return; await work(); this.value = 1 } }",
		0,
	],
	[
		"advisory: revalidate after every await",
		"class S extends Store { value = 0; async run() { await work(); if (this.signal.aborted) return; await work(); if (this.signal.aborted) return; this.value = 1 } }",
		0,
	],
	[
		"advisory: branch does not protect other path",
		"class S extends Store { value = 0; async run(flag: boolean) { await work(); if (flag) { if (this.signal.aborted) return } this.value = 1 } }",
		0,
	],
	[
		"advisory: loop guard before suspension",
		"class S extends Store { value = 0; async run() { while (!this.signal.aborted) { await work(); this.value++ } } }",
		0,
	],
	[
		"advisory: loop revalidation",
		"class S extends Store { value = 0; async run() { for (const item of items) { await work(item); if (this.signal.aborted) return; this.value++ } } }",
		0,
	],
	[
		"advisory: finally cleanup remains legitimate",
		"class S extends Store { pending = null; async run() { try { await work() } finally { this.pending = null; releaseResource() } } }",
		0,
	],
	[
		"advisory: independent additive concurrency",
		"class M extends Model { count = 0 } class S extends Store { async add(model: M) { await work(); model.count++ } }",
		0,
	],
	[
		"advisory: held Model state",
		"class M extends Model { value = 0 } class S extends Store { model = M.create(); async run() { const model = this.model; await work(); model.value = 1 } }",
		0,
	],
	[
		"advisory: aliases",
		"import { Store as Base } from 'r-state-tree'; class S extends Base { value = 0; async run() { const self = this; const signal = this.signal; await work(); if (signal.aborted) return; self.value = 1 } }",
		0,
	],
	[
		"advisory: shadowed Store",
		"function make(Store: any) { class S extends Store { async run() { await work(); this.value = 1 } } }",
		0,
	],
	[
		"advisory: unrelated async class",
		"class S { async run() { await work(); this.value = 1 } }",
		0,
	],
	[
		"advisory: nested deferred continuation",
		"class S extends Store { value = 0; async run() { await work(); return async () => { await work(); this.value = 1 } } }",
		0,
	],
	[
		"advisory: nested function owns this",
		"class S extends Store { async run() { await work(); return async function() { await work(); this.value = 1 } } }",
		0,
	],
];

type Diagnostic = {
	code: string;
	message: string;
	filename: string;
	labels: { span: { offset: number; length: number } }[];
};

export const lintRules = [
	"no-computed-mutation",
	"no-direct-construction",
	"no-plain-collection-mutation",
	"no-observable-collection-replacement",
	"no-discarded-child-read",
];

export function runLintCases(cases: Record<string, Case[]>) {
	const results = new Map<string, Diagnostic[]>();

	let directory: string;

	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "r-state-tree-lint-"));
		for (const [rule, fixtures] of Object.entries(cases)) {
			const folder = join(directory, rule);
			mkdirSync(folder);
			// Isolated, temporary runner configuration: never adopt the suite repo-wide.
			const config = join(folder, "rules.json");
			writeFileSync(
				config,
				JSON.stringify({
					plugins: [],
					categories: { correctness: "off" },
					jsPlugins: [{ name: "r-state-tree", specifier: plugin }],
					rules: { [`r-state-tree/${rule}`]: "error" },
				})
			);
			for (const [index, [, code]] of fixtures.entries())
				writeFileSync(join(folder, `${index}.ts`), header + code);
			const run = spawnSync(
				process.execPath,
				[
					cli,
					"--config",
					config,
					"--disable-nested-config",
					"--no-ignore",
					"--format",
					"json",
					folder,
				],
				{ encoding: "utf8" }
			);
			expect(run.error, run.stderr).toBeUndefined();
			expect([0, 1], run.stderr).toContain(run.status);
			const output = JSON.parse(run.stdout) as { diagnostics: Diagnostic[] };
			for (const [index] of fixtures.entries())
				results.set(`${rule}/${index}`, []);
			for (const diagnostic of output.diagnostics) {
				expect(diagnostic.code, diagnostic.message).toContain(rule);
				const id = `${rule}/${basename(diagnostic.filename, ".ts")}`;
				expect(results.has(id), diagnostic.filename).toBe(true);
				results.get(id)!.push(diagnostic);
			}
		}
	}, 30000);

	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	for (const [rule, fixtures] of Object.entries(cases)) {
		describe(rule, () => {
			for (const [index, [title, code, count]] of fixtures.entries()) {
				test(title, () => {
					const diagnostics = results.get(`${rule}/${index}`)!;
					expect(diagnostics, JSON.stringify(diagnostics)).toHaveLength(count);
					for (const d of diagnostics) {
						expect(d.message).not.toContain("{{");
						if (rule === "no-discarded-child-read") {
							expect(d.message).toContain("Do not eagerly initialize");
							expect(d.message).not.toMatch(/suppress|warmup/i);
						}
						expect(d.labels[0].span.offset).toBeGreaterThanOrEqual(
							header.length
						);
						expect(
							d.labels[0].span.offset + d.labels[0].span.length
						).toBeLessThanOrEqual(header.length + code.length);
					}
				});
			}
		});
	}
}

export { cli, plugin, header, getter, childStore, asyncReviewCases };
export type { Case, Diagnostic };
