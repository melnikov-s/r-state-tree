import type { ModelConfiguration } from "./types";
import { CommonCfgTypes } from "./types";
import { Signal } from "@preact/signals-core";
import { isPlainObject } from "./observables/internal/utils";

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

export function getParentConstructor(
	Ctor: Function | undefined
): Function | undefined {
	return Ctor?.prototype && Object.getPrototypeOf(Ctor.prototype)?.constructor;
}

/**
 * Recursively clones a value for snapshotting.
 *
 * Snapshots are JSON-only:
 * - Primitives (string, number, boolean, null, undefined) pass through.
 * - Arrays are recursively cloned.
 * - Plain objects (prototype === Object.prototype or null) are recursively cloned.
 * - Dates serialize to ISO strings.
 * - Signals serialize to their current `.value` (recursively cloned).
 * - Everything else (Map, Set, WeakMap, WeakSet, class instances, RegExp, Error, etc.)
 *   is rejected with a descriptive error.
 *
 * @param val - The value to clone.
 * @param path - Internal: the current key path for error messages.
 */
export function clone<T>(val: T, path: string = ""): T {
	// Primitives pass through
	if (val === null || val === undefined) {
		return val;
	}

	if (typeof val !== "object") {
		// Snapshots are JSON-only (with Dates and Signals handled below).
		// Reject non-JSON primitives early with a descriptive error.
		// Note: `undefined` is allowed (handled above) but is not JSON-serializable.
		if (
			typeof val === "string" ||
			typeof val === "number" ||
			typeof val === "boolean"
		) {
			return val;
		}

		const atPath = path ? ` at path "${path}"` : "";

		if (typeof val === "bigint") {
			throw new Error(
				`r-state-tree: snapshots do not support bigint${atPath}. ` +
					`Snapshots are JSON-only (primitives, arrays, plain objects, Dates as ISO strings).`
			);
		}
		if (typeof val === "symbol") {
			throw new Error(
				`r-state-tree: snapshots do not support symbol${atPath}. ` +
					`Snapshots are JSON-only (primitives, arrays, plain objects, Dates as ISO strings).`
			);
		}
		if (typeof val === "function") {
			throw new Error(
				`r-state-tree: snapshots do not support function${atPath}. ` +
					`Snapshots are JSON-only (primitives, arrays, plain objects, Dates as ISO strings).`
			);
		}

		// Fallback: if we ever get here (e.g. rare host primitives), reject.
		throw new Error(
			`r-state-tree: snapshots do not support ${typeof val}${atPath}. ` +
				`Snapshots are JSON-only (primitives, arrays, plain objects, Dates as ISO strings).`
		);
	}

	// Support serializing signals by snapshotting their current values.
	// This also ensures snapshots can observe signal changes (via `.value` reads).
	if (val instanceof Signal) {
		return clone(
			(val as unknown as Signal<unknown>).value,
			path
		) as unknown as T;
	}

	// Date → ISO string
	if (val instanceof Date) {
		return val.toISOString() as unknown as T;
	}

	// Arrays are recursively cloned
	if (Array.isArray(val)) {
		return val.map((v, i) =>
			clone(v, path ? `${path}[${i}]` : `[${i}]`)
		) as unknown as T;
	}

	// Check for plain objects using existing utility
	if (!isPlainObject(val)) {
		// Non-plain object: reject with descriptive error
		const typeName = getTypeName(val);
		const atPath = path ? ` at path "${path}"` : "";
		throw new Error(
			`r-state-tree: snapshots do not support ${typeName}${atPath}. ` +
				`Snapshots are JSON-only (primitives, arrays, plain objects, Dates as ISO strings).`
		);
	}

	// Plain object: recursively clone
	const keys = Object.keys(val);
	const cloned: any = {} as any;

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const keyPath = path ? `${path}.${key}` : key;
		cloned[key] = clone((val as any)[key], keyPath);
	}

	return cloned;
}

/**
 * Returns a human-readable type name for error messages.
 */
function getTypeName(val: unknown): string {
	if (val instanceof Map) return "Map";
	if (val instanceof Set) return "Set";
	if (val instanceof WeakMap) return "WeakMap";
	if (val instanceof WeakSet) return "WeakSet";
	if (val instanceof RegExp) return "RegExp";
	if (val instanceof Error) return "Error";
	if (val instanceof Promise) return "Promise";

	// Try to get constructor name for class instances
	const proto = Object.getPrototypeOf(val);
	if (proto?.constructor?.name && proto.constructor.name !== "Object") {
		return `class instance (${proto.constructor.name})`;
	}

	return "non-plain object";
}

export function getDiff<T extends object>(
	o1: T,
	o2: T,
	getConfig: (snapshot: object) => ModelConfiguration<unknown> | undefined
): Partial<T> | null {
	const config = getConfig(o2);
	if (!config) {
		return null;
	}
	const keys = Object.keys(o1);
	const diff: any = {};

	const obj1 = o1 as any;
	const obj2 = o2 as any;

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];

		if (obj1[key] !== obj2[key]) {
			if (config?.[key]?.type === CommonCfgTypes.child) {
				const value = obj2[key];
				if (Array.isArray(value)) {
					// Array of children
					diff[key] = value.map((model: object, index: number) => {
						if (obj1[key][index]) {
							return getDiff(obj1[key][index], model, getConfig);
						}

						return model;
					});
				} else {
					// Single child
					const childDiff = getDiff(obj1[key], obj2[key], getConfig);
					if (childDiff) {
						diff[key] = childDiff;
					}
				}
			} else {
				diff[key] = obj2[key];
			}
		}
	}

	return Object.keys(diff).length > 0 ? diff : null;
}
