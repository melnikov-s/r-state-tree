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

const cases: Record<string, Case[]> = {
	"no-computed-mutation": [
		["ordinary Store getter assignment", getter("this.count = 1; return 0"), 1],
		[
			"ordinary Model getter update",
			"class M extends Model { count = 0; get value() { return this.count++; } }",
			1,
		],
		["compound assignment", getter("this.count += 1"), 1],
		["delete external property", getter("delete this.data.name"), 1],
		[
			"const alias is not fresh",
			getter("const data = this.data; data.name = 'x'"),
			1,
		],
		["alias to this", getter("const self = this; self.count++"), 1],
		["destructured alias", getter("const { data } = this; data.name = 'x'"), 1],
		[
			"renamed destructured alias",
			getter("const { data: alias } = this; alias.name = 'x'"),
			1,
		],
		[
			"reassigned alias",
			getter("let data = {}; data = this.data; data.name = 'x'"),
			1,
		],
		[
			"branch alias",
			getter(
				"let data = {}; if (this.count) data = this.data; else data = {}; data.name = 'x'"
			),
			1,
		],
		["array sort", getter("return this.rows.sort()"), 1],
		[
			"array reverse through alias",
			getter("const r = this.rows; return r.reverse()"),
			1,
		],
		["array push", getter("this.rows.push(1)"), 1],
		["array splice", getter("this.rows.splice(0, 1)"), 1],
		[
			"array other mutators",
			getter(
				"this.rows.fill(0); this.rows.copyWithin(0,1); this.rows.pop(); this.rows.shift(); this.rows.unshift(1)"
			),
			5,
		],
		[
			"Map mutations",
			getter(
				"this.entries.set('a', 1); this.entries.delete('a'); this.entries.clear()",
				"entries = observable(new Map());"
			),
			3,
		],
		[
			"Set mutations",
			getter(
				"this.ids.add(1); this.ids.delete(1); this.ids.clear()",
				"ids = observable(new Set());"
			),
			3,
		],
		[
			"array callback",
			getter("return this.rows.map(row => { row.value++; return row; })"),
			1,
		],
		[
			"filter callback",
			getter(
				"return this.rows.filter(row => { delete row.value; return true })"
			),
			1,
		],
		[
			"sort comparator",
			getter("return [...this.rows].sort((a,b) => { a.value++; return 0 })"),
			1,
		],
		[
			"Map forEach callback",
			getter(
				"this.entries.forEach(item => item.value++)",
				"entries = observable(new Map());"
			),
			1,
		],
		[
			"for of external elements",
			getter("for (const row of this.rows) row.value++"),
			1,
		],
		["IIFE", getter("(() => { this.count++ })()"), 1],
		[
			"called local helper",
			getter("const bump = () => this.count++; bump()"),
			1,
		],
		[
			"hoisted local helper",
			getter("bump(); function bump() { captured.value++ }"),
			1,
		],
		[
			"called helper parameters",
			getter("const edit = item => item.value++; edit(this.data)"),
			1,
		],
		...(
			[
				[
					"helper fresh default",
					"function build(out = {}) { out.x = 1; return out } return build()",
					0,
				],
				[
					"helper explicit undefined default",
					"function build(out = {}) { out.x = 1; return out } return build(undefined)",
					0,
				],
				[
					"helper void default",
					"function build(out = {}) { out.x = 1; return out } return build(void 0)",
					0,
				],
				[
					"helper uninitialized argument default",
					"let value; function build(out = {}) { out.x = 1; return out } return build(value)",
					0,
				],
				[
					"helper external explicit argument",
					"function build(out = {}) { out.x = 1; return out } return build(this.data)",
					1,
				],
				[
					"helper fresh explicit argument skips effectful default",
					"function build(out = (captured.x++, {})) { return out } return build({})",
					0,
				],
				[
					"helper scalar explicit argument skips effectful default",
					"function build(out = (captured.x++, {})) { return out } return build(null)",
					0,
				],
				[
					"helper array explicit argument skips effectful default",
					"function build(out = (captured.x++, {})) { return out } return build([])",
					0,
				],
				[
					"helper function explicit argument skips effectful default",
					"function build(out = (captured.x++, {})) { return out } return build(() => {})",
					0,
				],
				[
					"helper external argument conservatively includes default",
					"function build(out = (captured.x++, {})) { return out } return build(this.data)",
					1,
				],
				[
					"helper missing argument executes effectful default",
					"function build(out = (captured.x++, {})) { return out } return build()",
					1,
				],
				[
					"helper unknown argument may execute default",
					"function build(out = (captured.x++, {})) { return out } return build(load())",
					1,
				],
				[
					"helper spread arguments may execute default",
					"function build(first, out = (captured.x++, {})) { return out } return build(...load())",
					1,
				],
				[
					"helper unknown argument does not prove external mutation",
					"function build(out = {}) { out.x = 1; return out } return build(load())",
					0,
				],
				[
					"helper shadowed undefined skips default",
					"const undefined = {}; function build(out = (captured.x++, {})) { out.x = 1; return out } return build(undefined)",
					0,
				],
				[
					"object destructuring missing property default",
					"function build({ out = {} }) { out.x = 1; return out } return build({})",
					0,
				],
				[
					"object destructuring supplied property skips default",
					"function build({ out = (captured.x++, {}) }) { out.x = 1; return out } return build({ out: {} })",
					0,
				],
				[
					"object destructuring missing property executes default",
					"function build({ out = (captured.x++, {}) }) { return out } return build({})",
					1,
				],
				[
					"object destructuring explicit undefined default",
					"function build({ out = {} }) { out.x = 1; return out } return build({ out: undefined })",
					0,
				],
				[
					"nested destructuring defaults",
					"function build({ nested: { out = {} } = {} } = {}) { out.x = 1; return out } return build()",
					0,
				],
				[
					"destructuring external supplied property",
					"function build({ out = {} } = {}) { out.x = 1; return out } return build({ out: this.data })",
					1,
				],
				[
					"array destructuring missing element default",
					"function build([out = {}] = []) { out.x = 1; return out } return build()",
					0,
				],
				[
					"array destructuring supplied element skips default",
					"function build([out = (captured.x++, {})]) { out.x = 1; return out } return build([{}])",
					0,
				],
				[
					"array destructuring hole executes default",
					"function build([out = (captured.x++, {})]) { return out } return build([, {}])",
					1,
				],
				[
					"array destructuring explicit undefined default",
					"function build([out = {}]) { out.x = 1; return out } return build([undefined])",
					0,
				],
				[
					"local binding destructuring default",
					"const { out = {} } = {}; out.x = 1; return out",
					0,
				],
				[
					"generator production is deferred",
					"function* deferred() { captured.x++ } return deferred()",
					0,
				],
				[
					"async generator production is deferred",
					"async function* deferred() { captured.x++ } return deferred()",
					0,
				],
				[
					"generator expression production is deferred",
					"const deferred = function* () { captured.x++ }; return deferred()",
					0,
				],
				[
					"generator parameter defaults execute but body is deferred",
					"function* deferred(out = (captured.x++, {})) { captured.y++ } return deferred()",
					1,
				],
				[
					"async generator parameter defaults execute but body is deferred",
					"async function* deferred(out = (captured.x++, {})) { captured.y++ } return deferred()",
					1,
				],
				[
					"async generator expression production is deferred",
					"const deferred = async function* () { captured.x++ }; return deferred()",
					0,
				],
				[
					"generator iteration callback only produces iterators",
					"return this.rows.map(function* (row) { row.x++ })",
					0,
				],
				[
					"generator call arguments still execute",
					"function* deferred(out) { captured.y++ } return deferred(captured.x++)",
					1,
				],
			] satisfies Case[]
		).map(([title, body, count]): Case => [title, getter(body), count]),
		[
			"computed helper fresh default",
			"const result = computed(() => { function build(out = {}) { out.x = 1; return out } return build() })",
			0,
		],
		[
			"callback variable",
			getter("const edit = item => item.value++; this.rows.forEach(edit)"),
			1,
		],
		[
			"callback alias",
			getter(
				"const edit = item => item.value++; const alias = edit; this.rows.forEach(alias)"
			),
			1,
		],
		[
			"captured assignment",
			"let outside = 0; const c = computed(() => ++outside)",
			1,
		],
		[
			"captured object",
			"const outside = {}; const c = computed(() => { const alias = outside; alias.x = 1 })",
			1,
		],
		[
			"computed parameter mutation",
			"const c = computed((state: { count: number }) => state.count++)",
			1,
		],
		[
			"computed import alias",
			"import { computed as derive } from 'r-state-tree'; const c = derive(() => captured.x++)",
			1,
		],
		[
			"computed immutable API alias",
			"const derive = computed; const c = derive(() => captured.x++)",
			1,
		],
		[
			"shadowed Map annotation is not native",
			"interface Map { set(value: Function): void } const c = computed((service: Map) => service.set(() => captured.x++))",
			0,
		],
		[
			"computed namespace",
			"import * as rst from 'r-state-tree'; const c = rst.computed(() => captured.x++)",
			1,
		],
		[
			"computed named callback",
			"function derive() { captured.x++ } const c = computed(derive)",
			1,
		],
		[
			"computed const callback",
			"const derive = () => captured.x++; const c = computed(derive)",
			1,
		],
		[
			"explicit computed getter",
			"class Plain { @computed get value() { captured.x++; return 1 } }",
			1,
		],
		[
			"static types computed getter",
			"class Plain { static types = { value: computed }; get value() { captured.x++ } }",
			1,
		],
		[
			"child getter is derivation",
			"class S extends Store { count = 0; @child get item() { this.count++; return createStore(S) } }",
			1,
		],
		["batch callback", getter("batch(() => this.count++)"), 1],
		["untracked callback", getter("untracked(() => this.count++)"), 1],
		[
			"shallow array copy still shares elements",
			getter("const result = this.rows.slice(); result[0].value++"),
			1,
		],
		[
			"shallow object copy still shares values",
			getter("const result = { ...this.data }; result.item.value++"),
			1,
		],
		...(
			[
				[
					"spread external overwrites fresh property",
					"const result = { item: {}, ...this.data }; result.item.x++",
					1,
				],
				[
					"spread fresh property overwrites external",
					"const result = { ...this.data, item: {} }; result.item.x++",
					0,
				],
				[
					"spread external alias overwrites fresh property",
					"const alias = this.data; const result = { item: {}, ...alias }; result.item.x++",
					1,
				],
				[
					"spread shallow copied source overwrites fresh property",
					"const source = { ...this.data }; const result = { item: {}, ...source }; result.item.x++",
					1,
				],
				[
					"spread preserves source named override",
					"const source = { ...this.data, item: {} }; const result = { item: {}, ...source }; result.item.x++",
					0,
				],
				[
					"spread later fresh override stays shallow",
					"const result = { ...this.data, item: { nested: this.data } }; result.item.nested.x++",
					1,
				],
				[
					"spread container itself stays fresh",
					"const result = { item: {}, ...this.data }; result.item = {}; return result",
					0,
				],
				[
					"assign external overwrites fresh property",
					"const result = { item: {} }; Object.assign(result, this.data); result.item.x++",
					1,
				],
				[
					"assign fresh property overwrites external",
					"const result = Object.assign({}, this.data, { item: {} }); result.item.x++",
					0,
				],
				[
					"assign external alias overwrites fresh property",
					"const alias = this.data; const result = Object.assign({ item: {} }, alias); result.item.x++",
					1,
				],
				[
					"assign shallow copied source overwrites fresh property",
					"const source = { ...this.data }; const result = Object.assign({ item: {} }, source); result.item.x++",
					1,
				],
				[
					"assign preserves source named override",
					"const source = Object.assign({}, this.data, { item: {} }); const result = Object.assign({ item: {} }, source); result.item.x++",
					0,
				],
				[
					"assign last external source wins",
					"const result = Object.assign({}, this.data, { item: {} }, this.data); result.item.x++",
					1,
				],
				[
					"assign container itself stays fresh",
					"const result = Object.assign({ item: {} }, this.data); result.item = {}; return result",
					0,
				],
			] satisfies Case[]
		).map(([title, body, count]): Case => [
			title,
			getter(body, "data = observable({ item: {} });"),
			count,
		]),
		...(
			[
				[
					"concat external argument elements",
					"const result = [].concat(this.rows); result[0].x++",
					1,
				],
				[
					"concat external array alias elements",
					"const rows = this.rows; const result = [].concat(rows); result[0].x++",
					1,
				],
				[
					"concat copied array elements",
					"const result = [].concat(this.rows.slice()); result[0].x++",
					1,
				],
				[
					"concat external non-array argument",
					"const result = [].concat(this.data); result[0].x++",
					1,
				],
				[
					"concat non-array wrapper stays shallow",
					"const result = [].concat({ item: this.data }); result[0].item.x++",
					1,
				],
				[
					"concat multiple argument provenance",
					"const result = [].concat([{}], this.rows, {}); result[1].x++",
					1,
				],
				[
					"concat external receiver elements",
					"const result = this.rows.concat([{}]); result[0].x++",
					1,
				],
				[
					"concat fresh-only arrays",
					"const result = [{}].concat([{}], [{}]); result[0].x = 1; return result",
					0,
				],
				[
					"concat fresh-only object arguments",
					"const result = [].concat({}, {}); result[0].x = 1; return result",
					0,
				],
				[
					"concat external argument container stays fresh",
					"const result = [].concat(this.rows); result.sort(); result[0] = {}; return result",
					0,
				],
			] satisfies Case[]
		).map(([title, body, count]): Case => [
			title,
			getter(body, "rows = observable([{}]); data = observable({});"),
			count,
		]),
		[
			"fresh wrapper of state",
			getter("const result = { item: this.data }; result.item.value++"),
			1,
		],
		[
			"push state into fresh result",
			getter("const result = []; result.push(this.data); result[0].value++"),
			1,
		],
		[
			"captured literal nested array",
			"const state = { rows: [] }; const c = computed(() => state.rows.reverse())",
			1,
		],
		[
			"captured nested collection alias",
			"const state = { rows: [] }; const rows = state.rows; const c = computed(() => rows.push(1))",
			1,
		],
		[
			"nested field callback",
			getter(
				"this.data.rows.forEach(row => row.x++)",
				"data = observable({ rows: [] });"
			),
			1,
		],
		[
			"unknown nested custom map boundary",
			getter(
				"this.data.service.map(() => this.count++)",
				"data = observable({ service: load() }); count = 0;"
			),
			0,
		],
		[
			"captured observable array",
			"const rows = observable([]); const c = computed(() => rows.push(1))",
			1,
		],
		[
			"captured array alias",
			"const rows = []; const alias = rows; const c = computed(() => alias.reverse())",
			1,
		],
		[
			"parameter array mutation",
			"const c = computed((rows: number[]) => rows.reverse())",
			1,
		],
		[
			"parameter Map mutation",
			"const c = computed((map: Map<string, number>) => map.set('a', 1))",
			1,
		],
		[
			"array of state wrappers",
			getter(
				"const result = [{ state: this.data }]; result.forEach(row => row.state.value++)"
			),
			1,
		],
		[
			"local helper returns state wrapper",
			getter(
				"function make() { const result = { state: captured }; return result } const result = make(); result.state.x++"
			),
			1,
		],
		[
			"mapped state wrapper",
			getter(
				"const result = this.rows.map(row => ({ state: row })); result.forEach(row => row.state.x++)"
			),
			1,
		],
		[
			"Map callback key is existing state",
			getter(
				"this.entries.forEach((value, key) => key.x++)",
				"entries = observable(new Map());"
			),
			1,
		],
		[
			"Set callback second parameter",
			getter(
				"this.ids.forEach((value, again) => again.x++)",
				"ids = observable(new Set());"
			),
			1,
		],
		["Object assign external", getter("Object.assign(this.data, { x: 1 })"), 1],
		["Reflect set external", getter("Reflect.set(this.data, 'x', 1)"), 1],
		[
			"observable alias is existing",
			getter("const alias = observable(this.rows); alias.push(1)"),
			1,
		],
		[
			"inherited array mutation",
			"class Base extends Store { rows = [] } class S extends Base { get derived() { this.rows.reverse() } }",
			1,
		],
		[
			"import aliased getter class",
			"import { Store as Base } from 'r-state-tree'; class S extends Base { get derived() { captured.x++ } }",
			1,
		],
		["literal property assignment", getter("this['count'] = 1"), 1],
		["callee expression side effect", getter("(this.count++, helper)()"), 1],
		[
			"destructuring assignment target",
			getter("({ item: this.data.name } = captured)"),
			1,
		],
		[
			"valid fresh construction",
			getter(
				"const result = []; result.push(1); result.sort(); const obj = {}; obj.x = 1; delete obj.x; const map = new Map(); map.set('a', 1); const set = new Set(); set.add(1); return result"
			),
			0,
		],
		[
			"valid copied container mutation",
			getter(
				"const result = [...this.rows]; result.sort(); result[0] = 1; return result"
			),
			0,
		],
		["valid slice sort", getter("return this.rows.slice().sort()"), 0],
		[
			"valid derived map",
			getter("return this.rows.map(row => ({ value: row.value })).sort()"),
			0,
		],
		[
			"valid Map fresh value with external key",
			getter(
				"const map = new Map(); map.set(this.data, {}); map.get(this.data).x = 1; return map"
			),
			0,
		],
		[
			"valid Map callback fresh key",
			getter(
				"const map = new Map(); map.set({}, {}); map.forEach((value, key) => key.x = 1); return map"
			),
			0,
		],
		[
			"Map state value alias",
			getter(
				"const map = new Map(); map.set('a', this.data); map.get('a').x = 1"
			),
			1,
		],
		[
			"Object assign shallow reference",
			getter("const result = Object.assign({}, this.data); result.nested.x++"),
			1,
		],
		[
			"valid fresh nested callback result",
			getter(
				"const result = [{ item: {} }]; result.forEach(row => row.item.x = 1); return result"
			),
			0,
		],
		[
			"valid array pattern indexes",
			getter(
				"const [state, local] = [this.data, {}]; local.x = 1; return local"
			),
			0,
		],
		[
			"valid reduce accumulator",
			getter(
				"return this.rows.reduce((out, row) => { out.push(row); return out }, [])"
			),
			0,
		],
		[
			"valid Object assign local",
			getter(
				"const result = {}; Object.assign(result, this.data); return result"
			),
			0,
		],
		[
			"shadowed Object helper",
			getter("const Object = { assign: () => 1 }; Object.assign(this.data)"),
			0,
		],
		[
			"valid fresh observable result",
			getter("const result = observable([]); result.push(1); return result"),
			0,
		],
		[
			"deferred instance initializer",
			getter("const Later = class { value = captured.x++ }; return Later"),
			0,
		],
		[
			"valid empty local for of",
			getter("for (const row of []) row.x = 1; return 0"),
			0,
		],
		[
			"valid empty local destructured rest",
			getter("for (const { ...row } of []) row.x = 1; return 0"),
			0,
		],
		[
			"valid escaping closure local binding",
			getter(
				"function make() { const local = {}; return () => local.x = 1 } const fn = make(); fn()"
			),
			0,
		],
		[
			"valid cyclic local branch join",
			getter(
				"let result = {}; result.self = result; if (this.count) { result = {}; result.self = result } result.x = 1; return result"
			),
			0,
		],
		[
			"valid parameter rebinding",
			"const c = computed((value: object) => { value = {}; return value })",
			0,
		],
		[
			"TypeScript alias assertion",
			getter("const alias = this.data as { x: number }; alias!.x++"),
			1,
		],
		[
			"valid local counters",
			getter(
				"let count = 0; for (const row of this.rows) count++; return count"
			),
			0,
		],
		[
			"valid local helper result",
			getter(
				"const make = () => []; const result = make(); result.push(1); return result"
			),
			0,
		],
		[
			"valid local helper fresh parameter",
			getter(
				"const edit = item => item.value++; const obj = { value: 0 }; edit(obj); return obj"
			),
			0,
		],
		["deferred returned function", getter("return () => this.count++"), 0],
		[
			"deferred saved function",
			getter("const later = () => this.count++; return later"),
			0,
		],
		[
			"deferred timer",
			getter("setTimeout(() => this.count++, 0); return 1"),
			0,
		],
		[
			"deferred promise",
			getter("return Promise.resolve().then(() => this.count++)"),
			0,
		],
		[
			"unknown callback boundary",
			getter("schedule(() => this.count++); return 1"),
			0,
		],
		["unknown helper boundary", getter("mutate(this.data); return 1"), 0],
		["unknown method boundary", getter("this.changeState(); return 1"), 0],
		[
			"unrelated computed",
			"import { computed as other } from 'elsewhere'; other(() => captured.x++)",
			0,
		],
		["unrelated getter", "class Store { get value() { captured.x++ } }", 0],
		[
			"shadowed imported computed",
			"function f(computed: Function) { return computed(() => captured.x++) }",
			0,
		],
		[
			"shadowed Store",
			"function f(Store: any) { class S extends Store { get value() { captured.x++ } } }",
			0,
		],
		[
			"block shadowing",
			getter(
				"const item = this.data; { const item = {}; item.value++ } return item"
			),
			0,
		],
		[
			"callback parameter shadowing",
			getter(
				"const item = this.data; [1].forEach(item => { item++ }); return item"
			),
			0,
		],
		[
			"function shadowing",
			getter(
				"const edit = () => this.count++; { const edit = () => 1; edit() } return edit"
			),
			0,
		],
		[
			"recursive helper bounded",
			getter("function recurse() { recurse() } recurse(); return 1"),
			0,
		],
		[
			"child descriptor callback deferred",
			"class S extends Store { count = 0; @child get item() { return createStore(S, { onClick: () => this.count++ }) } }",
			0,
		],
		[
			"static getter not reactive",
			"class S extends Store { static get value() { captured.x++ } }",
			0,
		],
		[
			"ordinary method and setter",
			"class S extends Store { count = 0; change() { this.count++ } set value(v) { this.count = v } }",
			0,
		],
	],
	"no-direct-construction": [
		["Store subclass", "class S extends Store {} new S({})", 1],
		["Model subclass", "class M extends Model {} new M()", 1],
		[
			"aliased imports",
			"import { Store as Base } from 'r-state-tree'; class S extends Base {} new S({})",
			1,
		],
		[
			"namespace imports",
			"import * as rst from 'r-state-tree'; class S extends rst.Store {} new S({})",
			1,
		],
		[
			"local inheritance",
			"class A extends Model {} class B extends A {} new B()",
			1,
		],
		[
			"constructor aliases",
			"class S extends Store {} const Alias = S; new Alias({})",
			1,
		],
		["class expression", "const S = class extends Store {}; new S({})", 1],
		["direct base", "new Model()", 1],
		[
			"supported factories",
			"class S extends Store {} class M extends Model {} createStore(S); M.create()",
			0,
		],
		["unrelated class name", "class ShoppingStore {} new ShoppingStore()", 0],
		[
			"unrelated imported base",
			"import { Store as Other } from 'other'; class S extends Other {} new S()",
			0,
		],
		[
			"shadowed constructor",
			"class S extends Store {} function f(S: any) { return new S() }",
			0,
		],
		[
			"shadowed base",
			"function f(Store: any) { class S extends Store {} return new S() }",
			0,
		],
		[
			"destructured class property is not constructor alias",
			"const { Other } = Model; new Other()",
			0,
		],
		[
			"unknown imported subclass",
			"import { AppStore } from './app'; new AppStore()",
			0,
		],
	],
	"no-plain-collection-mutation": [
		[
			"plain array push",
			"class S extends Store { rows = []; add() { this.rows.push(1) } }",
			1,
		],
		[
			"plain Map and Set",
			"class M extends Model { map = new Map(); set = new Set(); edit() { this.map.set('a', 1); this.set.add(1) } }",
			2,
		],
		[
			"plain object write",
			"class S extends Store { data = {}; edit() { this.data.x = 1 } }",
			1,
		],
		[
			"plain index update and delete",
			"class S extends Store { rows = []; edit() { this.rows[0]++; delete this.rows[0] } }",
			2,
		],
		[
			"plain nested write",
			"class S extends Store { data = { item: {} }; edit() { this.data.item.x = 1 } }",
			1,
		],
		[
			"destructured field alias",
			"class S extends Store { rows = []; edit() { const { rows: items } = this; items.push(1) } }",
			1,
		],
		[
			"field alias",
			"class S extends Store { rows = []; edit() { const rows = this.rows; rows.push(1) } }",
			1,
		],
		[
			"this alias",
			"class S extends Store { rows = []; edit() { const self = this; self.rows.push(1) } }",
			1,
		],
		[
			"observable collection",
			"class S extends Store { rows = observable([]); edit() { this.rows.push(1) } }",
			0,
		],
		[
			"observable import alias",
			"import { observable as obs } from 'r-state-tree'; class S extends Store { rows = obs([]); edit() { this.rows.push(1) } }",
			0,
		],
		[
			"observable tree",
			"class S extends Store { data = toObservableTree({}); edit() { this.data.x = 1 } }",
			0,
		],
		[
			"plain replacement",
			"class S extends Store { rows = []; edit() { this.rows = [...this.rows, 1] } }",
			0,
		],
		[
			"child Model collection",
			"class M extends Model { @child(Model) rows = []; edit() { this.rows.push(Model.create()) } }",
			0,
		],
		[
			"model references not plain",
			"import { modelRef } from 'r-state-tree'; class M extends Model { @modelRef(Model) rows = []; edit() { this.rows.push(Model.create()) } }",
			0,
		],
		[
			"static method own this",
			"class S extends Store { rows = []; static edit() { this.rows.push(1) } }",
			0,
		],
		[
			"inherited plain collection",
			"class Base extends Store { rows = [] } class S extends Base { edit() { this.rows.push(1) } }",
			1,
		],
		[
			"inherited overridden wrapped collection",
			"class Base extends Store { rows = [] } class S extends Base { rows = observable([]); edit() { this.rows.push(1) } }",
			0,
		],
		[
			"inherited overridden unknown collection",
			"class Base extends Store { rows = [] } class S extends Base { rows = load(); edit() { this.rows.push(1) } }",
			0,
		],
		[
			"inherited child configuration override",
			"class Base extends Model { rows = [] } class M extends Base { static types = { rows: child(Model) }; edit() { this.rows.push(Model.create()) } }",
			0,
		],
		[
			"inherited field getter override",
			"class Base extends Store { rows = [] } class S extends Base { get rows() { return observable([]) } edit() { this.rows.push(1) } }",
			0,
		],
		[
			"static child configuration",
			"class M extends Model { static types = { rows: child(Model) }; rows = []; edit() { this.rows.push(Model.create()) } }",
			0,
		],
		[
			"unknown initializer",
			"class S extends Store { rows = load(); edit() { this.rows.push(1) } }",
			0,
		],
		[
			"unrelated class",
			"class S { rows = []; edit() { this.rows.push(1) } }",
			0,
		],
		[
			"shadowed alias",
			"class S extends Store { rows = []; edit() { const rows = this.rows; { const rows = []; rows.push(1) } } }",
			0,
		],
		[
			"nested regular function own this",
			"class S extends Store { rows = []; edit() { return function() { this.rows.push(1) } } }",
			0,
		],
	],
	"no-observable-collection-replacement": [
		[
			"spread array replacement",
			"class S extends Store { rows = observable([]); edit() { this.rows = [...this.rows, 1] } }",
			1,
		],
		[
			"spread object replacement",
			"class M extends Model { data = observable({}); edit() { this.data = { ...this.data, x: 1 } } }",
			1,
		],
		[
			"slice filter map replacements",
			"class S extends Store { rows = observable([]); edit() { this.rows = this.rows.slice(); this.rows = this.rows.filter(Boolean); this.rows = this.rows.map(x => x) } }",
			3,
		],
		[
			"Map replacement",
			"class S extends Store { map = observable(new Map()); edit() { this.map = new Map(this.map) } }",
			1,
		],
		[
			"fresh local replacement",
			"class S extends Store { rows = observable([]); edit() { const next = []; this.rows = next } }",
			1,
		],
		[
			"this alias replacement",
			"class S extends Store { rows = observable([]); edit() { const self = this; self.rows = [] } }",
			1,
		],
		[
			"wrapped replacement",
			"class S extends Store { rows = observable([]); edit() { this.rows = observable([]) } }",
			1,
		],
		[
			"valid in place",
			"class S extends Store { rows = observable([]); edit() { this.rows.push(1); this.rows[0] = 2 } }",
			0,
		],
		[
			"valid derived copy",
			"class S extends Store { rows = observable([]); get sorted() { return [...this.rows].sort() } }",
			0,
		],
		[
			"plain collection replacement",
			"class S extends Store { rows = []; edit() { this.rows = [...this.rows] } }",
			0,
		],
		[
			"unknown custom map result",
			"class S extends Store { rows = observable([]); edit() { this.rows = service.map() } }",
			0,
		],
		[
			"inherited observable replacement",
			"class Base extends Store { rows = observable([]) } class S extends Base { edit() { this.rows = [] } }",
			1,
		],
		[
			"unknown replacement",
			"class S extends Store { rows = observable([]); edit() { this.rows = load() } }",
			0,
		],
		[
			"unrelated class",
			"class S { rows = observable([]); edit() { this.rows = [] } }",
			0,
		],
	],
};

type Diagnostic = {
	code: string;
	message: string;
	filename: string;
	labels: { span: { offset: number; length: number } }[];
};
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
	expect(JSON.parse(run.stdout)).toEqual(Object.keys(cases));
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
				Object.keys(cases).map((rule) => [`r-state-tree/${rule}`, "error"])
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
	new Invalid();`
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
	expect(diagnostics).toHaveLength(4);
	for (const rule of Object.keys(cases))
		expect(diagnostics.some((d) => d.code.includes(rule))).toBe(true);
});

for (const [rule, fixtures] of Object.entries(cases)) {
	describe(rule, () => {
		for (const [index, [title, code, count]] of fixtures.entries()) {
			test(title, () => {
				const diagnostics = results.get(`${rule}/${index}`)!;
				expect(diagnostics, JSON.stringify(diagnostics)).toHaveLength(count);
				for (const d of diagnostics) {
					expect(d.message).not.toContain("{{");
					expect(d.labels[0].span.offset).toBeGreaterThanOrEqual(header.length);
					expect(
						d.labels[0].span.offset + d.labels[0].span.length
					).toBeLessThanOrEqual(header.length + code.length);
				}
			});
		}
	});
}
