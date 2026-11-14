import { parseSync, type ESTree } from "vite";
import {
	INSPECTION_SIGNATURES_KEY,
	MAX_INSPECTION_PARAMETERS,
	MAX_INSPECTION_SIGNATURE_BYTES,
	type InspectionMethod,
	type InspectionParameter,
} from "./signatures.js";

const secret = /password|secret|token|authorization|cookie|credential/i;
const blocked = new Set(["constructor", "prototype", "__proto__"]);
const symbol = `globalThis.Symbol.for(${JSON.stringify(INSPECTION_SIGNATURES_KEY)})`;
const object = "globalThis.Object";
const MAX_SOURCE_LENGTH = 2_000_000;
const MAX_MODULE_METADATA = 262_144;
const MAX_CHOICES = 16;
const label = (source: string, node: { start: number; end: number }) => {
	const value = source.slice(node.start, node.end).replace(/\s+/g, " ");
	return value.length > 256 ? value.slice(0, 255) + "…" : value;
};

function literal(
	node: ESTree.Node
): string | number | boolean | null | undefined {
	if (node.type === "Literal") {
		const value = node.value;
		if (value === null || typeof value === "boolean") return value;
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && value.length <= 128) return value;
	}
	if (node.type === "UnaryExpression" && node.operator === "-") {
		const value = literal(node.argument);
		if (typeof value === "number") return -value;
	}
	return undefined;
}
function inputKind(
	type: ESTree.TSType
): Pick<InspectionParameter, "kind" | "choices"> {
	if (type.type === "TSParenthesizedType")
		return inputKind(type.typeAnnotation);
	if (type.type === "TSStringKeyword") return { kind: "string" };
	if (type.type === "TSNumberKeyword") return { kind: "number" };
	if (type.type === "TSBooleanKeyword") return { kind: "boolean" };
	const members = type.type === "TSUnionType" ? type.types : [type];
	if (members.length <= MAX_CHOICES) {
		const choices = members.map((member) =>
			member.type === "TSNullKeyword"
				? null
				: member.type === "TSLiteralType"
					? literal(member.literal)
					: undefined
		);
		if (choices.every((value) => value !== undefined))
			return {
				kind: "enum",
				choices: choices as (string | number | boolean | null)[],
			};
	}
	if (["TSArrayType", "TSTupleType", "TSTypeLiteral"].includes(type.type))
		return { kind: "json" };
	// Imported aliases, generics, unions and intersections need a checker to resolve.
	return { kind: "unknown" };
}
function inferredDefault(node: ESTree.Expression): {
	type: string;
	kind: InspectionParameter["kind"];
} {
	const value = node.type === "Literal" ? node.value : literal(node);
	if (value !== undefined && value !== null) {
		if (typeof value === "string") return { type: "string", kind: "string" };
		if (typeof value === "number") return { type: "number", kind: "number" };
		if (typeof value === "boolean") return { type: "boolean", kind: "boolean" };
	}
	if (node.type === "ArrayExpression") return { type: "array", kind: "json" };
	if (node.type === "ObjectExpression") return { type: "object", kind: "json" };
	return { type: "unknown", kind: "unknown" };
}
function parameter(
	source: string,
	node: ESTree.ParamPattern,
	index: number,
	contextual?: ESTree.ParamPattern
): InspectionParameter | undefined {
	if (node.type === "TSParameterProperty") node = node.parameter;
	if (contextual?.type === "TSParameterProperty")
		contextual = contextual.parameter;
	const rest = node.type === "RestElement";
	const binding =
		node.type === "AssignmentPattern"
			? node.left
			: node.type === "RestElement"
				? node.argument
				: node;
	if (binding.type === "Identifier" && binding.name === "this")
		return undefined;
	const contextualType = contextual?.typeAnnotation;
	const annotation = (
		node.typeAnnotation ??
		binding.typeAnnotation ??
		contextualType
	)?.typeAnnotation;
	const fallback =
		node.type === "AssignmentPattern"
			? inferredDefault(node.right)
			: { type: "unknown", kind: "unknown" as const };
	return {
		name:
			binding.type === "Identifier"
				? binding.name.slice(0, 128)
				: `argument${index + 1}`,
		...(annotation
			? { type: label(source, annotation), ...inputKind(annotation) }
			: fallback),
		...(node.optional ||
		binding.optional ||
		contextual?.optional ||
		node.type === "AssignmentPattern"
			? { optional: true }
			: {}),
		...(rest ? { rest: true } : {}),
		// Never copy/evaluate any default expression, even an innocent-looking string.
		...(node.type === "AssignmentPattern"
			? { defaultValue: "[withheld]" }
			: {}),
	};
}
function signature(
	source: string,
	name: string,
	fn: ESTree.Function | ESTree.ArrowFunctionExpression,
	contextual?: ESTree.TSFunctionType
): InspectionMethod | undefined {
	if (fn.params.length > MAX_INSPECTION_PARAMETERS) return undefined;
	const parameters = fn.params
		.map((node, index) =>
			parameter(source, node, index, contextual?.params[index])
		)
		.filter((item): item is InspectionParameter => !!item);
	const returnType =
		fn.returnType?.typeAnnotation ?? contextual?.returnType.typeAnnotation;
	const result = {
		name,
		parameters,
		...(returnType ? { returnType: label(source, returnType) } : {}),
	};
	return new TextEncoder().encode(JSON.stringify(result)).byteLength <=
		MAX_INSPECTION_SIGNATURE_BYTES
		? result
		: undefined;
}

function propertyName(key: ESTree.Node): string | undefined {
	return key.type === "Identifier"
		? key.name
		: key.type === "Literal" &&
			  (typeof key.value === "string" || typeof key.value === "number")
			? String(key.value)
			: undefined;
}
function publicName(name: string | undefined): name is string {
	return (
		!!name && name.length <= 128 && !secret.test(name) && !blocked.has(name)
	);
}
function objectContext(parent?: ESTree.Node): ESTree.TSTypeLiteral | undefined {
	const annotation =
		parent?.type === "VariableDeclarator"
			? parent.id.typeAnnotation?.typeAnnotation
			: parent?.type === "TSAsExpression" ||
				  parent?.type === "TSSatisfiesExpression"
				? parent.typeAnnotation
				: parent?.type === "PropertyDefinition"
					? parent.typeAnnotation?.typeAnnotation
					: undefined;
	return annotation?.type === "TSTypeLiteral" ? annotation : undefined;
}

/** Node-only TS/TSX pre-transform. Does not type-check, evaluate defaults, or invoke application methods. */
export function transformInspectionSignatures(
	source: string,
	id: string
): { code: string; map: null } | undefined {
	if (
		source.length > MAX_SOURCE_LENGTH ||
		!/\.(?:[cm]?ts|tsx)$/.test(id) ||
		/\.d\.[cm]?ts$/.test(id)
	)
		return undefined;
	const parsed = parseSync(id, source);
	if (parsed.errors.length) return undefined; // Let Vite report the original syntax error.
	const inserts: { at: number; text: string }[] = [];
	let metadataBytes = 0;
	function metadata(meta: InspectionMethod | undefined): string | undefined {
		if (!meta) return undefined;
		const json = JSON.stringify(meta).replace(/</g, "\\u003c");
		const bytes = new TextEncoder().encode(json).byteLength;
		if (metadataBytes + bytes > MAX_MODULE_METADATA) return undefined;
		metadataBytes += bytes;
		return json;
	}
	function tagFunction(fn: ESTree.Node, name: string, json: string): void {
		// Preserve the original function object and normal inferred name/arity.
		inserts.push({
			at: fn.start,
			text: `${object}.defineProperty({[${JSON.stringify(name)}]:(`,
		});
		inserts.push({
			at: fn.end,
			text: `)}[${JSON.stringify(name)}],${symbol},{value:${json},configurable:true})`,
		});
	}
	function visit(node: ESTree.Node, parent?: ESTree.Node): void {
		if (node.type === "ObjectExpression") {
			// A method must still be the final data property. Later spreads/computed
			// keys are unknowable without evaluation; duplicates/getters can replace it.
			const safeMethods = new Set<ESTree.Node>();
			const laterNames = new Set<string>();
			let uncertainTail = false;
			for (let i = node.properties.length - 1; i >= 0; i--) {
				const property = node.properties[i];
				if (property.type === "SpreadElement" || property.computed) {
					uncertainTail = true;
					continue;
				}
				const name = propertyName(property.key);
				if (name !== undefined) {
					if (!uncertainTail && !laterNames.has(name))
						safeMethods.add(property);
					laterNames.add(name);
				}
			}
			const contextual = objectContext(parent);
			const entries: string[] = [];
			let count = 0;
			for (const property of node.properties) {
				if (
					property.type !== "Property" ||
					property.computed ||
					property.kind !== "init" ||
					count >= 64
				)
					continue;
				const name = propertyName(property.key);
				const fn = property.value;
				if (
					!publicName(name) ||
					(fn.type !== "ArrowFunctionExpression" &&
						fn.type !== "FunctionExpression") ||
					(property.method && !safeMethods.has(property))
				)
					continue;
				const contextualMember = contextual?.members.find(
					(member) =>
						member.type === "TSPropertySignature" &&
						!member.computed &&
						propertyName(member.key) === name
				);
				const contextualType =
					contextualMember?.type === "TSPropertySignature"
						? contextualMember.typeAnnotation?.typeAnnotation
						: undefined;
				const json = metadata(
					signature(
						source,
						name,
						fn,
						contextualType?.type === "TSFunctionType"
							? contextualType
							: undefined
					)
				);
				if (!json) continue;
				count++;
				if (property.method) {
					// Read descriptors, not values: never call an application getter.
					entries.push(
						`{const f=${object}.getOwnPropertyDescriptor(o,${JSON.stringify(name)})?.value;if(typeof f==="function")${object}.defineProperty(f,${symbol},{value:${json},configurable:true});}`
					);
				} else tagFunction(fn, name, json);
			}
			if (entries.length) {
				// Evaluate the untouched literal as an argument. Method [[HomeObject]],
				// lexical this/super and the object's identity/prototype all stay intact.
				inserts.push({
					at: node.start,
					text: `((o)=>{try{${entries.join("")}}catch{}return o;})(`,
				});
				inserts.push({ at: node.end, text: ")" });
			}
		}
		if (
			(node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
			!node.declare
		) {
			const entries: string[] = [];
			let count = 0;
			for (const member of node.body.body) {
				if (
					(member.type !== "MethodDefinition" &&
						member.type !== "PropertyDefinition") ||
					member.static ||
					member.computed ||
					member.accessibility === "private" ||
					member.accessibility === "protected" ||
					member.decorators.length
				)
					continue;
				const key = member.key;
				const name =
					key.type === "Identifier"
						? key.name
						: key.type === "Literal" && typeof key.value === "string"
							? key.value
							: undefined;
				if (
					!name ||
					name.length > 128 ||
					secret.test(name) ||
					blocked.has(name) ||
					count >= 64
				)
					continue;
				const fn = member.value;
				if (
					!fn ||
					(member.type === "MethodDefinition"
						? member.kind !== "method" ||
							fn.type !== "FunctionExpression" ||
							!fn.body
						: fn.type !== "ArrowFunctionExpression")
				)
					continue;
				const contextual =
					member.type === "PropertyDefinition" &&
					member.typeAnnotation?.typeAnnotation.type === "TSFunctionType"
						? member.typeAnnotation.typeAnnotation
						: undefined;
				// Use only the implementation signature for overloads, never pick an arbitrary overload.
				const meta = signature(
					source,
					name,
					fn as ESTree.Function | ESTree.ArrowFunctionExpression,
					contextual
				);
				const json = metadata(meta);
				if (!json) continue;
				count++;
				if (member.type === "PropertyDefinition") {
					tagFunction(fn, name, json);
				} else {
					entries.push(
						`{...${json},method:${object}.getOwnPropertyDescriptor(this.prototype,${JSON.stringify(name)})?.value}`
					);
				}
			}
			// Keep every original line in place; only insertion-site columns shift.
			// The leading semicolon also handles a final field without a terminator.
			if (entries.length)
				inserts.push({
					at: node.body.end - 1,
					text: `;static {try {${object}.defineProperty(this.prototype,${symbol},{value:[${entries.join(",")}],configurable:true});} catch { /* inspection unavailable on sealed prototypes */ }}`,
				});
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === "parent") continue;
			if (Array.isArray(value)) {
				for (const child of value)
					if (child && typeof child === "object" && "type" in child)
						visit(child as ESTree.Node, node);
			} else if (value && typeof value === "object" && "type" in value)
				visit(value as ESTree.Node, node);
		}
	}
	visit(parsed.program);
	if (!inserts.length) return undefined;
	let code = source;
	for (const insert of inserts.sort((a, b) => b.at - a.at))
		code = code.slice(0, insert.at) + insert.text + code.slice(insert.at);
	return { code, map: null };
}
