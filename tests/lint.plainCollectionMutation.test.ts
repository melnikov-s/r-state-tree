import { runLintCases } from "./helpers/lint";
import type { Case } from "./helpers/lint";

const cases: Record<string, Case[]> = {
	"no-plain-collection-mutation": [
		[
			"plain array push",
			"class S extends Store { rows = []; add() { this.rows.push(1) } }",
			1,
		],
		[
			"mutable audio buffer needs wrapping, not copy-and-reassign",
			"class S extends Store { preroll: Float32Array[] = []; append(samples: Float32Array) { this.preroll.push(samples); this.preroll.shift() } }",
			2,
		],
		[
			"wrapped audio buffer retains push and shift",
			"class S extends Store { preroll: Float32Array[] = observable([]); append(samples: Float32Array) { this.preroll.push(samples); this.preroll.shift() } }",
			0,
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
			"plain whole-field replacement remains outside rule scope",
			"class S extends Store { rows = []; edit() { this.rows = [...this.rows, 1] } }",
			0,
		],
		[
			"intentional immutable array replacement",
			"class M extends Model { rows: readonly number[] = []; replace(rows: readonly number[]) { this.rows = [...rows] } }",
			0,
		],
		[
			"intentional immutable object replacement",
			"class M extends Model { data: Readonly<{ x: number }> = { x: 0 }; replace(x: number) { this.data = { x } } }",
			0,
		],
		[
			"plain read-only field and derived local result",
			"class S extends Store { rows: readonly number[] = [2, 1]; get sorted() { const result = this.rows.slice(); result.sort(); return result } }",
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
};

runLintCases(cases);
