import { runLintCases } from "./helpers/lint";
import type { Case } from "./helpers/lint";

const cases: Record<string, Case[]> = {
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

runLintCases(cases);
