import {
	runLintCases,
	getter,
	childStore,
	asyncReviewCases,
} from "./helpers/lint";
import type { Case } from "./helpers/lint";

const cases: Record<string, Case[]> = {
	"no-discarded-child-read": [
		["discarded decorated child", childStore("this.worker;"), 1],
		["void decorated child", childStore("void this.worker;"), 1],
		["two discarded reads", childStore("this.worker; void this.worker;"), 2],
		["literal computed read", childStore("this['worker'];"), 1],
		[
			"literal computed declaration",
			childStore("this.worker;", "@child get ['worker']() { return null }"),
			1,
		],
		[
			"TypeScript wrappers",
			childStore(
				"void (this.worker! as Worker); (this.worker satisfies Worker);"
			),
			2,
		],
		["optional this read", childStore("this?.worker;"), 1],
		[
			"getter and setter pair",
			childStore(
				"this.worker;",
				"set worker(value) {} @child get worker() { return null }"
			),
			1,
		],
		[
			"derived setter masks inherited getter",
			"class Base extends Store { @child get worker() { return null } } class S extends Base { set worker(value) {} run() { this.worker; } }",
			0,
		],
		[
			"numeric literal key",
			childStore(
				"this[1];",
				"static types = { 1: child }; get [1]() { return null }"
			),
			1,
		],
		[
			"static literal types",
			childStore(
				"this.worker;",
				"static types = { worker: child }; get worker() { return null }"
			),
			1,
		],
		[
			"static child factory config",
			childStore(
				"void this.worker;",
				"static types = { worker: child(Worker) }; get worker() { return null }"
			),
			1,
		],
		[
			"decorator factory",
			childStore("this.worker;", "@child(Worker) get worker() { return null }"),
			1,
		],
		[
			"aliased imports",
			"import { Store as Base, child as lazy } from 'r-state-tree'; class S extends Base { @lazy get worker() { return null } run() { this.worker; } }",
			1,
		],
		[
			"namespace imports",
			"import * as rst from 'r-state-tree'; class S extends rst.Store { @rst.child get worker() { return null } run() { void this.worker; } }",
			1,
		],
		[
			"immutable API aliases",
			"const Base = Store; const lazy = child; const S = class extends Base { @lazy get worker() { return null } run() { this.worker; } }",
			1,
		],
		[
			"inherited decorated getter",
			"class Base extends Store { @child get worker() { return null } } class S extends Base { run() { this.worker; } }",
			1,
		],
		[
			"inherited static configuration",
			"class Base extends Store { static types = { worker: child }; get worker() { return null } } class S extends Base { run() { this.worker; } }",
			1,
		],
		[
			"derived static configuration of inherited getter",
			"class Base extends Store { get worker() { return null } } class S extends Base { static types = { worker: child }; run() { this.worker; } }",
			1,
		],
		[
			"configuration remains on overriding getter",
			"class Base extends Store { @child get worker() { return null } } class S extends Base { get worker() { return null } run() { this.worker; } }",
			1,
		],
		[
			"arrow retains method this",
			childStore("schedule(() => { this.worker; });"),
			1,
		],
		[
			"nested regular function has own this",
			childStore("function later() { this.worker; }"),
			0,
		],
		[
			"nested unrelated class",
			childStore("class Other { run() { this.worker; } }"),
			0,
		],
		[
			"Model owned child is not lazy Store child",
			"class M extends Model { @child(Model) worker = null; run() { this.worker; void this.worker; } }",
			0,
		],
		[
			"Model static types ownership",
			"class M extends Model { static types = { worker: child(Model) }; worker = null; run() { this.worker; } }",
			0,
		],
		[
			"unrelated class decorator",
			"class S { @child get worker() { return null } run() { this.worker; } }",
			0,
		],
		[
			"shadowed Store import",
			"function make(Store: any) { class S extends Store { @child get worker() { return null } run() { this.worker; } } }",
			0,
		],
		[
			"shadowed child import",
			"function make(child: any) { class S extends Store { @child get worker() { return null } run() { this.worker; } } }",
			0,
		],
		[
			"unrelated decorator import",
			"import { child as lazy } from 'other'; class S extends Store { @lazy get worker() { return null } run() { this.worker; } }",
			0,
		],
		[
			"unknown cross-file superclass",
			"import { Base } from './base'; class S extends Base { @child get worker() { return null } run() { this.worker; } }",
			0,
		],
		["dynamic read key", childStore("this[key]; this[`worker`];"), 0],
		[
			"dynamic declaration key",
			childStore("this.worker;", "@child get [key]() { return null }"),
			0,
		],
		[
			"dynamic static configuration key",
			childStore(
				"this.worker;",
				"static types = { [key]: child }; get worker() { return null }"
			),
			0,
		],
		["consumed return", childStore("return this.worker;"), 0],
		[
			"consumed variable",
			childStore("const worker = this.worker; consume(worker);"),
			0,
		],
		["consumed argument", childStore("consume(this.worker);"), 0],
		[
			"consumed member and method",
			childStore("this.worker.value; this.worker.start();"),
			0,
		],
		[
			"consumed conditional and logical read",
			childStore("if (this.worker) consume(); this.worker && consume();"),
			0,
		],
		[
			"consumed assignment and await",
			childStore(
				"target.worker = this.worker; void Promise.resolve(this.worker);"
			),
			0,
		],
		[
			"intentional warmup is still rejected",
			childStore(
				"// Intentional startup warmup is not an exception.\nvoid this.worker;"
			),
			1,
		],
		[
			"eager-init helper is outside detection, not endorsed",
			childStore("warmup(this.worker);"),
			0,
		],
		[
			"computed non-child getter",
			childStore("this.worker;", "@computed get worker() { return null }"),
			0,
		],
		[
			"static override to computed",
			"class Base extends Store { @child get worker() { return null } } class S extends Base { static types = { worker: computed }; run() { this.worker; } }",
			0,
		],
		[
			"derived decorator override",
			"class Base extends Store { @child get worker() { return null } } class S extends Base { @computed get worker() { return null } run() { this.worker; } }",
			0,
		],
		[
			"static types overrides decorator",
			childStore(
				"this.worker;",
				"static types = { worker: computed }; @child get worker() { return null }"
			),
			0,
		],
		[
			"inherited getter replaced by field",
			"class Base extends Store { @child get worker() { return null } } class S extends Base { worker = null; run() { this.worker; } }",
			0,
		],
		[
			"inherited getter replaced by method",
			"class Base extends Store { @child get worker() { return null } } class S extends Base { worker() {} run() { this.worker; } }",
			0,
		],
		[
			"static contexts",
			"class S extends Store { @child get worker() { return null } static run() { this.worker; } static later = () => { this.worker; }; static { this.worker; } }",
			0,
		],
		[
			"raw constructor and field this",
			"class S extends Store { @child get worker() { return null } constructor() { super(); this.worker; } later = () => { this.worker; }; value = (() => { this.worker; })(); }",
			0,
		],
		[
			"immutable this alias deliberately outside scope",
			childStore("const self = this; self.worker;"),
			0,
		],
		[
			"getter required for Store child",
			childStore("this.worker;", "@child worker = null;"),
			0,
		],
		[
			"unknown static config",
			childStore(
				"this.worker;",
				"static types = configuration; @child get worker() { return null }"
			),
			0,
		],
		[
			"spread config uncertainty",
			childStore(
				"this.worker;",
				"static types = { worker: child, ...other }; get worker() { return null }"
			),
			0,
		],
		[
			"static accessor uncertainty",
			childStore(
				"this.worker;",
				"static get types() { return config } @child get worker() { return null }"
			),
			0,
		],
		[
			"unknown decorator uncertainty",
			childStore("this.worker;", "@other @child get worker() { return null }"),
			0,
		],
		[
			"unknown class decorator uncertainty",
			"@other class S extends Store { @child get worker() { return null } run() { this.worker; } }",
			0,
		],
		[
			"unrelated static decorator is not instance config",
			childStore(
				"this.worker;",
				"@child static get worker() { return null } get worker() { return null }"
			),
			0,
		],
		[
			"sequence expression outside scope",
			childStore("this.worker, consume();"),
			0,
		],
		...asyncReviewCases,
	],
};

runLintCases(cases);
