import { isPlainObject } from "./observables/internal/utils";
import { observable } from "./observables/preact";

/**
 * Performs a one-time recursive pass over a JSON-like structure (plain objects
 * and arrays), wrapping each nested plain object/array with `observable()`.
 *
 * Unlike `observable()` which only wraps the top-level container, this function
 * wraps all existing nested plain objects and arrays upfront. After the initial
 * wrap, the returned observables behave exactly like normal shallow observables —
 * new assignments are NOT auto-wrapped.
 *
 * **Note:** This is NOT MobX-style "deep" observable behavior. It's simply a
 * convenience for wrapping an existing structure in one pass.
 *
 * **Requirements:**
 * - Input must be JSON-like and acyclic (no circular references).
 * - Only plain objects and arrays are wrapped; other types (Map, Set, Date,
 *   class instances, etc.) are left as-is and not traversed.
 *
 * **Guarantees:**
 * - Every initially-nested plain object/array is reachable through proxies on read.
 * - Per-container ownership is preserved (no cross-talk).
 * - `source(result)` is proxy-free and safe to `structuredClone`.
 * - New assignments after the initial wrap are NOT auto-wrapped (normal shallow behavior).
 *
 * @param value - A JSON-like value (plain object, array, or primitive).
 * @returns The value with all nested plain objects/arrays wrapped as observables.
 * @throws Error if circular references are detected.
 *
 * @example
 * ```ts
 * import { toObservableTree, effect, source, isObservable } from "r-state-tree";
 *
 * const tree = toObservableTree({
 *   user: { name: "Alice", tags: ["admin", "active"] },
 *   settings: { theme: "dark" }
 * });
 *
 * effect(() => {
 *   console.log(tree.user.name); // tracked
 *   console.log(tree.user.tags[0]); // tracked
 * });
 *
 * tree.user.name = "Bob"; // triggers effect
 * tree.user.tags[0] = "superadmin"; // triggers effect
 *
 * // New assignments are NOT auto-wrapped (normal shallow behavior)
 * tree.newProp = { foo: 1 };
 * isObservable(tree.newProp); // false
 *
 * // Source is proxy-free and clonable
 * const snapshot = structuredClone(source(tree));
 * ```
 */
export function toObservableTree<T>(value: T): T {
	return toObservableTreeInternal(value, new Set(), "");
}

/**
 * Builds the path string for error messages.
 * - Object keys use dot notation: `a.b.c`
 * - Array indices use bracket notation: `items[0]`
 */
function buildPath(currentPath: string, key: string | number): string {
	if (typeof key === "number") {
		return `${currentPath}[${key}]`;
	}
	return currentPath ? `${currentPath}.${key}` : key;
}

/**
 * Internal recursive implementation with cycle detection.
 * Uses a path-tracking Set to detect cycles while allowing shared references (DAG).
 * Nodes are added to the path before recursing and removed after processing.
 */
function toObservableTreeInternal<T>(
	value: T,
	ancestorPath: Set<object>,
	path: string
): T {
	// Primitives and non-objects pass through unchanged
	if (value === null || typeof value !== "object") {
		return value;
	}

	// Arrays: wrap the array first, then assign wrapped children through proxy
	if (Array.isArray(value)) {
		// Check for cycle (node already on current traversal path)
		if (ancestorPath.has(value)) {
			throw new Error(
				`r-state-tree: toObservableTree does not support circular references (cycle detected at path "${path}")`
			);
		}

		// Add to current path before recursing
		ancestorPath.add(value);

		// Collect indices that need recursive wrapping
		const toWrap: Array<{ index: number; element: unknown }> = [];
		for (let i = 0; i < value.length; i++) {
			const element = value[i];
			if (Array.isArray(element) || isPlainObject(element)) {
				toWrap.push({ index: i, element });
			}
		}

		// Wrap this array first
		const proxy = observable(value) as T & unknown[];

		// Now assign wrapped children through the proxy
		// This ensures proper explicitObservables tracking
		for (const { index, element } of toWrap) {
			proxy[index] = toObservableTreeInternal(
				element,
				ancestorPath,
				buildPath(path, index)
			);
		}

		// Remove from path after processing (allow shared references)
		ancestorPath.delete(value);

		return proxy as T;
	}

	// Plain objects: wrap the object first, then assign wrapped children through proxy
	if (isPlainObject(value)) {
		// Check for cycle (node already on current traversal path)
		if (ancestorPath.has(value)) {
			throw new Error(
				`r-state-tree: toObservableTree does not support circular references (cycle detected at path "${path}")`
			);
		}

		// Add to current path before recursing
		ancestorPath.add(value);

		// Collect keys that need recursive wrapping
		const toWrap: Array<{ key: string; propValue: unknown }> = [];
		const keys = Object.keys(value);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const propValue = (value as Record<string, unknown>)[key];
			if (Array.isArray(propValue) || isPlainObject(propValue)) {
				toWrap.push({ key, propValue });
			}
		}

		// Wrap this object first
		const proxy = observable(value) as Record<string, unknown>;

		// Now assign wrapped children through the proxy
		// This ensures proper explicitObservables tracking
		for (const { key, propValue } of toWrap) {
			proxy[key] = toObservableTreeInternal(
				propValue,
				ancestorPath,
				buildPath(path, key)
			);
		}

		// Remove from path after processing (allow shared references)
		ancestorPath.delete(value);

		return proxy as T;
	}

	// Non-plain objects (Map, Set, Date, class instances, etc.): leave as-is
	return value;
}
