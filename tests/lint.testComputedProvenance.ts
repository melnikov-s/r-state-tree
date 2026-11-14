import { runLintCases, getter } from "./helpers/lint";
import type { Case } from "./helpers/lint";

const cases: Record<string, Case[]> = {
	"no-computed-mutation": [
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
	],
};

runLintCases(cases);
