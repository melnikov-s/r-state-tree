import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
	cli,
	plugin,
	header,
	asyncReviewCases,
	lintRules,
} from "./helpers/lint";
import type { Diagnostic } from "./helpers/lint";

let directory: string;
beforeAll(() => {
	directory = mkdtempSync(join(tmpdir(), "r-state-tree-lint-"));
});
afterAll(() => {
	if (directory) rmSync(directory, { recursive: true, force: true });
});

test("published subpath loads as a standalone plugin without importing the runtime", () => {
	const run = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import plugin from 'r-state-tree/lint'; console.log(JSON.stringify(Object.keys(plugin.rules)))`,
		],
		{ encoding: "utf8" }
	);
	expect(run.status, run.stderr).toBe(0);
	expect(JSON.parse(run.stdout)).toEqual(lintRules);
});

test("oxlint CLI all-rule adoption emits diagnostics and exits cleanly for valid input", () => {
	const config = join(directory, "all-rules.json");
	writeFileSync(
		config,
		JSON.stringify({
			plugins: [],
			categories: { correctness: "off" },
			jsPlugins: [{ name: "r-state-tree", specifier: plugin }],
			rules: Object.fromEntries(
				lintRules.map((rule) => [`r-state-tree/${rule}`, "error"])
			),
		})
	);
	const valid = join(directory, "valid.ts");
	writeFileSync(
		valid,
		header +
			`class Valid extends Store {
		rows = observable([]);
		@computed get sorted() { const result = [...this.rows]; result.sort(); return result }
		@child get item() { return createStore(Valid, { onClick: () => this.rows.push(1) }) }
		edit() { this.rows.push(1) }
	}
	const root = createStore(Valid);`
	);
	const invalid = join(directory, "invalid.ts");
	writeFileSync(
		invalid,
		header +
			`class Invalid extends Model {
		rows = []; tracked = observable([]); count = 0;
		get derived() { this.count++; return 0 }
		edit() { this.rows.push(1); this.tracked = [] }
	}
	new Invalid();
	class Lazy extends Store {
		@child get worker() { return createStore(Lazy) }
		run() { void this.worker; }
	}`
	);
	const invoke = (path: string) =>
		spawnSync(
			process.execPath,
			[
				cli,
				"--config",
				config,
				"--disable-nested-config",
				"--no-ignore",
				"--format",
				"json",
				path,
			],
			{ encoding: "utf8" }
		);
	const clean = invoke(valid);
	expect(clean.status, clean.stdout + clean.stderr).toBe(0);
	expect(JSON.parse(clean.stdout).diagnostics).toEqual([]);
	const dirty = invoke(invalid);
	expect(dirty.status, dirty.stdout + dirty.stderr).toBe(1);
	const diagnostics = (
		JSON.parse(dirty.stdout) as { diagnostics: Diagnostic[] }
	).diagnostics;
	expect(diagnostics).toHaveLength(5);
	for (const rule of lintRules)
		expect(diagnostics.some((d) => d.code.includes(rule))).toBe(true);
});

test("discarded-child initialization is a problem with no automatic fix", () => {
	const run = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`
		import plugin from 'r-state-tree/lint';
		const meta = plugin.rules['no-discarded-child-read'].meta;
		console.log(JSON.stringify({ type: meta.type, fixable: !!meta.fixable, suggestions: !!meta.hasSuggestions }));
	`,
		],
		{ encoding: "utf8" }
	);
	expect(run.status, run.stderr).toBe(0);
	expect(JSON.parse(run.stdout)).toEqual({
		type: "problem",
		fixable: false,
		suggestions: false,
	});
});

test("all rules leave async policies to review, including deliberately unsafe scope fixtures", () => {
	const folder = join(directory, "async-policy");
	mkdirSync(folder);
	const config = join(folder, "rules.json");
	writeFileSync(
		config,
		JSON.stringify({
			plugins: [],
			categories: { correctness: "off" },
			jsPlugins: [{ name: "r-state-tree", specifier: plugin }],
			rules: Object.fromEntries(
				lintRules.map((rule) => [`r-state-tree/${rule}`, "warn"])
			),
		})
	);
	for (const [index, [, code]] of asyncReviewCases.entries())
		writeFileSync(join(folder, `${index}.ts`), header + code);
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
			"json",
			folder,
		],
		{ encoding: "utf8" }
	);
	expect(run.status, run.stdout + run.stderr).toBe(0);
	expect(JSON.parse(run.stdout).diagnostics).toEqual([]);
});

test("fixture adoption checks source imports with all rules and reports original paths", () => {
	const fixtures = join(directory, "fixture-adoption");
	mkdirSync(fixtures);
	const example = join(fixtures, "fixture.ts");
	const invoke = () =>
		spawnSync(process.execPath, ["scripts/lint-fixtures.mjs", fixtures], {
			encoding: "utf8",
		});
	writeFileSync(
		example,
		`import { Model, Store, child, createStore, observable } from "../../src/index";
class Invalid extends Model {
	rows = []; tracked = observable([]); count = 0;
	get derived() { this.count++; return 0 }
	edit() { this.rows.push(1); this.tracked = [] }
}
new Invalid();
class Lazy extends Store {
	@child get worker() { return createStore(Lazy) }
	run() { void this.worker; }
}`
	);
	const dirty = invoke();
	expect(dirty.status, dirty.stdout + dirty.stderr).toBe(1);
	for (const rule of lintRules) expect(dirty.stdout).toContain(rule);
	expect(dirty.stdout).toContain(`${example}:4:`);
	writeFileSync(
		example,
		`import { Model, observable } from "../../src/index";
class Valid extends Model {
	rows = observable([]);
	get derived() { return this.rows.length }
	edit() { this.rows.push(1) }
}
Valid.create();`
	);
	const clean = invoke();
	expect(clean.status, clean.stdout + clean.stderr).toBe(0);
	expect(clean.stdout).toContain(
		`Checked all ${lintRules.length} RStateTree rules in 1 fixture files.`
	);
});
