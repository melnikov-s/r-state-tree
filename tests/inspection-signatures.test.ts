import { buildSync, transformSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { build, createServer } from "vite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Store,
	Model,
	Observable,
	createStore,
	mount,
	source,
} from "../src/index";
import { createInspector } from "../src/inspection/runtime";
import { rStateTreeInspector } from "../src/devtools-vite";
import { transformInspectionSignatures } from "../src/inspection/signature-transform";
import {
	INSPECTION_SIGNATURES,
	INSPECTION_SIGNATURES_KEY,
	lookupInspectionMethod,
} from "../src/inspection/signatures";

function execute(source: string, id = "fixture.ts") {
	const transformed = transformInspectionSignatures(source, id);
	const { code } = transformSync(transformed?.code ?? source, {
		loader: id.endsWith("tsx") ? "tsx" : "ts",
		format: "cjs",
		target: "es2022",
	});
	const module = { exports: {} as any };
	runInNewContext(code, { module, exports: module.exports, Store });
	return { exports: module.exports, transformed };
}
function method(value: object, name: string) {
	const fn = Reflect.get(value, name);
	return lookupInspectionMethod(value, name, fn);
}

test("pre-transform executes and links annotated/default/optional/rest metadata to actual methods without invocation", () => {
	const { exports, transformed } = execute(`
		import type { External } from './not-resolved';
		export class Fixture {
			calls = 0;
			set(name: string, count: number = expensive('TOP_SECRET'), enabled?: boolean, ...items: number[]): Promise<void> { this.calls++; throw new Error('never'); }
			arrow = (amount = 2, text = 'PRIVATE_DEFAULT', flag = false) => { this.calls++; };
			context: (amount: number) => boolean = (renamed) => !!renamed;
			optionalContext: (value?: number) => string = (value) => value === undefined ? 'omitted' : String(value);
			external(config: External, value: {x: number}, list: string[]) {}
		}
	`);
	expect(transformed?.code).not.toContain('"defaultValue":"PRIVATE_DEFAULT"');
	const fixture = new exports.Fixture();
	expect(fixture.calls).toBe(0);
	expect(method(fixture, "optionalContext")?.parameters).toEqual([
		{ name: "value", type: "number", kind: "number", optional: true },
	]);
	expect(fixture.optionalContext()).toBe("omitted");
	expect(fixture.arrow.name).toBe("arrow");
	expect(method(fixture, "set")).toEqual({
		name: "set",
		returnType: "Promise<void>",
		parameters: [
			{ name: "name", type: "string", kind: "string" },
			{
				name: "count",
				type: "number",
				kind: "number",
				optional: true,
				defaultValue: "[withheld]",
			},
			{ name: "enabled", type: "boolean", kind: "boolean", optional: true },
			{ name: "items", type: "number[]", kind: "json", rest: true },
		],
	});
	expect(method(fixture, "arrow")?.parameters).toEqual([
		{
			name: "amount",
			type: "number",
			kind: "number",
			optional: true,
			defaultValue: "[withheld]",
		},
		{
			name: "text",
			type: "string",
			kind: "string",
			optional: true,
			defaultValue: "[withheld]",
		},
		{
			name: "flag",
			type: "boolean",
			kind: "boolean",
			optional: true,
			defaultValue: "[withheld]",
		},
	]);
	expect(method(fixture, "context")).toEqual({
		name: "context",
		parameters: [{ name: "renamed", type: "number", kind: "number" }],
		returnType: "boolean",
	});
	expect(method(fixture, "external")?.parameters).toEqual([
		{ name: "config", type: "External", kind: "unknown" },
		{ name: "value", type: "{x: number}", kind: "json" },
		{ name: "list", type: "string[]", kind: "json" },
	]);
	expect(JSON.stringify(method(fixture, "arrow"))).not.toContain(
		"PRIVATE_DEFAULT"
	);
	expect(JSON.stringify(method(fixture, "set"))).not.toContain("TOP_SECRET");
});

test("fresh object callback metadata survives props copying and aliases without changing function behavior", () => {
	const { exports } = execute(`
		let calls = 0;
		function defaultValue() { calls++; throw new Error('PRIVATE_DEFAULT'); }
		export const props = {
			title: 'Counter',
			onAdd: (amount: number, note = 'PRIVATE_DEFAULT', enabled?: boolean, ...items: string[]): number => { calls++; return amount; },
			onReset: function (this: { base: number }, amount: number = defaultValue()) { calls++; return this.base + amount; },
			named: function original(value: string) { return value; },
		};
		export const copied = { ...props, renamed: props.onAdd };
		export const getCalls = () => calls;
	`);
	class Fixture extends Store {}
	const root = mount(createStore(Fixture, exports.copied));
	// Normal proxy reads produce actions; inspection uses raw data descriptors.
	const copiedProps = source(root.props);
	const inspector = createInspector();
	try {
		expect(copiedProps.onAdd).toBe(exports.props.onAdd);
		expect(copiedProps.renamed).toBe(exports.props.onAdd);
		expect(method(copiedProps, "onAdd")).toEqual({
			name: "onAdd",
			returnType: "number",
			parameters: [
				{ name: "amount", type: "number", kind: "number" },
				{
					name: "note",
					type: "string",
					kind: "string",
					optional: true,
					defaultValue: "[withheld]",
				},
				{ name: "enabled", type: "boolean", kind: "boolean", optional: true },
				{ name: "items", type: "string[]", kind: "json", rest: true },
			],
		});
		expect(method(copiedProps, "renamed")).toEqual({
			...method(copiedProps, "onAdd"),
			name: "renamed",
		});
		const { rootId } = inspector.registerRoot("Fixture", root);
		const inspected: any = inspector.query({
			op: "inspect",
			rootId,
			path: ["props"],
			maxEntries: 100,
		});
		expect(
			inspected.methods.find((item: any) => item.name === "onAdd")
		).toEqual(method(copiedProps, "onAdd"));
		expect(
			inspected.methods.find((item: any) => item.name === "renamed")
		).toEqual(method(copiedProps, "renamed"));
		expect(JSON.stringify(method(copiedProps, "onAdd"))).not.toContain(
			"PRIVATE_DEFAULT"
		);
		expect(method(copiedProps, "onReset")?.parameters?.[0]).toEqual({
			name: "amount",
			type: "number",
			kind: "number",
			optional: true,
			defaultValue: "[withheld]",
		});
		expect(exports.getCalls()).toBe(0);
		expect(exports.props.onAdd.name).toBe("onAdd");
		expect(exports.props.onAdd.length).toBe(1);
		expect(exports.props.onReset.name).toBe("onReset");
		expect(exports.props.onReset.length).toBe(0);
		expect(exports.props.named.name).toBe("original");
		expect(exports.props.onReset.call({ base: 10 }, 2)).toBe(12);
		expect(exports.getCalls()).toBe(1);
	} finally {
		inspector.dispose();
		root[Symbol.dispose]();
	}
});

test("object method metadata retains home object, super, lexical arrows, names and arity without getters", () => {
	const { exports } = execute(`
		let calls = 0;
		let getterCalls = 0;
		const base = { add(amount) { return this.value + amount; } };
		export const props = {
			__proto__: base,
			value: 4,
			onAdd(amount: number, extra = 1) { calls++; return super.add(amount) + extra; },
			get untouched() { getterCalls++; throw new Error('never'); },
			async asyncMethod(value: string) { return value; },
			*generator(value: boolean) { yield value; },
		};
		export const copy = { renamed: props.onAdd };
		export const getCounts = () => [calls, getterCalls];
		export class Holder {
			value = 10;
			make() { return { callback: (amount: number) => this.value + amount, method(amount: number) { return this.value + amount; } }; }
		}
	`);
	expect(
		method(exports.props, "onAdd")?.parameters?.map((p) => p.name)
	).toEqual(["amount", "extra"]);
	expect(method(exports.copy, "renamed")).toEqual({
		...method(exports.props, "onAdd"),
		name: "renamed",
	});
	expect(method(exports.props, "asyncMethod")?.parameters?.[0].kind).toBe(
		"string"
	);
	expect(method(exports.props, "generator")?.parameters?.[0].kind).toBe(
		"boolean"
	);
	expect(Array.from(exports.getCounts())).toEqual([0, 0]);
	expect(exports.copy.renamed).toBe(exports.props.onAdd);
	expect(exports.props.onAdd.name).toBe("onAdd");
	expect(exports.props.onAdd.length).toBe(1);
	expect(exports.copy.renamed.call({ value: 10 }, 2)).toBe(13);
	expect(Array.from(exports.getCounts())).toEqual([1, 0]);
	const nested = new exports.Holder().make();
	expect(nested.callback.call({ value: 100 }, 3)).toBe(13);
	expect(nested.method.call({ value: 100 }, 3)).toBe(103);
	expect(method(nested, "callback")?.parameters?.[0].kind).toBe("number");
});

test("object callbacks support inline contextual types and class-arrow aliases, but referenced/bound callbacks stay honest", () => {
	const { exports } = execute(`
		export const props: { callback: (amount: number, enabled?: boolean) => string } = { callback: (renamed, flag) => String(renamed) };
		export const asserted = { callback: (renamed) => renamed } satisfies { callback: (amount: boolean) => boolean };
		class Base { callback = (value: string) => value; }
		class Child extends Base {}
		const instance = new Child();
		const reference = (value: number) => value;
		export const copied = { alias: instance.callback, reference, bound: instance.callback.bind(instance) };
	`);
	expect(method(exports.props, "callback")).toEqual({
		name: "callback",
		returnType: "string",
		parameters: [
			{ name: "renamed", type: "number", kind: "number" },
			{ name: "flag", type: "boolean", kind: "boolean", optional: true },
		],
	});
	expect(method(exports.asserted, "callback")?.parameters?.[0].kind).toBe(
		"boolean"
	);
	expect(method(exports.copied, "alias")).toEqual({
		name: "alias",
		parameters: [{ name: "value", type: "string", kind: "string" }],
	});
	expect(method(exports.copied, "reference")).toBeUndefined();
	expect(method(exports.copied, "bound")).toBeUndefined();
});

test("later spreads/computed/duplicate/accessor keys cannot attach stale object method metadata", () => {
	const { exports } = execute(`
		const replacement = (flag) => flag;
		const key = 'run';
		let getterCalls = 0;
		export const spread = { run(amount: number) {}, ...{run: replacement} };
		export const uncertain = { run(amount: number) {}, ...{} };
		export const computed = { run(amount: number) {}, [key]: replacement };
		export const duplicate = { run(amount: number) {}, 'run': replacement };
		export const accessor = { run(amount: number) {}, get run() { getterCalls++; return replacement; }, safe(value: boolean) {} };
		export const finalMethod = { run(amount: number) {}, run(text: string) {} };
		export const finalArrow = { run(amount: number) {}, run: (flag: boolean) => flag };
		export const before = { ...{run: replacement}, run(text: string) {} };
		export const getGetterCalls = () => getterCalls;
	`);
	for (const name of ["spread", "uncertain", "computed", "duplicate"])
		expect(method(exports[name], "run")).toBeUndefined();
	expect(method(exports.accessor, "safe")?.parameters?.[0].kind).toBe(
		"boolean"
	);
	expect(exports.getGetterCalls()).toBe(0);
	expect(
		Object.getOwnPropertyDescriptor(
			Object.getOwnPropertyDescriptor(exports.accessor, "run")!.get!,
			INSPECTION_SIGNATURES
		)
	).toBeUndefined();
	expect(method(exports.finalMethod, "run")?.parameters?.[0].kind).toBe(
		"string"
	);
	expect(method(exports.finalArrow, "run")?.parameters?.[0].kind).toBe(
		"boolean"
	);
	expect(method(exports.before, "run")?.parameters?.[0].kind).toBe("string");
});

test("object metadata excludes secret/blocked keys and defaults, escaping markup and enforcing budgets", () => {
	const { exports, transformed } = execute(`export const props = {
		secretCallback: (value: 'DO_NOT_EXPOSE') => value,
		password(value: 'DO_NOT_EXPOSE') {},
		constructor(value: 'DO_NOT_EXPOSE') {},
		prototype: function (value: 'DO_NOT_EXPOSE') {},
		'__proto__': (value: 'DO_NOT_EXPOSE') => value,
		safe: (value: '</script><script>alert(1)</script>' = 'PRIVATE_DEFAULT') => value,
	};`);
	for (const name of ["secretCallback", "password", "constructor", "prototype"])
		expect(method(exports.props, name)).toBeUndefined();
	const metadata = (exports.props.safe as any)[INSPECTION_SIGNATURES];
	expect(metadata.parameters[0].defaultValue).toBe("[withheld]");
	expect(JSON.stringify(metadata)).not.toContain("PRIVATE_DEFAULT");
	expect(transformed?.code).toContain('"type":"\'\\u003c/script>');
	expect(transformed?.code).not.toContain('"name":"secretCallback"');
	const params = Array.from({ length: 33 }, (_, i) => `p${i}: number`).join(
		","
	);
	expect(
		transformInspectionSignatures(
			`const props = { callback: (${params}) => {}, method(${params}) {} }`,
			"fixture.ts"
		)
	).toBeUndefined();
	const oversizedType = "T".repeat(256);
	const oversizedParams = Array.from(
		{ length: 32 },
		(_, i) => `p${i}: ${oversizedType}`
	).join(",");
	expect(
		transformInspectionSignatures(
			`const props = { callback: (${oversizedParams}) => {} }`,
			"fixture.ts"
		)
	).toBeUndefined();
	const budgetParams = Array.from(
		{ length: 16 },
		(_, i) => `p${i}: string`
	).join(",");
	const budget = execute(
		`export const props = [${Array.from({ length: 350 }, () => `{callback: (${budgetParams}) => {}}`).join(",")}];`
	);
	const entries = budget.exports.props
		.map((props: any) => props.callback[INSPECTION_SIGNATURES])
		.filter(Boolean);
	expect(entries.length).toBeGreaterThan(0);
	expect(entries.length).toBeLessThan(350);
	expect(
		entries.reduce(
			(bytes: number, entry: unknown) =>
				bytes + new TextEncoder().encode(JSON.stringify(entry)).byteLength,
			0
		)
	).toBeLessThanOrEqual(262_144);
});

test("literal choices, implementation overloads, destructuring and explicit this are honest", () => {
	const { exports } = execute(`export class Fixture {
		choose(value: 'small' | 2 | false | null | -1) {}
		overload(value: string): string;
		overload(value: number): number;
		overload(value: string | number): string | number { return value; }
		bind(this: Fixture, {nested}: {nested: string}, [first] = ['PRIVATE_DEFAULT']) {}
	}`);
	const fixture = new exports.Fixture();
	expect(method(fixture, "choose")?.parameters?.[0]).toEqual({
		name: "value",
		type: "'small' | 2 | false | null | -1",
		kind: "enum",
		choices: ["small", 2, false, null, -1],
	});
	expect(method(fixture, "overload")?.parameters?.[0]).toEqual({
		name: "value",
		type: "string | number",
		kind: "unknown",
	});
	expect(method(fixture, "bind")?.parameters).toEqual([
		{ name: "argument2", type: "{nested: string}", kind: "json" },
		{
			name: "argument3",
			type: "array",
			kind: "json",
			optional: true,
			defaultValue: "[withheld]",
		},
	]);
});

test("inheritance, overrides, class expressions and runtime replacement do not borrow stale signatures", () => {
	const { exports } = execute(`
		class Base {
			inherited(value: string) {}
			override(value: string) {}
			arrow = (value: string) => value;
			baseArrow = (value: string) => value;
		}
		export const Fixture = class extends Base {
			override(count: number) {}
			arrow = (count: number) => count;
			baseArrow(count: number) {} // the base instance arrow shadows this prototype method
		};
		export default class { method(flag: boolean) {} }
	`);
	const fixture = new exports.Fixture();
	expect(method(fixture, "inherited")?.parameters?.[0].name).toBe("value");
	expect(method(fixture, "override")?.parameters?.[0].name).toBe("count");
	expect(method(fixture, "arrow")?.parameters?.[0].name).toBe("count");
	expect(method(fixture, "baseArrow")?.parameters?.[0].name).toBe("value");
	expect(method(new exports.default(), "method")?.parameters?.[0].kind).toBe(
		"boolean"
	);
	fixture.arrow = () => {};
	fixture.override = () => {};
	expect(method(fixture, "arrow")).toBeUndefined();
	expect(method(fixture, "override")).toBeUndefined();
});

test("inspection exposes signatures only for allowed actual methods, with controls and budget", () => {
	const { exports } = execute(`export class Fixture extends Store {
		count = 0;
		add(amount: number = 1): number { return this.count += amount; }
		arrow = (amount: number) => this.count += amount;
		hidden(name: 'DO_NOT_EXPOSE') {}
		secretMethod(name: 'DO_NOT_EXPOSE') {}
	}`);
	const root = mount(createStore(exports.Fixture)) as Store & { count: number };
	try {
		const inspector = createInspector({
			controls: true,
			redact: (path) => path.at(-1) === "hidden",
		});
		const { rootId } = inspector.registerRoot("Fixture", root);
		const value: any = inspector.query({
			op: "inspect",
			rootId,
			maxEntries: 100,
		});
		expect(value.methods.find((item: any) => item.name === "add")).toEqual({
			name: "add",
			returnType: "number",
			parameters: [
				{
					name: "amount",
					type: "number",
					kind: "number",
					optional: true,
					defaultValue: "[withheld]",
				},
			],
		});
		expect(
			value.methods.find((item: any) => item.name === "arrow").parameters[0]
				.name
		).toBe("amount");
		expect(JSON.stringify(value)).not.toContain("DO_NOT_EXPOSE");
		expect(root.count).toBe(0);
		const bounded: any = inspector.query({
			op: "inspect",
			rootId,
			maxEntries: 3,
		});
		expect(bounded.methods).toEqual([{ name: "arrow" }]);
		inspector.dispose();
		const readonly = createInspector();
		const registration = readonly.registerRoot("Fixture", root);
		expect(
			readonly.query({ op: "inspect", rootId: registration.rootId })
		).toHaveProperty("methods");
		readonly.dispose();
	} finally {
		root[Symbol.dispose]();
	}
});

test.each([8, 16, 32, 100])(
	"signature metadata never displaces live fields at budget %i, including later siblings",
	(maxEntries) => {
		const { exports } = execute(`
		export class Leaf extends Store { value = 42; run(a: number, b: number, c: number, d: number) {} }
		export class Fixture extends Store {
			nested = this.props.nested;
			tail = 'must remain visible';
			run(a: number, b: number, c: number, d: number) {}
		}
	`);
		const leaf = mount(createStore(exports.Leaf));
		const root = mount(createStore(exports.Fixture, { nested: leaf }));
		const inspector = createInspector({ controls: true });
		try {
			const { rootId } = inspector.registerRoot("Fixture", root);
			const enhanced = inspector.query({
				op: "inspect",
				rootId,
				depth: 3,
				maxEntries,
			});
			delete exports.Leaf.prototype[INSPECTION_SIGNATURES];
			delete exports.Fixture.prototype[INSPECTION_SIGNATURES];
			const baseline = inspector.query({
				op: "inspect",
				rootId,
				depth: 3,
				maxEntries,
			});
			const stateOnly = (value: unknown) =>
				JSON.parse(
					JSON.stringify(value, (key, item) =>
						key === "methods" ? undefined : item
					)
				);
			expect(stateOnly(enhanced)).toEqual(stateOnly(baseline));
		} finally {
			inspector.dispose();
			root[Symbol.dispose]();
			leaf[Symbol.dispose]();
		}
	}
);

test("unsupported/decorated/computed/private/static/getter members stay unavailable; metadata getters never run", () => {
	const source = `class Fixture {
		get getter() { throw new Error('never'); }
		static staticMethod(value: string) {}
		#privateMethod(value: string) {}
		protected protectedMethod(value: string) {}
		[dynamic()](value: string) {}
		@decorate decorated(value: string) {}
	}`;
	expect(transformInspectionSignatures(source, "fixture.ts")).toBeUndefined();
	const fn = () => {};
	const getter = vi.fn(() => {
		throw new Error("never");
	});
	Object.defineProperty(fn, INSPECTION_SIGNATURES, {
		get: getter,
		configurable: true,
	});
	const value = Object.defineProperty({ fn }, INSPECTION_SIGNATURES, {
		get: getter,
	});
	expect(lookupInspectionMethod(value, "fn", fn)).toBeUndefined();
	Object.defineProperty(fn, INSPECTION_SIGNATURES, {
		value: Object.defineProperty({}, "name", { get: getter }),
	});
	expect(lookupInspectionMethod(value, "fn", fn)).toBeUndefined();
	expect(getter).not.toHaveBeenCalled();
});

test("TSX, Unicode offsets and nested classes remain executable; metadata sizes are bounded", () => {
	const source = `const emoji = '🐈'; export class Fixture {
		nested(value: string) { return class { method(flag: boolean) {} }; }
		arrow = (value: number) => class { method(text: string) {} };
	}`;
	const { exports, transformed } = execute(source, "fixture.tsx");
	expect(transformed?.code.split("\n").length).toBe(source.split("\n").length);
	const fixture = new exports.Fixture();
	expect(method(fixture, "arrow")?.parameters?.[0].kind).toBe("number");
	expect(method(new (fixture.arrow(1))(), "method")?.parameters?.[0].kind).toBe(
		"string"
	);
	const parameters = Array.from({ length: 33 }, (_, i) => `p${i}: string`).join(
		","
	);
	expect(
		transformInspectionSignatures(
			`class Fixture { method(${parameters}) {} }`,
			"fixture.ts"
		)
	).toBeUndefined();
	expect(
		transformInspectionSignatures(
			"declare class Fixture { method(value: string): void }",
			"fixture.d.ts"
		)
	).toBeUndefined();
	expect(
		transformInspectionSignatures(
			"class Fixture { method(value: string) {} }",
			"fixture.js"
		)
	).toBeUndefined();
	expect(
		transformInspectionSignatures("class { broken", "fixture.ts")
	).toBeUndefined();
});

test("concrete Store/Model/Observable class labels use data descriptors, never constructor/name accessors", () => {
	class Item extends Model {}
	class Observed extends Observable {
		value = 1;
	}
	class ConstructorTrap extends Observable {
		value = 1;
	}
	class NameTrap extends Observable {
		value = 1;
	}
	class Root extends Store {
		item = Item.create();
		observed = new Observed();
		constructorTrap = new ConstructorTrap();
		nameTrap = new NameTrap();
	}
	const root = mount(createStore(Root));
	const getter = vi.fn(() => {
		throw new Error("never");
	});
	Object.defineProperty(ConstructorTrap.prototype, "constructor", {
		get: getter,
	});
	Object.defineProperty(NameTrap, "name", { get: getter });
	const inspector = createInspector();
	try {
		const { rootId } = inspector.registerRoot("Root", root);
		const value: any = inspector.query({ op: "inspect", rootId, depth: 1 });
		expect(value.className).toBe("Root");
		const field = (name: string) =>
			value.fields.find((entry: any) => entry.name === name).value;
		expect(field("item").className).toBe("Item");
		expect(field("observed").className).toBe("Observed");
		expect(field("constructorTrap")).not.toHaveProperty("className");
		expect(field("nameTrap")).not.toHaveProperty("className");
		expect(getter).not.toHaveBeenCalled();
	} finally {
		inspector.dispose();
		root.item[Symbol.dispose]();
		root[Symbol.dispose]();
	}
});

test("core and browser inspector bundles never import the Node signature parser", () => {
	const result = buildSync({
		entryPoints: ["src/index.ts", "src/devtools.ts"],
		bundle: true,
		write: false,
		metafile: true,
		platform: "browser",
		outdir: "unused",
		logLevel: "silent",
	});
	const inputs = Object.keys(result.metafile!.inputs);
	expect(inputs).toContain("src/inspection/signatures.ts");
	expect(
		inputs.some((path) =>
			/signature-transform|node_modules\/(?:vite|typescript|esbuild|rolldown)\//.test(
				path
			)
		)
	).toBe(false);
});

test("Vite dev pre-transform runs before TS erasure; production build excludes all signature extraction", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rst-signature-"));
	await writeFile(
		join(dir, "fixture.ts"),
		"export class Fixture { method(value: number): void {} arrow = (text: string) => text; } export const props = {onAdd: (amount: number) => amount, onReset(value: string) { return value; }};"
	);
	await writeFile(
		join(dir, "index.html"),
		'<script type="module">import {Fixture, props} from "./fixture.ts"; globalThis.fixture = new Fixture(); globalThis.props = props;</script>'
	);
	const server = await createServer({
		configFile: false,
		root: dir,
		logLevel: "silent",
		plugins: [rStateTreeInspector()],
	});
	try {
		const transformed = await server.transformRequest("/fixture.ts");
		expect(transformed?.code).toContain(INSPECTION_SIGNATURES_KEY);
		expect(
			(await server.transformRequest("/fixture.ts?raw"))?.code
		).not.toContain(INSPECTION_SIGNATURES_KEY);
		const { code } = transformSync(transformed!.code, { format: "cjs" });
		const module = { exports: {} as any };
		runInNewContext(code, { module, exports: module.exports });
		expect(
			method(new module.exports.Fixture(), "method")?.parameters?.[0].name
		).toBe("value");
		expect(method(module.exports.props, "onAdd")?.parameters?.[0].name).toBe(
			"amount"
		);
		expect(method(module.exports.props, "onReset")?.parameters?.[0].kind).toBe(
			"string"
		);
		await server.close();
		const result = await build({
			configFile: false,
			mode: "development", // Build must remain inert even in development mode.
			root: dir,
			logLevel: "silent",
			plugins: [rStateTreeInspector()],
			build: { write: false, minify: false },
		});
		if (Array.isArray(result) || !("output" in result))
			throw new Error("Unexpected output");
		const output = result.output
			.map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
			.join("\n");
		expect(output).not.toContain(INSPECTION_SIGNATURES_KEY);
		expect(output).not.toContain("parameters");
	} finally {
		await server.close();
		await rm(dir, { recursive: true, force: true });
	}
});
