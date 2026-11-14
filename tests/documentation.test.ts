import {
	existsSync,
	readFileSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { child, createStore, mount, Store } from "../src";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

function snippet(path: string, heading: string, language = "ts"): string {
	const markdown = readFileSync(join(root, path), "utf8");
	const section = markdown.split(heading)[1];
	if (!section) throw new Error(`Missing heading: ${heading}`);
	const code = section.match(
		new RegExp("```" + language + "\\n([\\s\\S]*?)```")
	)?.[1];
	if (!code) throw new Error(`Missing ${language} example: ${heading}`);
	return code;
}

// Type-check the extracted text too: a successful esbuild transform alone
// would not catch invalid props, duplicate fields, or missing declarations.
function checkTypes(code: string, extension = "ts"): void {
	const dir = mkdtempSync(join(root, "node_modules/.rst-docs-"));
	try {
		const path = join(dir, `example.${extension}`);
		writeFileSync(
			path,
			code
				.replaceAll('"r-state-tree"', JSON.stringify(join(root, "src/index")))
				.replaceAll(
					'"r-state-tree/react"',
					JSON.stringify(join(root, "src/react"))
				)
		);
		// TypeScript 7 exposes a CLI rather than the former createProgram API.
		execFileSync(
			join(root, "node_modules/.bin/tsc"),
			[
				"--ignoreConfig",
				"--noEmit",
				"--strict",
				"--skipLibCheck",
				"--target",
				"es2022",
				"--module",
				"esnext",
				"--moduleResolution",
				"bundler",
				"--jsx",
				"react-jsx",
				"--useDefineForClassFields",
				"true",
				"--types",
				"node",
				"--lib",
				"es2022,esnext.disposable,dom",
				path,
			],
			{ encoding: "utf8", stdio: "pipe" }
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function execute(code: string, loader: "ts" | "tsx" = "ts") {
	const result = await build({
		stdin: { contents: code, loader, resolveDir: root },
		bundle: true,
		write: false,
		format: "cjs",
		platform: "node",
		target: "es2022",
		packages: "external",
		alias: {
			"r-state-tree/react": join(root, "src/react.ts"),
			"r-state-tree": join(root, "src/index.ts"),
		},
		jsx: "automatic",
		tsconfigRaw: {
			compilerOptions: {
				experimentalDecorators: false,
				useDefineForClassFields: true,
			},
		},
	});
	const module = { exports: {} as Record<string, unknown> };
	compileFunction(result.outputFiles[0].text, ["require", "module", "exports"])(
		require,
		module,
		module.exports
	);
	return module.exports;
}

test("documentation links point to existing repository files", () => {
	for (const path of [
		"README.md",
		"docs/architecture.md",
		"docs/reference.md",
		"docs/toolchains.md",
		"skills/r-state-tree/SKILL.md",
		"skills/r-state-tree/references/core-api.md",
		"skills/r-state-tree/references/react.md",
		"skills/r-state-tree/references/architecture-and-refactoring.md",
	]) {
		const markdown = readFileSync(join(root, path), "utf8");
		for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
			const target = match[1].split("#")[0];
			if (!target || /^\w+:/.test(target)) continue;
			expect(
				existsSync(resolve(root, dirname(path), target)),
				`${path}: ${target}`
			).toBe(true);
		}
	}
});

test("README quick start type-checks and runs without decorators", async () => {
	const code = snippet("README.md", "## Quick start");
	checkTypes(code);
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		await execute(code);
		expect(log.mock.calls).toEqual([["Count: 1"], [{ id: "main", count: 1 }]]);
	} finally {
		log.mockRestore();
	}
});

test("README React quick start type-checks and server-renders a realized Store", async () => {
	const code = snippet("README.md", "## React quick start", "tsx");
	checkTypes(code, "tsx");
	const example = (await execute(
		code + `\nexport { createStore, mount } from "r-state-tree";`,
		"tsx"
	)) as {
		App: ComponentType<{ store: Store }>;
		CounterStore: new (...args: never[]) => Store;
		createStore: (Type: unknown) => Store;
		mount: (descriptor: Store) => Store;
	};
	const store = example.mount(example.createStore(example.CounterStore));
	try {
		expect(renderToString(createElement(example.App, { store }))).toBe(
			"<button>0</button>"
		);
		expect(store.signal.aborted).toBe(false);
	} finally {
		store[Symbol.dispose]();
	}
});

test("reference example hydrates Model children and resolves references", async () => {
	const code = snippet("docs/reference.md", "### Model references");
	checkTypes(code);
	const example = await execute(
		code.replace(
			"project[Symbol.dispose]();",
			"export const ownerName = project.owner?.name;\nproject[Symbol.dispose]();"
		)
	);
	expect(example.ownerName).toBe("Alice");
});

test("descriptors are fresh; child reconciliation owns keyed instance identity", () => {
	let constructions = 0;
	class Leaf extends Store<{ label: string }> {
		instanceNumber = ++constructions;
	}
	const first = createStore(Leaf, { key: 1, label: "first" });
	const second = createStore(Leaf, { key: 1, label: "second" });
	expect(first).not.toBe(second);
	expect(first).not.toBeInstanceOf(Leaf);
	expect(constructions).toBe(0);

	class Root extends Store {
		ids = [1, 2];
		label = "initial";
		@child get children() {
			return this.ids.map((key) =>
				createStore(Leaf, { key, label: this.label })
			);
		}
		@child get other() {
			return createStore(Leaf, { key: 1, label: this.label });
		}
	}
	const root = mount(createStore(Root));
	const otherRoot = mount(createStore(Root));
	try {
		const original = root.children[0];
		root.ids = [2, 1];
		root.label = "updated";
		expect(root.children[1]).toBe(original);
		expect(original.props.label).toBe("updated");
		expect(root.other).not.toBe(original);
		expect(otherRoot.children[0]).not.toBe(original);
		root.ids = [2];
		expect(original.signal.aborted).toBe(true);
		root.ids = [1, 2];
		expect(root.children[0]).not.toBe(original);
	} finally {
		root[Symbol.dispose]();
		otherRoot[Symbol.dispose]();
	}
});

test("toolchain fallback hydrates Model children without decorators", async () => {
	const code = snippet("docs/toolchains.md", "To avoid that dependency");
	checkTypes(code);
	const example = await execute(
		code.replace(
			"project[Symbol.dispose]();",
			"export const userName = project.users[0].name;\nproject[Symbol.dispose]();"
		)
	);
	expect(example.userName).toBe("Ada");
});
