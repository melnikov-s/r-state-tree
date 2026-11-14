import { runLintCases } from "./helpers/lint";
import type { Case } from "./helpers/lint";

const cases: Record<string, Case[]> = {
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
};

runLintCases(cases);
