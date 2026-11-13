/** Shared browser/UI/relay protocol. Paths and method names are literal, never expressions. */
export type ControlValue =
	| null
	| boolean
	| number
	| string
	| ControlValue[]
	| { [key: string]: ControlValue };
export const isBlockedKey = (key: string) =>
	["__proto__", "prototype", "constructor"].includes(key);

/** Bound JSON inputs before application code runs. Never invoke accessors or toJSON. */
export function validateControlValue(
	value: unknown
): asserts value is ControlValue {
	let entries = 0;
	const seen = new Set<object>();
	const visit = (item: unknown, depth: number): void => {
		if (++entries > 1000 || depth > 16)
			throw new Error("Control input too large");
		if (typeof item === "string" && item.length > 65536)
			throw new Error("Control input exceeds 64 KiB");
		if (item === null || typeof item === "boolean" || typeof item === "string")
			return;
		if (typeof item === "number" && Number.isFinite(item)) return;
		if (typeof item !== "object" || item === null)
			throw new Error("Expected JSON input");
		if (
			Array.isArray(item) &&
			(item.length > 1000 ||
				Reflect.ownKeys(item).some(
					(key) =>
						typeof key !== "string" ||
						(key !== "length" &&
							(!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length))
				))
		)
			throw new Error("Expected bounded JSON array");
		const proto = Object.getPrototypeOf(item);
		if (
			seen.has(item) ||
			(proto !== Object.prototype &&
				proto !== null &&
				!(Array.isArray(item) && proto === Array.prototype))
		)
			throw new Error("Expected plain JSON input");
		seen.add(item);
		for (const key of Reflect.ownKeys(item)) {
			if (Array.isArray(item) && key === "length") continue;
			if (typeof key !== "string" || isBlockedKey(key))
				throw new Error("Invalid input key");
			const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
			if (!("value" in descriptor) || !descriptor.enumerable)
				throw new Error("Expected JSON data properties");
			visit(descriptor.value, depth + 1);
		}
		seen.delete(item);
	};
	visit(value, 0);
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 65536)
		throw new Error("Control input exceeds 64 KiB");
}

export type InspectionRequest =
	| { op: "roots" }
	| { op: "operations" }
	| { op: "clearOperations" }
	| {
			op: "inspect";
			/** false gives a structure-only projection without evaluating ordinary getters. */
			evaluateComputeds?: boolean;
			rootId: string;
			path?: string[];
			depth?: number;
			maxEntries?: number;
	  }
	| {
			op: "context";
			rootId: string;
			path?: string[];
			contextId: string;
			depth?: number;
			maxEntries?: number;
	  }
	| {
			op: "initialize";
			rootId: string;
			path?: string[];
			field: string;
			levels?: number;
			maxInitializations?: number;
	  }
	| {
			op: "set";
			rootId: string;
			path?: string[];
			field: string;
			value: ControlValue;
	  }
	| {
			op: "call";
			rootId: string;
			path?: string[];
			method: string;
			args?: ControlValue[];
			depth?: number;
			maxEntries?: number;
	  };

const requestKeys = new Map<string, readonly string[]>([
	["roots", ["op"]],
	["operations", ["op"]],
	["clearOperations", ["op"]],
	[
		"inspect",
		["op", "rootId", "path", "depth", "maxEntries", "evaluateComputeds"],
	],
	["context", ["op", "rootId", "path", "contextId", "depth", "maxEntries"]],
	[
		"initialize",
		["op", "rootId", "path", "field", "levels", "maxInitializations"],
	],
	["set", ["op", "rootId", "path", "field", "value"]],
	["call", ["op", "rootId", "path", "method", "args", "depth", "maxEntries"]],
]);
export const CHANNEL = "r-state-tree:inspector";
export const MAX_FRAME_BYTES = 1_000_000;
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Only one result arm is accepted; malformed peers cannot masquerade as success. */
export function isInspectionResponse(
	value: unknown
): value is { value: unknown } | { error: string } {
	if (!isRecord(value) || Object.keys(value).length !== 1) return false;
	return (
		Object.prototype.hasOwnProperty.call(value, "value") ||
		(typeof value.error === "string" && value.error.length <= 500)
	);
}
export function validateRequest(
	value: unknown
): asserts value is InspectionRequest {
	if (!isRecord(value)) throw new Error("Invalid inspection request");
	const allowed =
		typeof value.op === "string" ? requestKeys.get(value.op) : undefined;
	if (!allowed || Object.keys(value).some((k) => !allowed.includes(k)))
		throw new Error("Unknown operation or argument");
	if (["roots", "operations", "clearOperations"].includes(value.op as string))
		return;
	if (
		value.op === "inspect" &&
		value.evaluateComputeds !== undefined &&
		typeof value.evaluateComputeds !== "boolean"
	)
		throw new Error("Invalid evaluateComputeds");
	if (typeof value.rootId !== "string" || value.rootId.length > 100)
		throw new Error("Invalid rootId");
	if (
		value.path !== undefined &&
		(!Array.isArray(value.path) ||
			value.path.length > 16 ||
			value.path.some(
				(p) => typeof p !== "string" || p.length > 256 || isBlockedKey(p)
			))
	)
		throw new Error("Invalid path");
	for (const [key, max] of [
		["depth", 8],
		["maxEntries", 500],
		["levels", 4],
		["maxInitializations", 50],
	] as const) {
		const n = value[key];
		if (
			n !== undefined &&
			(!Number.isInteger(n) || (n as number) < 1 || (n as number) > max)
		)
			throw new Error("Invalid " + key);
	}
	for (const key of value.op === "call"
		? ["method"]
		: value.op === "initialize" || value.op === "set"
			? ["field"]
			: []) {
		const name = value[key];
		if (typeof name !== "string" || name.length > 256 || isBlockedKey(name))
			throw new Error("Invalid " + key);
	}
	if (
		value.op === "context" &&
		(typeof value.contextId !== "string" ||
			!value.contextId.length ||
			value.contextId.length > 100)
	)
		throw new Error("Invalid contextId");
	if (value.op === "set") validateControlValue(value.value);
	if (value.op === "call") {
		if (
			value.args !== undefined &&
			(!Array.isArray(value.args) || value.args.length > 32)
		)
			throw new Error("Expected at most 32 JSON arguments");
		validateControlValue(value.args ?? []);
	}
}
