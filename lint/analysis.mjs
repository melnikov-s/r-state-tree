// Shared, syntax-only analysis. No dependency on r-state-tree or a lint runner.
export const unwrap = (node) => {
	while (
		node &&
		[
			"TSAsExpression",
			"TSTypeAssertion",
			"TSNonNullExpression",
			"TSSatisfiesExpression",
			"ChainExpression",
			"ParenthesizedExpression",
		].includes(node.type)
	)
		node = node.expression;
	return node;
};
export const key = (node) =>
	node &&
	(!node.computed && node.property?.type === "Identifier"
		? node.property.name
		: node.property?.value);
export const name = (node) =>
	node &&
	(!node.computed && node.key?.type === "Identifier"
		? node.key.name
		: node.key?.value);
export const isFunction = (node) =>
	node &&
	[
		"ArrowFunctionExpression",
		"FunctionExpression",
		"FunctionDeclaration",
	].includes(node.type);
export const mutators = {
	array: new Set([
		"copyWithin",
		"fill",
		"pop",
		"push",
		"reverse",
		"shift",
		"sort",
		"splice",
		"unshift",
	]),
	map: new Set(["set", "delete", "clear"]),
	set: new Set(["add", "delete", "clear"]),
};
export const iterations = new Set([
	"map",
	"flatMap",
	"filter",
	"forEach",
	"find",
	"findIndex",
	"findLast",
	"findLastIndex",
	"some",
	"every",
	"reduce",
	"reduceRight",
	"sort",
	"toSorted",
]);
export const copies = new Set([
	"slice",
	"filter",
	"map",
	"flatMap",
	"concat",
	"toSorted",
	"toReversed",
	"toSpliced",
	"with",
]);

export function analysis(source) {
	const children = (node) =>
		(source.visitorKeys[node.type] ?? []).flatMap((k) => {
			const value = node[k];
			return (Array.isArray(value) ? value : [value]).filter((n) => n?.type);
		});
	function walk(node, visit) {
		if (!node) return;
		visit(node);
		for (const child of children(node)) walk(child, visit);
	}
	function variable(node) {
		if (node?.type !== "Identifier") return null;
		for (let scope = source.getScope(node); scope; scope = scope.upper) {
			const found = scope.set.get(node.name);
			if (found) return found;
		}
		return null;
	}
	function immutableInit(node) {
		const v = variable(node);
		const def = v?.defs[0];
		if (
			v?.defs.length !== 1 ||
			def?.type !== "Variable" ||
			def.parent?.kind !== "const" ||
			def.node.id.type !== "Identifier"
		)
			return null;
		if (v.references.some((r) => r.isWrite() && !r.init)) return null;
		return def.node.init;
	}
	function api(node, seen = new Set()) {
		node = unwrap(node);
		if (!node || seen.has(node)) return null;
		seen.add(node);
		if (node.type === "MemberExpression")
			return api(node.object, seen) === "namespace" ? key(node) : null;
		if (node.type !== "Identifier") return null;
		const def = variable(node)?.defs[0];
		if (
			def?.type === "ImportBinding" &&
			def.parent.source.value === "r-state-tree" &&
			def.parent.importKind !== "type" &&
			def.node.importKind !== "type"
		) {
			return def.node.type === "ImportNamespaceSpecifier"
				? "namespace"
				: def.node.imported?.name;
		}
		return api(immutableInit(node), seen);
	}
	function classNode(node, seen = new Set()) {
		node = unwrap(node);
		if (!node || seen.has(node)) return null;
		seen.add(node);
		if (["ClassDeclaration", "ClassExpression"].includes(node.type))
			return node;
		const def = variable(node)?.defs[0];
		if (def?.type === "ClassName") return def.node;
		return classNode(immutableInit(node), seen);
	}
	function classKind(node, seen = new Set()) {
		const imported = api(node);
		if (imported === "Store" || imported === "Model") return imported;
		const cls = classNode(node);
		if (!cls || seen.has(cls)) return null;
		seen.add(cls);
		return classKind(cls.superClass, seen);
	}
	function global(node, expected) {
		return (
			node?.type === "Identifier" &&
			node.name === expected &&
			!variable(node)?.defs.length
		);
	}
	function shape(node) {
		node = unwrap(node);
		if (!node) return null;
		if (node.type === "ArrayExpression") return "array";
		if (node.type === "ObjectExpression") return "object";
		if (node.type === "NewExpression") {
			for (const [ctor, kind] of [
				["Array", "array"],
				["Map", "map"],
				["Set", "set"],
			])
				if (global(node.callee, ctor)) return kind;
		}
		return null;
	}
	function annotation(node) {
		const t = node?.typeAnnotation?.typeAnnotation;
		if (t?.type === "TSArrayType" || t?.type === "TSTupleType") return "array";
		if (t?.type === "TSTypeReference" && global(t.typeName, t.typeName?.name))
			return (
				{
					Array: "array",
					ReadonlyArray: "array",
					Map: "map",
					ReadonlyMap: "map",
					Set: "set",
					ReadonlySet: "set",
				}[t.typeName?.name] ?? null
			);
		return null;
	}
	const configs = new Map();
	function config(cls) {
		if (configs.has(cls)) return configs.get(cls);
		const entries = new Map();
		configs.set(cls, entries);
		const parent = classNode(cls.superClass);
		if (parent) for (const [k, v] of config(parent)) entries.set(k, v);
		for (const field of cls.body.body) {
			for (const d of field.decorators ?? []) {
				const e = unwrap(d.expression);
				entries.set(
					name(field),
					api(e?.type === "CallExpression" ? e.callee : e)
				);
			}
		}
		for (const field of cls.body.body) {
			if (
				!field.static ||
				name(field) !== "types" ||
				field.value?.type !== "ObjectExpression"
			)
				continue;
			for (const p of field.value.properties) {
				const e = unwrap(p.value);
				entries.set(name(p), api(e?.type === "CallExpression" ? e.callee : e));
			}
		}
		return entries;
	}
	const fieldCache = new Map();
	function fields(cls) {
		if (!cls) return new Map();
		if (fieldCache.has(cls)) return fieldCache.get(cls);
		const result = new Map();
		fieldCache.set(cls, result);
		const parent = classNode(cls.superClass);
		if (parent) for (const [k, v] of fields(parent)) result.set(k, v);
		const cfg = config(cls);
		for (const [field] of result)
			if (["child", "modelRef"].includes(cfg.get(field))) result.delete(field);
		for (const field of cls.body.body) {
			if (field.static) continue;
			result.delete(name(field));
			if (!["PropertyDefinition", "AccessorProperty"].includes(field.type))
				continue;
			let value = unwrap(field.value);
			const wrapped =
				value?.type === "CallExpression" &&
				["observable", "toObservableTree"].includes(api(value.callee));
			if (wrapped) value = unwrap(value.arguments[0]);
			const kind = shape(value);
			if (kind && !["child", "modelRef"].includes(cfg.get(name(field))))
				result.set(name(field), { kind, wrapped, initializer: field.value });
		}
		return result;
	}
	function enclosingClass(node) {
		for (let p = node.parent; p; p = p.parent) {
			if (p.type === "ClassBody") return p.parent;
			if (p.type === "MethodDefinition" && p.static) return null;
			// A normal nested function has its own `this`.
			if (
				["FunctionExpression", "FunctionDeclaration"].includes(p.type) &&
				p.parent?.type !== "MethodDefinition"
			)
				return null;
		}
		return null;
	}
	function fieldRef(node, cls, seen = new Set()) {
		node = unwrap(node);
		if (!node || seen.has(node)) return null;
		seen.add(node);
		if (node.type === "Identifier") {
			const def = variable(node)?.defs[0];
			if (
				def?.type === "Variable" &&
				def.parent?.kind === "const" &&
				def.node.id.type === "ObjectPattern"
			) {
				const property = def.node.id.properties.find(
					(p) =>
						p.type === "Property" &&
						p.value.type === "Identifier" &&
						variable(p.value) === variable(node)
				);
				if (property)
					return selectField(
						fieldRef(def.node.init, cls, seen),
						name(property),
						cls
					);
			}
			return fieldRef(immutableInit(node), cls, seen);
		}
		if (node.type === "ThisExpression")
			return enclosingClass(node) === cls ? { root: true } : null;
		if (node.type !== "MemberExpression") return null;
		return selectField(fieldRef(node.object, cls, seen), key(node), cls);
	}
	function selectField(base, prop, cls) {
		if (base?.root) {
			const field = fields(cls).get(prop);
			return field ? { ...field, field: prop, depth: 0 } : null;
		}
		return base ? { ...base, depth: base.depth + 1 } : null;
	}
	function freshShape(node, seen = new Set()) {
		node = unwrap(node);
		if (!node || seen.has(node)) return null;
		seen.add(node);
		if (shape(node)) return shape(node);
		if (node.type === "Identifier")
			return freshShape(immutableInit(node), seen);
		if (node.type === "CallExpression") {
			if (["observable", "toObservableTree"].includes(api(node.callee)))
				return freshShape(node.arguments[0], seen);
			if (
				node.callee.type === "MemberExpression" &&
				copies.has(key(node.callee)) &&
				expressionShape(node.callee.object, enclosingClass(node)) === "array"
			)
				return "array";
		}
		return null;
	}
	function initialValue(node, cls, seen = new Set()) {
		node = unwrap(node);
		if (!node || seen.has(node)) return null;
		seen.add(node);
		if (node.type === "Identifier")
			return initialValue(immutableInit(node), cls, seen);
		if (
			node.type === "CallExpression" &&
			["observable", "toObservableTree"].includes(api(node.callee))
		)
			return initialValue(node.arguments[0], cls, seen);
		if (node.type === "MemberExpression") {
			const field = fieldRef(node, cls);
			if (field?.depth === 0) return initialValue(field.initializer, cls, seen);
			const object = initialValue(node.object, cls, seen);
			if (object?.type === "ObjectExpression") {
				const property = object.properties.findLast(
					(p) => p.type === "Property" && name(p) === key(node)
				);
				return initialValue(property?.value, cls, seen);
			}
			return null;
		}
		return node;
	}
	function expressionShape(node, cls, seen = new Set()) {
		node = unwrap(node);
		if (!node || seen.has(node)) return null;
		seen.add(node);
		if (shape(node)) return shape(node);
		if (node.type === "Identifier") {
			const def = variable(node)?.defs[0];
			return (
				annotation(def?.name) ?? expressionShape(immutableInit(node), cls, seen)
			);
		}
		if (node.type === "MemberExpression") {
			const field = fieldRef(node, cls);
			if (field?.depth === 0) return field.kind;
			return shape(initialValue(node, cls));
		}
		if (
			node.type === "CallExpression" &&
			["observable", "toObservableTree"].includes(api(node.callee))
		)
			return expressionShape(node.arguments[0], cls, seen);
		return null;
	}
	return {
		children,
		walk,
		variable,
		immutableInit,
		api,
		classNode,
		classKind,
		global,
		shape,
		annotation,
		config,
		fields,
		enclosingClass,
		fieldRef,
		freshShape,
		expressionShape,
	};
}
