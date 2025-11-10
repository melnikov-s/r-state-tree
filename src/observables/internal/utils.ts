import type { AtomNode, ComputedNode, SignalNode } from "../preact";
import {
	ObservableCfgTypes,
	ModelCfgTypes,
	CommonCfgTypes,
	StoreCfgTypes,
} from "../../types";

export function defaultEquals<T>(a: T, b: T): boolean {
	return a === b || (a !== a && b !== b);
}

export function isNonPrimitive(val: unknown): val is object {
	return val != null && (typeof val === "object" || typeof val === "function");
}

export function isPropertyKey(val: unknown): val is string | number | symbol {
	return (
		typeof val === "string" ||
		typeof val === "number" ||
		typeof val === "symbol"
	);
}

export type PropertyType = "action" | "computed" | "observable";

export function getPropertyType(
	key: PropertyKey,
	obj: object
): PropertyType | null {
	// Check if this is a class instance with metadata (not a plain object)
	const hasMetadata = (obj.constructor as any)[Symbol.metadata] !== undefined;

	// Get property descriptor
	const descriptor = getPropertyDescriptor(obj, key);

	// Methods are always actions (batched)
	if (descriptor?.value && typeof descriptor.value === "function") {
		return "action";
	}

	// Check if it's a getter/setter
	const isGetter =
		descriptor &&
		(typeof descriptor.get === "function" ||
			typeof descriptor.set === "function");

	// For plain objects (no metadata), use implicit behavior
	if (!hasMetadata) {
		if (isGetter) {
			return "computed";
		}
		return "observable";
	}

	// For class instances, check decorator metadata
	const metadata = (obj.constructor as any)[Symbol.metadata];
	if (metadata && metadata[key]) {
		const config = metadata[key];

		switch (config.type) {
			case ObservableCfgTypes.computed:
				return "computed";
			case ModelCfgTypes.state:
			case ObservableCfgTypes.observable:
			case ModelCfgTypes.id:
			case ModelCfgTypes.modelRef:
			case CommonCfgTypes.child:
			case StoreCfgTypes.model:
				return "observable";
		}
	}

	return null;
}

export function getPropertyDescriptor(
	obj: object,
	key: PropertyKey
): PropertyDescriptor | undefined {
	let node = obj;
	while (node) {
		const desc = Object.getOwnPropertyDescriptor(node, key);
		if (desc) {
			return desc;
		}

		node = Object.getPrototypeOf(node);
	}

	return undefined;
}

export function isPlainObject(value: unknown): value is object {
	if (value === null || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

export function resolveNode(
	node: SignalNode<unknown> | AtomNode | ComputedNode<unknown>
): unknown {
	return node.node ?? node;
}
