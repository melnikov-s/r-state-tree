import { unwrap, key, name } from "./analysis.mjs";

// Only names whose value is fixed by syntax. Never guess a computed identifier.
const fixedName = (node, member = false) => {
	const property = member ? node.property : node.key;
	if (property?.type === "PrivateIdentifier") return null;
	if (!node.computed && property?.type === "Identifier")
		return member ? key(node) : name(node);
	return property?.type === "Literal" &&
		["string", "number"].includes(typeof property.value)
		? String(property.value)
		: null;
};

export function checkDiscardedChildReads(program, a, report) {
	const cache = new Map();
	function knownChildGetter(cls, property) {
		let results = cache.get(cls);
		if (!results) cache.set(cls, (results = new Map()));
		if (results.has(property)) return results.get(property);
		// Cache the conservative default, including for malformed cyclic bases.
		results.set(property, false);
		if (a.classKind(cls) !== "Store") return false;
		let getter;
		const seen = new Set();
		for (
			let current = cls;
			current;
			current = a.classNode(current.superClass)
		) {
			if (seen.has(current) || current.decorators?.length) return false;
			seen.add(current);
			const own = current.body.body.filter(
				(field) => !field.static && fixedName(field) === property
			);
			if (!getter && own.length)
				getter =
					own.find(
						(field) =>
							field.type !== "MethodDefinition" ||
							!["get", "set"].includes(field.kind)
					) ??
					own.find((field) => field.kind === "get") ??
					own[0];
			for (const field of current.body.body) {
				if (field.type === "StaticBlock") return false;
				const fieldName = fixedName(field);
				// An unknown key could replace the getter or the static configuration.
				if (field.computed && fieldName === null) return false;
				if (field.static && fieldName === property && field.decorators?.length)
					return false;
				if (!field.static && fieldName === property) {
					// Unknown/multiple decorators may change descriptors or metadata.
					if ((field.decorators?.length ?? 0) > 1) return false;
					for (const decorator of field.decorators ?? []) {
						const e = unwrap(decorator.expression);
						if (!knownConfig(e)) return false;
					}
				}
				if (!field.static || fieldName !== "types") continue;
				const value = unwrap(field.value);
				if (
					field.type !== "PropertyDefinition" ||
					field.decorators?.length ||
					value?.type !== "ObjectExpression"
				)
					return false;
				for (const p of value.properties) {
					// Spreads, accessors and unknown keys can replace any entry.
					if (
						p.type !== "Property" ||
						p.kind !== "init" ||
						p.method ||
						fixedName(p) === null
					)
						return false;
					if (fixedName(p) === property && !knownConfig(unwrap(p.value)))
						return false;
				}
			}
		}
		const known =
			getter?.type === "MethodDefinition" &&
			getter.kind === "get" &&
			new Map([...a.config(cls)].map(([p, config]) => [String(p), config])).get(
				property
			) === "child";
		results.set(property, known);
		return known;
	}
	function knownConfig(e) {
		if (e?.type === "CallExpression") {
			if (e.arguments.length !== 1 || e.arguments[0].type === "SpreadElement")
				return false;
			e = unwrap(e.callee);
		}
		return [
			"child",
			"computed",
			"observable",
			"modelRef",
			"snapshot",
			"transient",
			"id",
		].includes(a.api(e));
	}
	function proxiedThis(node, cls) {
		// Constructors and field initializers run on the raw instance, not the
		// initialized Store proxy. Static contexts also have a different `this`.
		for (let p = node.parent; p && p !== cls.body; p = p.parent) {
			if (
				["PropertyDefinition", "AccessorProperty", "StaticBlock"].includes(
					p.type
				) ||
				(p.type === "MethodDefinition" &&
					(p.static || p.kind === "constructor"))
			)
				return false;
		}
		return true;
	}
	a.walk(program, (statement) => {
		if (statement.type !== "ExpressionStatement") return;
		let read = unwrap(statement.expression);
		if (read?.type === "UnaryExpression" && read.operator === "void")
			read = unwrap(read.argument);
		if (
			read?.type !== "MemberExpression" ||
			unwrap(read.object)?.type !== "ThisExpression"
		)
			return;
		const property = fixedName(read, true);
		const cls = a.enclosingClass(read);
		if (property === null || !cls || !proxiedThis(read, cls)) return;
		if (knownChildGetter(cls, property)) report(read, { field: property });
	});
}
