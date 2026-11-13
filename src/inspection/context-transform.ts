import { parseSync, type ESTree } from "vite";
import { INSPECTION_CONTEXT_KEY, INSPECTION_CONTEXTS_KEY } from "./contexts";

const object = "globalThis.Object";
const symbol = (key: string) => `globalThis.Symbol.for(${JSON.stringify(key)})`;
type Binding = { safe: boolean; start: number; factory?: boolean };
const contextModule = (source: string) =>
	source === "r-state-tree" ||
	(/^\.\.?\//.test(source) &&
		/(?:^|\/)src(?:\/(?:index|context))?(?:\.[cm]?[jt]s)?$/.test(source));
type Scope = Map<string, Binding>;
function children(node: ESTree.Node): ESTree.Node[] {
	const result: ESTree.Node[] = [];
	for (const [key, value] of Object.entries(node)) {
		if (key === "parent") continue;
		if (Array.isArray(value)) {
			for (const child of value)
				if (child && typeof child === "object" && "type" in child)
					result.push(child);
		} else if (value && typeof value === "object" && "type" in value)
			result.push(value as ESTree.Node);
	}
	return result;
}
function names(node: ESTree.Node | null | undefined): string[] {
	if (!node) return [];
	if (node.type === "Identifier") return [node.name];
	if (node.type === "AssignmentPattern") return names(node.left);
	if (node.type === "RestElement") return names(node.argument);
	if (node.type === "TSParameterProperty") return names(node.parameter);
	if (node.type === "ObjectPattern")
		return node.properties.flatMap((p) =>
			names(p.type === "RestElement" ? p.argument : p.value)
		);
	if (node.type === "ArrayPattern") return node.elements.flatMap(names);
	return [];
}
/** Conservatively exclude any member-local binding: never re-evaluate an arbitrary expression. */
function localNames(node: ESTree.Node): Set<string> {
	const found = new Set<string>();
	function visit(n: ESTree.Node) {
		if (n.type === "VariableDeclarator")
			names(n.id).forEach((name) => found.add(name));
		if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration")
			names(n.id).forEach((name) => found.add(name));
		if ("params" in n && Array.isArray(n.params))
			for (const param of n.params)
				names(param).forEach((name) => found.add(name));
		if (n.type === "CatchClause")
			names(n.param).forEach((name) => found.add(name));
		children(n).forEach(visit);
	}
	visit(node);
	return found;
}
/** Dev-only insertion transform. Metadata contains labels/identities, never default expression source. */
export function transformInspectionContexts(
	source: string,
	id: string
): { code: string; map: null } | undefined {
	if (
		source.length > 2_000_000 ||
		!/\.(?:[cm]?ts|tsx)$/.test(id) ||
		/\.d\.[cm]?ts$/.test(id)
	)
		return undefined;
	const parsed = parseSync(id, source);
	if (parsed.errors.length) return undefined;
	const inserts: { at: number; text: string }[] = [];
	let metadataBytes = 0;
	function visit(node: ESTree.Node, inherited: Scope) {
		let scope = inherited;
		if (node.type === "Program" || node.type === "BlockStatement") {
			scope = new Map(inherited);
			for (let statement of node.body) {
				if (
					statement.type === "ExportNamedDeclaration" &&
					statement.declaration
				)
					statement = statement.declaration;
				if (statement.type === "VariableDeclaration")
					for (const declaration of statement.declarations)
						for (const name of names(declaration.id))
							scope.set(name, {
								safe: statement.kind === "const",
								start: declaration.end,
							});
				if (statement.type === "ImportDeclaration")
					for (const specifier of statement.specifiers)
						scope.set(specifier.local.name, {
							safe:
								statement.importKind !== "type" &&
								!(
									specifier.type === "ImportSpecifier" &&
									specifier.importKind === "type"
								),
							start: -1,
							factory:
								contextModule(statement.source.value) &&
								specifier.type === "ImportSpecifier" &&
								specifier.imported.type === "Identifier" &&
								specifier.imported.name === "createContext",
						});
				if (
					statement.type === "FunctionDeclaration" ||
					statement.type === "ClassDeclaration"
				)
					for (const name of names(statement.id))
						scope.set(name, { safe: false, start: statement.start });
			}
		}
		if (
			node.type === "ForStatement" ||
			node.type === "ForInStatement" ||
			node.type === "ForOfStatement" ||
			node.type === "CatchClause" ||
			node.type === "SwitchStatement" ||
			node.type === "ClassExpression"
		) {
			scope = new Map(scope);
			const bindings =
				node.type === "CatchClause"
					? names(node.param)
					: node.type === "ClassExpression"
						? names(node.id)
						: node.type === "SwitchStatement"
							? [...localNames(node)]
							: (() => {
									const declaration =
										node.type === "ForStatement"
											? node.init
											: node.type === "ForInStatement" ||
												  node.type === "ForOfStatement"
												? node.left
												: undefined;
									return declaration?.type === "VariableDeclaration"
										? declaration.declarations.flatMap((d) => names(d.id))
										: [];
								})();
			for (const name of bindings)
				scope.set(name, { safe: false, start: node.start });
		}
		if ("params" in node && Array.isArray(node.params)) {
			scope = new Map(scope);
			for (const name of localNames(node))
				scope.set(name, { safe: false, start: node.start });
		}
		if (node.type === "VariableDeclaration" && node.kind === "const") {
			for (const declaration of node.declarations) {
				const call = declaration.init;
				if (
					declaration.id.type !== "Identifier" ||
					!call ||
					call.type !== "CallExpression" ||
					call.callee.type !== "Identifier" ||
					!scope.get(call.callee.name)?.factory ||
					!scope.get(call.callee.name)?.safe
				)
					continue;
				const type = call.typeArguments?.params[0];
				const meta = JSON.stringify({
					name: declaration.id.name.slice(0, 128),
					...(type
						? {
								type: source
									.slice(type.start, type.end)
									.replace(/\s+/g, " ")
									.slice(0, 256),
							}
						: {}),
					// A spread may supply zero arguments; do not claim a known default.
					...(!call.arguments.some(
						(argument) => argument.type === "SpreadElement"
					)
						? { hasDefault: call.arguments.length > 0 }
						: {}),
				}).replace(/</g, "\\u003c");
				if ((metadataBytes += meta.length) > 262144) continue;
				// Same returned object, same single createContext call; no default read/copy.
				inserts.push(
					{
						at: call.start,
						text: `((__rstContext)=>{try{if(__rstContext&&typeof __rstContext==="object"&&${object}.isExtensible(__rstContext)&&typeof ${object}.getOwnPropertyDescriptor(__rstContext,"provide")?.value==="symbol"&&typeof ${object}.getOwnPropertyDescriptor(__rstContext,"consume")?.value==="function")${object}.defineProperty(__rstContext,${symbol(INSPECTION_CONTEXT_KEY)},{value:${meta},configurable:true});}catch{}return __rstContext;})(`,
					},
					{ at: call.end, text: `)` }
				);
			}
		}
		if (
			(node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
			!node.declare
		) {
			const entries: string[] = [];
			const safe = (name: string) => {
				const binding = scope.get(name);
				return binding?.safe && binding.start < node.start;
			};
			for (const member of node.body.body) {
				if (
					(member.type !== "MethodDefinition" &&
						member.type !== "PropertyDefinition") ||
					member.static ||
					member.decorators.length
				)
					continue;
				let key: string | undefined;
				if (!member.computed && member.key.type === "Identifier")
					key = JSON.stringify(member.key.name);
				else if (
					!member.computed &&
					member.key.type === "Literal" &&
					typeof member.key.value === "string"
				)
					key = JSON.stringify(member.key.value);
				const computed =
					member.computed &&
					member.key.type === "MemberExpression" &&
					!member.key.computed &&
					member.key.object.type === "Identifier" &&
					member.key.property.type === "Identifier" &&
					member.key.property.name === "provide" &&
					safe(member.key.object.name)
						? member.key.object.name
						: undefined;
				if (computed)
					key = `${object}.getOwnPropertyDescriptor(${computed},"provide")?.value`;
				const slot =
					member.type === "MethodDefinition" && member.kind === "get"
						? "get"
						: member.type === "MethodDefinition" && member.kind === "set"
							? "set"
							: "value";
				const construction =
					member.type === "PropertyDefinition" ||
					(member.type === "MethodDefinition" && member.kind === "constructor");
				const identity = construction
					? "construction:true"
					: `key:${key},slot:${JSON.stringify(slot)},method:${object}.getOwnPropertyDescriptor(this.prototype,${key})?.${slot}`;
				if (
					computed &&
					member.type === "MethodDefinition" &&
					member.kind === "method"
				)
					entries.push(
						`{context:${computed},name:${JSON.stringify(computed)},kind:"provide",${identity}}`
					);
				if (!member.value || (!key && !construction)) continue;
				const locals = localNames(member.value);
				const consumed = new Set<string>();
				function scan(n: ESTree.Node, top = false) {
					if (
						!top &&
						(n.type === "FunctionExpression" ||
							n.type === "FunctionDeclaration" ||
							n.type === "ClassDeclaration" ||
							n.type === "ClassExpression")
					)
						return;
					// Arrow property bodies have no static identity. Do not claim reads after replacement.
					if (
						construction &&
						member.type === "PropertyDefinition" &&
						n.type === "ArrowFunctionExpression"
					)
						return;
					if (
						n.type === "CallExpression" &&
						n.callee.type === "MemberExpression" &&
						!n.callee.computed &&
						n.callee.object.type === "Identifier" &&
						n.callee.property.type === "Identifier" &&
						n.callee.property.name === "consume" &&
						n.arguments.length === 1 &&
						n.arguments[0].type === "ThisExpression" &&
						safe(n.callee.object.name) &&
						!locals.has(n.callee.object.name)
					)
						consumed.add(n.callee.object.name);
					children(n).forEach((child) => scan(child));
				}
				scan(member.value, true);
				for (const name of consumed)
					entries.push(
						`{context:${name},name:${JSON.stringify(name)},kind:"consume",${identity}}`
					);
				if (entries.length >= 64) break;
			}
			const table = entries.slice(0, 64).join(",");
			if (table && (metadataBytes += table.length) <= 262144)
				inserts.push({
					// All instance methods are installed before static initialization runs.
					// Capture before application static blocks can replace their descriptors.
					at: node.body.start + 1,
					text: `;static {try {${object}.defineProperty(this.prototype,${symbol(INSPECTION_CONTEXTS_KEY)},{value:[${table}],configurable:true});} catch { /* inspection metadata unavailable */ }}`,
				});
		}
		for (const child of children(node)) visit(child, scope);
	}
	visit(parsed.program, new Map());
	if (!inserts.length) return undefined;
	let code = source;
	for (const insert of inserts.sort((a, b) => b.at - a.at))
		code = code.slice(0, insert.at) + insert.text + code.slice(insert.at);
	return { code, map: null };
}
