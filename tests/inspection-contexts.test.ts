import { buildSync, transformSync } from "esbuild";
import { build, createServer } from "vite";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import {
	Store,
	Model,
	child,
	createStore,
	createContext,
	mount,
} from "../src/index";
import { getStoreAdm } from "../src/store/StoreAdministration";
import {
	createInspector,
	type InspectorOptions,
} from "../devtools/src/inspection/runtime";
import { transformInspectionContexts } from "../devtools/src/inspection/context-transform";
import { transformInspectionSignatures } from "../devtools/src/inspection/signature-transform";
import {
	INSPECTION_CONTEXT,
	INSPECTION_CONTEXTS,
	INSPECTION_CONTEXT_KEY,
	contextMetadata,
} from "../devtools/src/inspection/contexts";
import { rStateTreeInspector } from "../devtools/src/devtools-vite";
import { validateRequest } from "../devtools/src/inspection/protocol";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.reverse()) cleanup();
	cleanups.length = 0;
});
function execute(source: string, globals: Record<string, unknown> = {}) {
	const transformed = transformInspectionContexts(
		`import { createContext } from 'r-state-tree';` + source,
		"fixture.ts"
	);
	const signatures = transformInspectionSignatures(
		transformed?.code ?? source,
		"fixture.ts"
	);
	const { code } = transformSync(
		signatures?.code ?? transformed?.code ?? source,
		{ loader: "ts", format: "cjs", target: "es2022" }
	);
	const module = { exports: {} as any };
	runInNewContext(code, {
		module,
		exports: module.exports,
		Store,
		Model,
		createContext,
		createStore,
		child,
		require: () => ({ createContext }),
		...globals,
	});
	return { ...module.exports, transformed };
}
function setup(
	Class: new (...args: any[]) => Store,
	options: InspectorOptions = {}
) {
	const root = mount(createStore(Class)) as any;
	const inspector = createInspector(options);
	const registration = inspector.registerRoot("Application", root);
	cleanups.push(
		() => root[Symbol.dispose](),
		() => inspector.dispose()
	);
	const inspect = (
		path: string[] = [],
		maxEntries = 500,
		evaluateComputeds = true
	): any =>
		inspector.query({
			op: "inspect",
			rootId: registration.rootId,
			path,
			depth: 4,
			maxEntries,
			evaluateComputeds,
		});
	const read = (contextId: string, path: string[] = [], bounds = {}): any =>
		inspector.query({
			op: "context",
			rootId: registration.rootId,
			path,
			contextId,
			...bounds,
		});
	return { root, inspector, ...registration, inspect, read };
}

test("source metadata distinguishes no default vs explicit undefined without copying default source or changing Context shape", () => {
	const { Root, Missing, UndefinedDefault, Value, transformed } = execute(`
		const Missing = createContext<string>();
		const UndefinedDefault = createContext<string | undefined>(undefined);
		const Value = createContext<string>("PRIVATE_DEFAULT_EXPRESSION");
		export { Missing, UndefinedDefault, Value };
		export class Root extends Store {
			missing() { return Missing.consume(this); }
			undefinedDefault() { return UndefinedDefault.consume(this); }
			value() { return Value.consume(this); }
		}
	`);
	expect(contextMetadata(Missing).hasDefault).toBe(false);
	expect(contextMetadata(UndefinedDefault).hasDefault).toBe(true);
	expect(
		Object.getOwnPropertyDescriptor(Value, INSPECTION_CONTEXT)?.value
	).toEqual({ name: "Value", type: "string", hasDefault: true });
	expect(Object.keys(Value)).toEqual(["defaultValue", "provide", "consume"]);
	expect(transformed.code.split("PRIVATE_DEFAULT_EXPRESSION")).toHaveLength(2);
	const f = setup(Root);
	expect(f.inspect().contexts.map((c: any) => [c.name, c.status])).toEqual([
		["Missing", "unavailable"],
		["UndefinedDefault", "default"],
		["Value", "default"],
	]);
	for (const item of f.inspect().contexts)
		expect(f.read(item.contextId).ok).toBe(true);
});

test("nearest providers follow real Store parents; ordinary references and Models do not inherit; discovery is inert", () => {
	const counters = { calls: 0 };
	const { Root } = execute(
		`
		const Theme = createContext<string>("default");
		export class Leaf extends Store { read() { return Theme.consume(this); } get current() { return Theme.consume(this); } }
		class Middle extends Store {
			static types = { leaf: child };
			get leaf() { return createStore(Leaf); }
			[Theme.provide]() { counters.calls++; return "middle"; }
		}
		export class Root extends Store {
			static types = { middle: child };
			get middle() { return createStore(Middle); }
			[Theme.provide]() { counters.calls++; return "root"; }
		}
	`,
		{ counters }
	);
	const f = setup(Root);
	const leaf = f.root.middle.leaf;
	expect(counters.calls).toBe(0);
	const overview = f.inspect([], 500, false);
	expect(counters.calls).toBe(0);
	expect(overview.contexts[0].status).toBe("provided");
	const structured = f.inspect(["middle", "leaf"], 500, false);
	const meta = structured.contexts[0];
	expect(
		structured.fields.find((field: any) => field.name === "current").value
	).toMatchObject({ kind: "deferred" });
	expect(counters.calls).toBe(0);
	const normal = f.inspect(["middle", "leaf"]);
	expect(
		normal.fields.find((field: any) => field.name === "current").value
	).toBe("middle");
	expect(counters.calls).toBe(1);
	expect(meta).toMatchObject({
		name: "Theme",
		type: "string",
		status: "inherited",
		providerClass: "Middle",
		declared: true,
	});
	expect(f.read(meta.contextId, ["middle", "leaf"])).toEqual({
		ok: true,
		result: "middle",
	});
	expect(counters.calls).toBe(1);
	const detached = setup(leaf.constructor);
	expect(detached.inspect().contexts[0].status).toBe("default");
	class Example extends Model {}
	const model = Example.create({});
	const registration = f.inspector.registerRoot("model", model);
	expect(
		f.inspector.query({ op: "inspect", rootId: registration.rootId })
	).not.toHaveProperty("contexts");
	// A regular object reference is not parentage.
	f.root.reference = detached.root;
	expect(f.inspect(["reference"]).contexts[0].status).toBe("default");
});

test("same labels remain distinct by object identity; inherited declarations and constructors are inferred, replacements do not borrow metadata", () => {
	const { Root, First, Second, Base } = execute(`
		const First = (() => { const Same = createContext<string>("one"); return Same; })();
		const Second = (() => { const Same = createContext<string>("two"); return Same; })();
		export { First, Second };
		export class Base extends Store {
			constructor(...args: any[]) { super(...args); this.effect(() => First.consume(this)); }
			readSecond() { return Second.consume(this); }
			[First.provide]() { return "provided"; }
		}
		export class Root extends Base {}
	`);
	const f = setup(Root);
	const rows = f.inspect().contexts;
	expect(rows).toHaveLength(2);
	expect(rows.map((c: any) => c.name)).toEqual(["Same", "Same"]);
	expect(new Set(rows.map((c: any) => c.contextId)).size).toBe(2);
	expect(rows.find((c: any) => c.status === "provided")).toMatchObject({
		declared: true,
		providerClass: "Root",
	});
	Object.defineProperty(Base.prototype, First.provide, {
		value() {
			return "replacement";
		},
		configurable: true,
	});
	const replaced = f
		.inspect()
		.contexts.find(
			(c: any) =>
				c.contextId === rows.find((r: any) => r.status === "provided").contextId
		);
	expect(replaced.status).toBe("unavailable");
	expect(replaced).not.toHaveProperty("providerId");
	expect(f.read(replaced.contextId)).toEqual({ ok: true, result: "provided" }); // normal core cache semantics, no inspector invalidation
	Object.defineProperty(Base.prototype, "readSecond", {
		value() {
			return 5;
		},
		configurable: true,
	});
	expect(f.inspect().contexts).toHaveLength(1);
	expect(Second.consume).toBeTypeOf("function");
});

test("redaction blocks synthetic Context and provider paths before providers execute, including secret names and nested values", () => {
	const counters = { calls: 0 };
	const value = { visible: 1, nested: { password: "HIDDEN", allowed: 2 } };
	const { Root } = execute(
		`
		const Theme = createContext<object>();
		const SecretContext = createContext<string>();
		class Leaf extends Store { read() { return Theme.consume(this); } secretRead() { return SecretContext.consume(this); } }
		export class Root extends Store {
			static types = { leaf: child };
			get leaf() { return createStore(Leaf); }
			[Theme.provide]() { counters.calls++; return value; }
			[SecretContext.provide]() { counters.calls++; return "HIDDEN"; }
		}
	`,
		{ counters, value }
	);
	const f = setup(Root, { redact: (p) => p.join("/") === "$context/Theme" });
	void f.root.leaf;
	const selected = f.inspect(["leaf"]).contexts;
	expect(selected.every((c: any) => c.status === "redacted")).toBe(true);
	for (const item of selected)
		expect(() => f.read(item.contextId, ["leaf"])).toThrow(/Redacted/);
	expect(counters.calls).toBe(0);
	const g = setup(Root);
	const item = g.inspect().contexts.find((c: any) => c.name === "Theme");
	const result = g.read(item.contextId, [], { depth: 4, maxEntries: 100 });
	expect(JSON.stringify(result)).not.toContain("HIDDEN");
	expect(JSON.stringify(result)).toContain("redacted");
	expect(JSON.stringify(result)).not.toContain('"controls"');
	const h = setup(Root, { redact: (p) => p.at(-1) === "$context" });
	expect(h.inspect().contexts.every((c: any) => c.status === "redacted")).toBe(
		true
	);
});

test("provider failures are withheld; returned objects are not capabilities; disposal/unregister invalidate reads and IDs are query-scoped", () => {
	const { Root } = execute(`
		const Bad = createContext<string>();
		export class Root extends Store { [Bad.provide]() { throw new Error("PRIVATE_FAILURE"); } }
	`);
	const f = setup(Root, { controls: true });
	const item = f.inspect().contexts[0];
	expect(f.read(item.contextId)).toEqual({
		ok: false,
		error: "Context evaluation failed (details withheld)",
	});
	const other = setup(class Other extends Store {});
	expect(() => other.read(item.contextId)).toThrow(/Unknown Context/);
	f.unregister();
	expect(() => f.read(item.contextId)).toThrow(/Unknown root/);
	const reg = f.inspector.registerRoot("again", f.root);
	f.root[Symbol.dispose]();
	expect(() =>
		f.inspector.query({
			op: "context",
			rootId: reg.rootId,
			contextId: item.contextId,
		})
	).toThrow(/Disposed/);
	f.inspector.dispose();
	expect(() => f.inspect()).toThrow(/disposed/);
});

test("metadata uses leftover budget; no eager provider or defaultValue read, no ambient registration", () => {
	const { Root, Theme } = execute(`
		const Theme = createContext<string>("default"); export { Theme };
		export class Root extends Store { count = 1; read() { return Theme.consume(this); } }
	`);
	Object.defineProperty(Theme, "defaultValue", {
		get() {
			throw new Error("must not read default");
		},
	});
	const f = setup(Root);
	const full = f.inspect();
	expect(full.fields.find((field: any) => field.name === "count").value).toBe(
		1
	);
	expect(full.contexts[0].status).toBe("default");
	const minimal = f.inspect([], 2);
	expect(minimal.fields).toEqual([]);
	expect(minimal).not.toHaveProperty("contexts");
	expect(getStoreAdm(f.root).parent).toBeNull();
});

test("transform is insertion-only, skips unsafe expressions and local shadows, records safe imported references without reading accessors", () => {
	const source = `const Theme = createContext<string>("default");\nexport class Root extends Store {\nread(Theme: any) { return Theme.consume(this); }\nunsafe() { return getContext().consume(this); }\n[Theme.provide]() { return "provided"; }\n}\n`;
	const { Root, transformed } = execute(source);
	expect(transformed.code.split("\n")).toHaveLength(source.split("\n").length);
	expect(
		Object.getOwnPropertyDescriptor(Root.prototype, INSPECTION_CONTEXTS)?.value
	).toHaveLength(1);
	const f = setup(Root);
	expect(f.inspect().contexts[0]).not.toHaveProperty("declared");
	expect(transformInspectionContexts(source, "fixture.js")).toBeUndefined();
	expect(transformInspectionContexts(source, "fixture.d.ts")).toBeUndefined();
	expect(
		transformInspectionContexts("class { broken", "fixture.ts")
	).toBeUndefined();
});

test("provider redaction follows ownership even when a descendant is selected through an ordinary alias", () => {
	const counters = { calls: 0 };
	const { Root } = execute(
		`
		const Theme = createContext<string>();
		class Leaf extends Store { read() { return Theme.consume(this); } }
		class Middle extends Store { static types = { leaf: child }; get leaf() { return createStore(Leaf); } [Theme.provide]() { counters.calls++; return "hidden"; } }
		export class Root extends Store { static types = { middle: child }; get middle() { return createStore(Middle); } }
	`,
		{ counters }
	);
	const f = setup(Root, { redact: (p) => p[0] === "middle" });
	f.root.alias = f.root.middle.leaf;
	const item = f.inspect(["alias"]).contexts[0];
	expect(item.status).toBe("redacted");
	expect(() => f.read(item.contextId, ["alias"])).toThrow(/Redacted/);
	expect(counters.calls).toBe(0);
});

test("explicit Context result objects cannot become navigation/control capabilities and remain bounded", () => {
	const { Root } = execute(
		`
		const Value = createContext<object>();
		export class Root extends Store { [Value.provide]() { return returned; } }
	`,
		{
			returned: { count: 1, nested: { visible: true }, long: "x".repeat(1000) },
		}
	);
	const f = setup(Root, { controls: true });
	const item = f.inspect().contexts[0];
	const result = f.read(item.contextId, [], { maxEntries: 3, depth: 2 });
	expect(result.ok).toBe(true);
	expect(result.result).not.toHaveProperty("controls");
	expect(result.result.fields).toHaveLength(2);
	expect(() =>
		f.inspector.query({ op: "inspect", rootId: result.result.id })
	).toThrow(/Unknown root/);
	expect(() =>
		f.inspector.query({
			op: "set",
			rootId: result.result.id,
			field: "count",
			value: 2,
		})
	).toThrow(/Unknown root/);
	expect(() =>
		f.inspector.query({
			op: "inspect",
			rootId: f.rootId,
			path: ["$context", item.name],
		})
	).toThrow(/Unknown field/);
});

test("structure-only inspect defers all ordinary computeds and key getters but traverses retained realized ownership", () => {
	const counters = { computed: 0, provider: 0, key: 0, child: 0 };
	const { Root } = execute(
		`
		const Theme = createContext<string>();
		class Leaf extends Store { count = 1; }
		export class Root extends Store {
			static types = { lazy: child, realized: child };
			get lazy() { counters.child++; return createStore(Leaf); }
			get realized() { counters.child++; return createStore(Leaf); }
			get key() { counters.key++; return "app-key"; }
			read() { return Theme.consume(this); }
			get value() { counters.computed++; return this.read(); }
			[Theme.provide]() { counters.provider++; return "provided"; }
		}
	`,
		{ counters }
	);
	const f = setup(Root);
	void f.root.realized;
	Object.assign(counters, { computed: 0, provider: 0, key: 0, child: 0 });
	const result = f.inspect([], 500, false);
	expect(counters).toEqual({ computed: 0, provider: 0, key: 0, child: 0 });
	expect(result.key).toEqual({
		kind: "deferred",
		detail: "Computed value not evaluated",
	});
	expect(
		result.fields.find((field: any) => field.name === "lazy").value.kind
	).toBe("uninitialized");
	expect(
		result.fields.find((field: any) => field.name === "realized").value.kind
	).toBe("Store");
	expect(
		result.fields.find((field: any) => field.name === "value").value.kind
	).toBe("deferred");
	expect(() =>
		f.inspector.query({
			op: "inspect",
			rootId: f.rootId,
			path: ["value"],
			evaluateComputeds: false,
		})
	).toThrow(/Computed selection not evaluated/);
	expect(counters.provider).toBe(0);
	const normal = f.inspect();
	expect(normal.fields.find((field: any) => field.name === "value").value).toBe(
		"provided"
	);
	expect(counters.provider).toBe(1);
	expect(counters.computed).toBe(1);
	expect(counters.key).toBeGreaterThan(0);
	expect(() =>
		validateRequest({
			op: "inspect",
			rootId: f.rootId,
			evaluateComputeds: "false",
		})
	).toThrow(/evaluateComputeds/);
});

test("untransformed Contexts use honest source-reference labels and honor secret names without reading defaultValue", () => {
	const ordinary = createContext("actual-default");
	const secret = createContext("hidden-default");
	Object.defineProperty(ordinary, "defaultValue", {
		get() {
			throw new Error("must not read");
		},
	});
	const { Root } = execute(
		`
		const Untransformed = ordinary;
		const SecretContext = secret;
		export class Root extends Store { read() { return Untransformed.consume(this); } secretRead() { return SecretContext.consume(this); } }
	`,
		{ ordinary, secret }
	);
	const f = setup(Root);
	const rows = f.inspect().contexts;
	expect(rows).toMatchObject([
		{ name: "Untransformed", status: "unavailable" },
		{ name: "SecretContext", status: "redacted" },
	]);
	expect(f.read(rows[0].contextId)).toEqual({
		ok: true,
		result: "actual-default",
	});
	expect(() => f.read(rows[1].contextId)).toThrow(/Redacted/);
});

test("application static replacements cannot borrow source-declared consumer/provider identities", () => {
	const { Root } = execute(`
		const Provided = createContext<string>("default");
		const Removed = createContext<string>("removed");
		export class Root extends Store {
			[Provided.provide]() { return "original"; }
			read() { return Provided.consume(this); }
			removed() { return Removed.consume(this); }
			static { this.prototype[Provided.provide] = function() { return "replacement"; }; this.prototype.removed = function() { return "not-context"; }; }
		}
	`);
	const f = setup(Root);
	const rows = f.inspect().contexts;
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		name: "Provided",
		status: "unavailable",
		declared: true,
	});
	expect(rows[0]).not.toHaveProperty("providerId");
	expect(f.read(rows[0].contextId)).toEqual({
		ok: true,
		result: "replacement",
	});
});

test("spread defaults are marked unknown rather than inventing default presence", () => {
	const { Root, Empty, Present } = execute(`
		const Empty = createContext<string>(...[]);
		const Present = createContext<string>(...[undefined]);
		export { Empty, Present };
		export class Root extends Store { empty() { return Empty.consume(this); } present() { return Present.consume(this); } }
	`);
	expect(contextMetadata(Empty).hasDefault).toBeUndefined();
	expect(contextMetadata(Present).hasDefault).toBeUndefined();
	const f = setup(Root);
	expect(
		f.inspect().contexts.every((item: any) => item.status === "unavailable")
	).toBe(true);
});

test("readonly method metadata and Contexts never displace live fields under a tight budget", () => {
	const { Root } = execute(`
		const Theme = createContext<string>("default");
		export class Root extends Store { first = 1; second = 2; read(value: number) { return Theme.consume(this); } }
	`);
	const f = setup(Root);
	const tight = f.inspect([], 5);
	expect(
		tight.fields
			.filter((field: any) => field.name !== "props")
			.map((field: any) => [field.name, field.value])
	).toEqual([
		["first", 1],
		["second", 2],
	]);
	expect(tight.methods).toEqual([]);
	expect(tight).not.toHaveProperty("contexts");
	const normal = f.inspect();
	expect(normal.methods[0]).toMatchObject({
		name: "read",
		parameters: [{ name: "value", type: "number" }],
	});
	expect(normal).not.toHaveProperty("controls");
	expect(
		normal.fields.every((field: any) => field.writable === undefined)
	).toBe(true);
});

test("factory extraction requires proven package/source imports and respects lexical shadowing, never mutating React/custom factories", () => {
	for (const source of [
		`import { createContext } from 'react'; const Theme = createContext(null);`,
		`function createContext() { return Object.freeze({}); } const Theme = createContext();`,
		`const createContext = () => 1; const Theme = createContext();`,
		`import { createContext } from 'r-state-tree'; function run(createContext: any) { const Theme = createContext(); }`,
		`import { createContext } from 'r-state-tree'; for (const createContext of []) { const Theme = createContext(); }`,
		`import { createContext } from 'r-state-tree'; try {} catch (createContext) { const Theme = createContext(); }`,
	])
		expect(transformInspectionContexts(source, "fixture.ts")).toBeUndefined();
	for (const source of [
		"r-state-tree",
		"../../src/index",
		"../src/context",
		"../src",
	]) {
		const result = transformInspectionContexts(
			`import { createContext as context } from '${source}'; const Theme = context<string>();`,
			"fixture.ts"
		);
		expect(result?.code).toContain(INSPECTION_CONTEXT_KEY);
	}
	// Source-index paths may be unrelated app barrels: attachment must be shape-checked.
	const getter = vi.fn(() => {
		throw new Error("getter must not run");
	});
	const accessor = Object.defineProperty({ provide: Symbol() }, "consume", {
		get: getter,
	});
	for (const source of ["r-state-tree", "../src/index"])
		for (const original of [Object.freeze({}), {}, accessor, 42, null]) {
			const transformed = transformInspectionContexts(
				`import { createContext } from '${source}'; export const Theme = createContext();`,
				"fixture.ts"
			)!;
			const { code } = transformSync(transformed.code, {
				loader: "ts",
				format: "cjs",
				target: "es2022",
			});
			const module = { exports: {} as any };
			runInNewContext(code, {
				module,
				exports: module.exports,
				require: () => ({ createContext: () => original }),
			});
			expect(module.exports.Theme).toBe(original);
			if (original && typeof original === "object")
				expect(
					Object.getOwnPropertyDescriptor(original, INSPECTION_CONTEXT)
				).toBeUndefined();
		}
	expect(getter).not.toHaveBeenCalled();
});

test("browser bundles exclude Node Context extraction; actual Vite builds omit Context instrumentation", async () => {
	const browser = buildSync({
		entryPoints: ["src/index.ts", "devtools/src/devtools.ts"],
		bundle: true,
		write: false,
		metafile: true,
		platform: "browser",
		outdir: "unused",
		logLevel: "silent",
	});
	expect(
		Object.keys(browser.metafile!.inputs).some((path) =>
			/context-transform|node_modules\/(?:vite|typescript|esbuild|rolldown)\//.test(
				path
			)
		)
	).toBe(false);
	const dir = await realpath(await mkdtemp(join(tmpdir(), "rst-context-")));
	const config = {
		configFile: false as const,
		root: dir,
		logLevel: "silent" as const,
		resolve: { alias: { "r-state-tree": resolve("src/index.ts") } },
		plugins: [rStateTreeInspector()],
		server: { fs: { allow: [dir, await realpath(process.cwd())] } },
	};
	await writeFile(
		join(dir, "fixture.ts"),
		`import { createContext, Store } from "r-state-tree"; const Theme = createContext<string>("default"); export class Fixture extends Store { read() { return Theme.consume(this); } [Theme.provide]() { return "provided"; } }`
	);
	await writeFile(
		join(dir, "index.html"),
		'<script type="module">import { Fixture } from "./fixture.ts"; globalThis.Fixture = Fixture;</script>'
	);
	const server = await createServer(config);
	try {
		expect((await server.transformRequest("/fixture.ts"))?.code).toContain(
			INSPECTION_CONTEXT_KEY
		);
		expect(
			(await server.transformRequest("/fixture.ts?raw"))?.code
		).not.toContain(INSPECTION_CONTEXT_KEY);
		await server.close();
		const result = await build({
			...config,
			plugins: [rStateTreeInspector()],
			mode: "development",
			build: { write: false, minify: false },
		});
		if (Array.isArray(result) || !("output" in result))
			throw new Error("Unexpected output");
		const output = result.output
			.map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
			.join("\n");
		expect(output).not.toContain(INSPECTION_CONTEXT_KEY);
		expect(output).not.toContain("r-state-tree.inspection.contexts.v1");
	} finally {
		await server.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("Vite guards production/dependency/raw Context extraction and validates bounded Context requests", () => {
	const source = `import { createContext } from 'r-state-tree'; const Theme = createContext<string>(); class Example { read() { return Theme.consume(this); } }`;
	const plugin = rStateTreeInspector();
	const config = {
		command: "serve",
		isProduction: false,
		root: "/tmp",
		publicDir: false,
		server: { fs: { strict: true } },
	};
	(plugin.configResolved as any)(config);
	expect((plugin.transform as any)(source, "/tmp/example.ts").code).toContain(
		INSPECTION_CONTEXT_KEY
	);
	for (const id of [
		"/tmp/node_modules/example.ts",
		"/tmp/example.ts?raw",
		"/tmp/example.ts?url",
	])
		expect((plugin.transform as any)(source, id)).toBeUndefined();
	(plugin.configResolved as any)({
		...config,
		command: "build",
		isProduction: true,
	});
	expect((plugin.transform as any)(source, "/tmp/example.ts")).toBeUndefined();
	expect(() =>
		validateRequest({
			op: "context",
			rootId: "x",
			contextId: "c",
			path: ["leaf"],
			maxEntries: 500,
		})
	).not.toThrow();
	for (const request of [
		{ contextId: "" },
		{ contextId: 2 },
		{ path: ["constructor"] },
		{ maxEntries: 501 },
		{ depth: 0 },
	])
		expect(() =>
			validateRequest({
				op: "context",
				rootId: "x",
				contextId: "c",
				...request,
			})
		).toThrow();
});
