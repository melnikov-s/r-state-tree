import { runLintCases, getter } from "./helpers/lint";
import type { Case } from "./helpers/lint";

const cases: Record<string, Case[]> = {
	"no-computed-mutation": [
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
};

runLintCases(cases);
