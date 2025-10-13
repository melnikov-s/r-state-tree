import { AtomNode, ComputedNode, SignalNode } from "../preact";

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

export function getPropertyType(key: PropertyKey, obj: object): PropertyType {
	const descriptor = getPropertyDescriptor(obj, key);
	if (descriptor) {
		if (
			typeof descriptor.get === "function" ||
			typeof descriptor.set === "function"
		) {
			return "computed";
		} else if (typeof descriptor.value === "function") {
			return "action";
		}
	}

	return "observable";
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
