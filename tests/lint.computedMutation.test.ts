import { runLintCases, getter } from "./helpers/lint";
import type { Case } from "./helpers/lint";

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
			"TypeScript alias assertion",
			getter("const alias = this.data as { x: number }; alias!.x++"),
			1,
		],
	],
};

runLintCases(cases);
