/** Browser-safe, inspection-only contract. Never imported by the core runtime. */
export type InspectionParameter = {
	name: string;
	type: string;
	kind: "string" | "number" | "boolean" | "enum" | "json" | "unknown";
	optional?: boolean;
	rest?: boolean;
	/** Presence indicates a default; its source/value is deliberately withheld. */
	defaultValue?: string;
	choices?: (string | number | boolean | null)[];
};
export type InspectionMethod = {
	name: string;
	parameters?: InspectionParameter[];
	returnType?: string;
};
export const INSPECTION_SIGNATURES_KEY =
	"r-state-tree.inspection.signatures.v1";
export const INSPECTION_SIGNATURES = Symbol.for(INSPECTION_SIGNATURES_KEY);
export const MAX_INSPECTION_PARAMETERS = 32;
export const MAX_INSPECTION_SIGNATURE_BYTES = 8192;

const data = (value: unknown, key: PropertyKey): unknown =>
	value && (typeof value === "object" || typeof value === "function")
		? Object.getOwnPropertyDescriptor(value, key)?.value
		: undefined;
const kinds = new Set([
	"string",
	"number",
	"boolean",
	"enum",
	"json",
	"unknown",
]);
/** Copy only bounded data descriptors, even if an application replaces metadata. */
function copySignature(
	value: unknown,
	name: string,
	allowAlias = false
): InspectionMethod | undefined {
	const originalName = data(value, "name");
	if (
		typeof originalName !== "string" ||
		!originalName ||
		originalName.length > 128 ||
		(!allowAlias && originalName !== name)
	)
		return undefined;
	const result: InspectionMethod = { name };
	const returnType = data(value, "returnType");
	if (typeof returnType === "string")
		result.returnType = returnType.slice(0, 256);
	const parameters = data(value, "parameters");
	if (parameters !== undefined) {
		if (
			!Array.isArray(parameters) ||
			parameters.length > MAX_INSPECTION_PARAMETERS
		)
			return undefined;
		result.parameters = [];
		for (let i = 0; i < parameters.length; i++) {
			const parameter = data(parameters, i);
			const parameterName = data(parameter, "name");
			const type = data(parameter, "type");
			const kind = data(parameter, "kind");
			if (
				typeof parameterName !== "string" ||
				typeof type !== "string" ||
				typeof kind !== "string" ||
				!kinds.has(kind)
			)
				return undefined;
			const copied: InspectionParameter = {
				name: parameterName.slice(0, 128),
				type: type.slice(0, 256),
				kind: kind as InspectionParameter["kind"],
			};
			if (data(parameter, "optional") === true) copied.optional = true;
			if (data(parameter, "rest") === true) copied.rest = true;
			if (typeof data(parameter, "defaultValue") === "string")
				copied.defaultValue = "[withheld]";
			const choices = data(parameter, "choices");
			if (choices !== undefined) {
				if (!Array.isArray(choices) || choices.length > 16) return undefined;
				copied.choices = [];
				for (let j = 0; j < choices.length; j++) {
					const choice = data(choices, j);
					if (
						choice === null ||
						typeof choice === "boolean" ||
						(typeof choice === "number" && Number.isFinite(choice)) ||
						(typeof choice === "string" && choice.length <= 128)
					)
						copied.choices.push(choice);
					else return undefined;
				}
			}
			result.parameters.push(copied);
		}
	}
	return new TextEncoder().encode(JSON.stringify(result)).byteLength <=
		MAX_INSPECTION_SIGNATURE_BYTES
		? result
		: undefined;
}
/**
 * Generated prototype entries capture the actual method, not just its name.
 * Fresh callback/arrow properties carry metadata on their own function object, so inheritance,
 * shadowing and runtime replacement cannot borrow a stale signature.
 * Only data descriptors are read; no application getter/method is invoked.
 */
export function lookupInspectionMethod(
	source: object,
	name: string,
	method: unknown
): InspectionMethod | undefined {
	if (
		typeof method !== "function" ||
		!name ||
		name.length > 128 ||
		/password|secret|token|authorization|cookie|credential/i.test(name) ||
		["constructor", "prototype", "__proto__"].includes(name)
	)
		return undefined;
	// Function identity is the link: copying a callback under another prop name
	// must not discard its sanitized parameters or expose its old property name.
	const own = copySignature(data(method, INSPECTION_SIGNATURES), name, true);
	if (own) return own;
	let current: object | null = source;
	for (let depth = 0; current && depth < 17; depth++) {
		const table = data(current, INSPECTION_SIGNATURES);
		if (Array.isArray(table)) {
			for (let i = 0; i < Math.min(table.length, 64); i++) {
				const entry = data(table, i);
				if (data(entry, "name") === name && data(entry, "method") === method)
					return copySignature(entry, name);
			}
		}
		// A shadowing descriptor without matching metadata must not inherit it.
		if (Object.getOwnPropertyDescriptor(current, name)) return undefined;
		current = Object.getPrototypeOf(current);
	}
	return undefined;
}
