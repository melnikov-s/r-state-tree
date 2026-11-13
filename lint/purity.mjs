import {
	unwrap,
	key,
	name,
	isFunction,
	mutators,
	iterations,
	copies,
} from "./analysis.mjs";

const external = (kind = null) => ({ origin: "external", kind });
const unknown = { origin: "unknown" };
const scalar = { origin: "scalar" };
const fresh = (kind, props = new Map(), item = null) => ({
	origin: "fresh",
	kind,
	props,
	item,
});
function join(a, b, depth = 0) {
	if (depth >= 8) return unknown;
	if (a == null) return b ?? null;
	if (b == null) return a;
	if (a === b) return a;
	if (a.origin === "external" || b.origin === "external")
		return external(a.kind === b.kind ? a.kind : null);
	if (a.origin === "fresh" && b.origin === "fresh") {
		return fresh(
			a.kind === b.kind ? a.kind : null,
			new Map(
				[...new Set([...a.props.keys(), ...b.props.keys()])].map((k) => [
					k,
					join(a.props.get(k) ?? unknown, b.props.get(k) ?? unknown, depth + 1),
				])
			),
			join(a.item, b.item, depth + 1)
		);
	}
	return unknown;
}

// Bounded intraprocedural execution: function definitions are values, not executions.
// Only direct local calls, IIFEs and known synchronous collection callbacks are entered.
export function checkPurity(root, cls, a, report) {
	const env = new Map();
	const active = new Set();
	let budget = 10000;
	const within = (node) =>
		node && node.range[0] >= root.range[0] && node.range[1] <= root.range[1];
	const local = (id) => a.variable(id)?.defs.some((d) => within(d.name));
	const fields = a.fields(cls);
	function readProperty(base = unknown, prop) {
		base ??= unknown;
		if (base.origin === "external")
			return external(base.self ? fields.get(prop)?.kind : null);
		if (base.origin === "fresh")
			return base.props.get(prop) ?? base.item ?? unknown;
		return unknown;
	}
	function bind(pattern, value, declare = false) {
		value ??= unknown;
		pattern = unwrap(pattern);
		if (!pattern) return;
		if (pattern.type === "Identifier") {
			if (!declare && !local(pattern)) report(pattern);
			env.set(a.variable(pattern) ?? pattern.name, value);
		} else if (pattern.type === "ObjectPattern") {
			for (const p of pattern.properties) {
				if (p.type === "RestElement")
					bind(
						p.argument,
						fresh(
							"object",
							new Map(),
							value.origin === "external" ? external() : value.item
						),
						declare
					);
				else bind(p.value, readProperty(value, name(p)), declare);
			}
		} else if (pattern.type === "ArrayPattern") {
			pattern.elements.forEach((p, index) => {
				if (p) bind(p, readProperty(value, index), declare);
			});
		} else if (pattern.type === "AssignmentPattern") {
			bind(pattern.left, join(value, evaluate(pattern.right)), declare);
		} else if (pattern.type === "RestElement") {
			bind(pattern.argument, fresh("array", new Map(), value), declare);
		} else if (pattern.type === "MemberExpression") {
			const base = evaluate(pattern.object);
			if (pattern.computed) evaluate(pattern.property);
			if (base.origin === "external") report(pattern);
			if (base.origin === "fresh") {
				base.props.set(key(pattern), value);
				base.item = join(base.item, value);
			}
		}
	}
	function functionValue(node) {
		node = unwrap(node);
		if (isFunction(node)) return node;
		if (node?.type !== "Identifier") return null;
		const value = env.get(a.variable(node));
		if (value?.fn) return value.fn;
		const def = a.variable(node)?.defs[0];
		const fn =
			def?.type === "FunctionName" ? def.node : unwrap(a.immutableInit(node));
		return isFunction(fn) && within(fn) ? fn : null;
	}
	function invoke(fn, args) {
		if (!fn || active.has(fn) || active.size >= 8 || budget <= 0)
			return unknown;
		active.add(fn);
		// Save bindings owned by this invocation, but keep writes to captured locals.
		const saved = new Map(env);
		for (let i = 0; i < fn.params.length; i++)
			bind(fn.params[i], args[i] ?? external(a.annotation(fn.params[i])), true);
		const result =
			fn.body.type === "BlockStatement" ? execute(fn.body) : evaluate(fn.body);
		for (const [v] of env) {
			if (
				typeof v !== "string" &&
				v?.defs.some(
					(d) =>
						d.name.range[0] >= fn.range[0] && d.name.range[1] <= fn.range[1]
				)
			) {
				if (saved.has(v)) env.set(v, saved.get(v));
				else env.delete(v);
			}
		}
		active.delete(fn);
		return result ?? unknown;
	}
	function branches(first, second) {
		const before = new Map(env);
		const left = first();
		const after = new Map(env);
		env.clear();
		for (const [v, x] of before) env.set(v, x);
		const right = second();
		for (const [v, x] of after) env.set(v, join(x, env.get(v)));
		return join(left, right);
	}
	function evaluate(node) {
		node = unwrap(node);
		if (!node || --budget <= 0) return unknown;
		if (isFunction(node)) return { origin: "function", fn: node };
		switch (node.type) {
			case "ThisExpression":
				return { ...external(), self: a.enclosingClass(node) === cls };
			case "Literal":
				return scalar;
			case "Identifier": {
				const v = a.variable(node);
				if (env.has(v)) return env.get(v) ?? unknown;
				// A local binding lost across an escaping closure is unknown, not external.
				if (local(node)) return unknown;
				const def = v?.defs[0];
				return external(
					a.expressionShape(node, cls) ?? a.annotation(def?.name)
				);
			}
			case "MemberExpression": {
				const base = evaluate(node.object);
				if (node.computed) evaluate(node.property);
				const value = readProperty(base, key(node));
				if (value.origin === "external" && !value.kind)
					value.kind = a.expressionShape(node, cls);
				return value;
			}
			case "ObjectExpression": {
				const props = new Map();
				let item = null;
				for (const p of node.properties) {
					if (p.type === "SpreadElement") {
						const spread = evaluate(p.argument);
						if (spread.origin === "fresh")
							for (const [k, v] of spread.props) props.set(k, v);
						item = join(
							item,
							spread.origin === "external" ? external() : spread.item
						);
					} else {
						if (p.computed) evaluate(p.key);
						props.set(name(p), evaluate(p.value));
					}
				}
				return fresh("object", props, item);
			}
			case "ArrayExpression": {
				const props = new Map();
				let item = null;
				node.elements.forEach((e, i) => {
					if (!e) return;
					const value = evaluate(e.type === "SpreadElement" ? e.argument : e);
					const entry =
						e.type === "SpreadElement"
							? value.origin === "external"
								? external()
								: value.item
							: value;
					props.set(i, entry);
					item = join(item, entry);
				});
				return fresh("array", props, item);
			}
			case "ClassExpression":
				return unknown;
			case "NewExpression": {
				const args = node.arguments.map(evaluate);
				const kind = a.shape(node);
				return kind
					? fresh(
							kind,
							new Map(),
							args[0]?.origin === "external" ? external() : args[0]?.item
						)
					: unknown;
			}
			case "AssignmentExpression": {
				const value = evaluate(node.right);
				bind(
					node.left,
					node.operator === "=" ? value : join(evaluate(node.left), value)
				);
				return value;
			}
			case "UpdateExpression":
				bind(node.argument, scalar);
				return scalar;
			case "UnaryExpression":
				if (node.operator === "delete") bind(node.argument, unknown);
				else evaluate(node.argument);
				return scalar;
			case "ConditionalExpression":
				evaluate(node.test);
				return branches(
					() => evaluate(node.consequent),
					() => evaluate(node.alternate)
				);
			case "LogicalExpression":
				return join(
					evaluate(node.left),
					branches(
						() => evaluate(node.right),
						() => unknown
					)
				);
			case "CallExpression":
				return call(node);
			case "SequenceExpression": {
				let value;
				for (const e of node.expressions) value = evaluate(e);
				return value;
			}
			default:
				for (const c of a.children(node)) evaluate(c);
				return unknown;
		}
	}
	function call(node) {
		const callee = unwrap(node.callee);
		const method = callee?.type === "MemberExpression" ? key(callee) : null;
		const base = method ? evaluate(callee.object) : null;
		if (!method) evaluate(callee);
		else if (callee.computed) evaluate(callee.property);
		const args = node.arguments.map(evaluate);
		if (base) {
			if (mutators[base.kind]?.has(method)) {
				if (base.origin === "external") report(node);
				if (
					base.origin === "fresh" &&
					["push", "unshift", "add", "set", "fill", "splice"].includes(method)
				) {
					const added =
						method === "set"
							? [args[1]]
							: method === "add" || method === "fill"
								? [args[0]]
								: method === "splice"
									? args.slice(2)
									: args;
					for (const value of added) base.item = join(base.item, value);
					if (method === "set") base.keyItem = join(base.keyItem, args[0]);
				}
			}
			let result = unknown;
			if (
				(base.kind === "array" && iterations.has(method)) ||
				(["map", "set"].includes(base.kind) && method === "forEach")
			) {
				const element =
					base.origin === "external" ? external() : (base.item ?? unknown);
				const params = method.startsWith("reduce")
					? [args[1] ?? element, element, scalar, base]
					: [
							element,
							method === "sort" || method === "toSorted" || base.kind === "set"
								? element
								: base.kind === "map"
									? base.origin === "external"
										? external()
										: (base.keyItem ?? unknown)
									: scalar,
							base,
						];
				result = invoke(functionValue(node.arguments[0]), params);
			}
			if (base.kind === "array" && copies.has(method)) {
				return fresh(
					"array",
					new Map(),
					method === "map" || method === "flatMap"
						? result
						: base.origin === "external"
							? external()
							: base.item
				);
			}
			if (base.kind === "map" && method === "get")
				return base.origin === "external" ? external() : (base.item ?? unknown);
			if (["sort", "reverse", "fill", "copyWithin"].includes(method))
				return base;
		}
		if (["observable", "toObservableTree", "source"].includes(a.api(callee)))
			return args[0] ?? unknown;
		if (
			callee?.type === "MemberExpression" &&
			((a.global(callee.object, "Object") &&
				["assign", "defineProperty", "defineProperties"].includes(method)) ||
				(a.global(callee.object, "Reflect") &&
					["set", "deleteProperty", "defineProperty"].includes(method)))
		) {
			const target = args[0];
			if (target?.origin === "external") report(node);
			if (target?.origin === "fresh" && method === "assign") {
				for (const source of args.slice(1)) {
					if (source.origin === "fresh")
						for (const [k, v] of source.props) target.props.set(k, v);
					target.item = join(
						target.item,
						source.origin === "external" ? external() : source.item
					);
				}
			}
			return target ?? unknown;
		}
		// Explicit synchronous wrappers are not a purity escape hatch.
		if (["batch", "untracked"].includes(a.api(callee)))
			return invoke(functionValue(node.arguments[0]), []);
		const fn = functionValue(callee);
		if (fn) return invoke(fn, args);
		// Unknown helper calls are NOT assumed pure, but cannot justify a mutation diagnostic.
		return unknown;
	}
	function execute(node) {
		if (!node || --budget <= 0) return unknown;
		switch (node.type) {
			case "BlockStatement": {
				let result = null;
				for (const stmt of node.body) {
					result = join(result, execute(stmt));
					if (["ReturnStatement", "ThrowStatement"].includes(stmt.type)) break;
				}
				return result;
			}
			case "VariableDeclaration":
				for (const d of node.declarations) bind(d.id, evaluate(d.init), true);
				return null;
			case "FunctionDeclaration":
			case "ClassDeclaration":
				return null;
			case "ReturnStatement":
			case "ThrowStatement":
				return evaluate(node.argument);
			case "ExpressionStatement":
				evaluate(node.expression);
				return null;
			case "IfStatement":
				evaluate(node.test);
				return branches(
					() => execute(node.consequent),
					() => execute(node.alternate)
				);
			case "ForOfStatement":
			case "ForInStatement": {
				const value = evaluate(node.right);
				const item =
					node.type === "ForInStatement"
						? scalar
						: value.origin === "external"
							? external()
							: value.item;
				if (node.left.type === "VariableDeclaration")
					bind(node.left.declarations[0].id, item, true);
				else bind(node.left, item);
				return branches(
					() => execute(node.body),
					() => unknown
				);
			}
			case "ForStatement":
			case "WhileStatement":
			case "DoWhileStatement":
				if (node.init?.type === "VariableDeclaration") execute(node.init);
				else evaluate(node.init);
				evaluate(node.test);
				return branches(
					() => {
						const r = execute(node.body);
						evaluate(node.update);
						return r;
					},
					() => unknown
				);
			default:
				for (const c of a.children(node)) {
					if (
						c.type.endsWith("Statement") ||
						c.type === "CatchClause" ||
						c.type === "SwitchCase"
					)
						execute(c);
					else evaluate(c);
				}
				return unknown;
		}
	}
	invoke(root, []);
}
