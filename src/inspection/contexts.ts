/** Browser-safe, dev-inspection metadata only. Core Context objects need no hooks. */
export const INSPECTION_CONTEXT_KEY = "r-state-tree.inspection.context.v1";
export const INSPECTION_CONTEXTS_KEY = "r-state-tree.inspection.contexts.v1";
export const INSPECTION_CONTEXT = Symbol.for(INSPECTION_CONTEXT_KEY);
export const INSPECTION_CONTEXTS = Symbol.for(INSPECTION_CONTEXTS_KEY);
export const MAX_INSPECTION_CONTEXTS = 64;
export type InspectionContext = {
	contextId: string;
	name: string;
	type?: string;
	status: "provided" | "inherited" | "default" | "unavailable" | "redacted";
	providerId?: string;
	providerClass?: string;
	/** Source declaration, not a trace of actual consumption. */
	declared?: boolean;
};
export const contextData = (value: unknown, key: PropertyKey): unknown =>
	value && (typeof value === "object" || typeof value === "function")
		? Object.getOwnPropertyDescriptor(value, key)?.value
		: undefined;
export function contextDescriptor(source: object, key: PropertyKey) {
	let current: object | null = source;
	for (
		let i = 0;
		current && i < 17;
		i++, current = Object.getPrototypeOf(current)
	) {
		const descriptor = Object.getOwnPropertyDescriptor(current, key);
		if (descriptor) return descriptor;
	}
	return undefined;
}
export function contextMetadata(context: object, fallbackName?: string) {
	const meta = contextData(context, INSPECTION_CONTEXT);
	const name = contextData(meta, "name");
	const type = contextData(meta, "type");
	const hasDefault = contextData(meta, "hasDefault");
	return {
		name:
			typeof name === "string" && name
				? name.slice(0, 128)
				: fallbackName?.slice(0, 128) || "Context (unlabeled)",
		...(typeof type === "string" ? { type: type.slice(0, 256) } : {}),
		hasDefault: typeof hasDefault === "boolean" ? hasDefault : undefined,
	};
}
/** Only data descriptors: no provider, consume, getter, or defaultValue is read. */
export function declaredContexts(
	source: object
): { context: object; provided: boolean; name?: string }[] {
	const result: { context: object; provided: boolean; name?: string }[] = [];
	let current: object | null = source;
	for (
		let depth = 0;
		current && depth < 17;
		depth++, current = Object.getPrototypeOf(current)
	) {
		const table = contextData(current, INSPECTION_CONTEXTS);
		if (!Array.isArray(table)) continue;
		for (let i = 0; i < Math.min(table.length, MAX_INSPECTION_CONTEXTS); i++) {
			const entry = contextData(table, i);
			const context = contextData(entry, "context");
			if (!context || typeof context !== "object") continue;
			const kind = contextData(entry, "kind");
			if (kind !== "provide" && kind !== "consume") continue;
			if (contextData(entry, "construction") !== true) {
				const key = contextData(entry, "key");
				const slot = contextData(entry, "slot");
				const method = contextData(entry, "method");
				if (
					(typeof key !== "string" && typeof key !== "symbol") ||
					(slot !== "value" && slot !== "get" && slot !== "set") ||
					typeof method !== "function" ||
					contextDescriptor(source, key)?.[slot] !== method
				)
					continue;
			}
			const name = contextData(entry, "name");
			result.push({
				context,
				provided: kind === "provide",
				...(typeof name === "string" ? { name: name.slice(0, 128) } : {}),
			});
			if (result.length >= MAX_INSPECTION_CONTEXTS) return result;
		}
	}
	return result;
}
/** Captured provider identity must match the *effective* symbol descriptor. */
export function knownContextProvider(source: object, context: object): boolean {
	return declaredContexts(source).some(
		(entry) => entry.provided && entry.context === context
	);
}
