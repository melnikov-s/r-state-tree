import { Signal } from "@preact/signals-core";
import type { IdType, ModelConfiguration } from "./types.js";
import { CommonCfgTypes, ModelCfgTypes } from "./types.js";
import { getConfigType } from "./configuration.js";
import { isPlainObject } from "./observables/internal/utils.js";
import {
	getObservable,
	getSource,
	isObservable,
} from "./observables/internal/lookup.js";

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
 * Snapshot values:
 * - Supported primitives pass through, including undefined and non-finite numbers.
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
	if (val === null || val === undefined) {
		return val;
	}

	if (typeof val !== "object") {
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
					`Snapshots support scalar values, arrays, plain objects, and Dates as ISO strings.`
			);
		}
		if (typeof val === "symbol") {
			throw new Error(
				`r-state-tree: snapshots do not support symbol${atPath}. ` +
					`Snapshots support scalar values, arrays, plain objects, and Dates as ISO strings.`
			);
		}
		if (typeof val === "function") {
			throw new Error(
				`r-state-tree: snapshots do not support function${atPath}. ` +
					`Snapshots support scalar values, arrays, plain objects, and Dates as ISO strings.`
			);
		}

		// Fallback: if we ever get here (e.g. rare host primitives), reject.
		throw new Error(
			`r-state-tree: snapshots do not support ${typeof val}${atPath}. ` +
				`Snapshots support scalar values, arrays, plain objects, and Dates as ISO strings.`
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
				`Snapshots support scalar values, arrays, plain objects, and Dates as ISO strings.`
		);
	}

	// Plain object: recursively clone
	const keys = Object.keys(val);
	const cloned: any = {} as any;

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const keyPath = path ? `${path}.${key}` : key;
		defineOwnDataProperty(cloned, key, clone((val as any)[key], keyPath));
	}

	return cloned;
}

/**
 * Rehydrates a JSON snapshot value into the runtime shape established by a
 * field's default value. This preserves Signals, observable/plain containers,
 * and Dates while applying serialized data.
 */
export type HydrationChangeTracker = {
	changed: boolean;
	undo?: (() => void)[];
	// Model hydration borrows its input; Store passes an already-owned clone.
	copyInput?: boolean;
};

export function hydrateSnapshotValue(
	currentValue: unknown,
	snapshotValue: unknown,
	changeTracker: HydrationChangeTracker = { changed: false }
): unknown {
	const { undo } = changeTracker;
	if (currentValue instanceof Signal) {
		const previous = currentValue.value;
		const next = hydrateSnapshotValue(previous, snapshotValue, changeTracker);
		if (!Object.is(previous, next)) {
			undo?.push(() => {
				currentValue.value = previous;
			});
		}
		currentValue.value = next;
		return currentValue;
	}

	if (currentValue instanceof Date && typeof snapshotValue === "string") {
		const date = new Date(snapshotValue);
		if (Number.isNaN(date.getTime())) {
			throw new Error(
				`r-state-tree: invalid ISO date string in snapshot: ${JSON.stringify(
					snapshotValue
				)}`
			);
		}
		const previous = currentValue.getTime();
		if (previous !== date.getTime()) {
			changeTracker.changed = true;
			undo?.push(() => currentValue.setTime(previous));
			currentValue.setTime(date.getTime());
		}
		return currentValue;
	}

	if (Array.isArray(currentValue) && Array.isArray(snapshotValue)) {
		const currentItems = [...currentValue];
		const exemplar = currentItems[0];
		if (currentItems.length !== snapshotValue.length) {
			changeTracker.changed = true;
		}
		const nextItems = snapshotValue.map((item, index) => {
			const currentItem =
				index < currentItems.length
					? currentItems[index]
					: cloneHydrationTarget(exemplar);
			return hydrateSnapshotValue(currentItem, item, changeTracker);
		});
		const structureChanged =
			currentItems.length !== nextItems.length ||
			nextItems.some((item, index) => !Object.is(currentItems[index], item));
		if (structureChanged) {
			undo?.push(() => {
				currentValue.splice(0, currentValue.length, ...currentItems);
			});
			currentValue.splice(0, currentValue.length, ...nextItems);
		}
		return currentValue;
	}

	if (isPlainObject(currentValue) && isPlainObject(snapshotValue)) {
		const currentRecord = currentValue as Record<string, unknown>;
		const snapshotRecord = snapshotValue as Record<string, unknown>;

		Object.keys(snapshotRecord).forEach((key) => {
			const hasOwnKey = Object.prototype.hasOwnProperty.call(
				currentRecord,
				key
			);
			const previous = hasOwnKey ? currentRecord[key] : undefined;
			const hydratedValue = hydrateSnapshotValue(
				previous,
				snapshotRecord[key],
				changeTracker
			);
			if (hasOwnKey) {
				if (!Object.is(previous, hydratedValue)) {
					undo?.push(() => {
						currentRecord[key] = previous;
					});
				}
				currentRecord[key] = hydratedValue;
			} else {
				changeTracker.changed = true;
				defineOwnDataProperty(currentRecord, key, hydratedValue);
				undo?.push(() => {
					delete currentRecord[key];
				});
			}
		});

		Object.keys(currentRecord).forEach((key) => {
			if (!Object.prototype.hasOwnProperty.call(snapshotRecord, key)) {
				changeTracker.changed = true;
				const descriptor =
					undo && Object.getOwnPropertyDescriptor(currentRecord, key);
				delete currentRecord[key];
				if (descriptor) {
					undo.push(() =>
						Object.defineProperty(currentRecord, key, descriptor)
					);
				}
			}
		});

		return currentValue;
	}

	if (!Object.is(currentValue, snapshotValue)) {
		changeTracker.changed = true;
	}
	// Matched shapes are hydrated recursively. Copy only a branch that would
	// otherwise be inserted verbatim, such as a record replacing null.
	return changeTracker.copyInput &&
		(Array.isArray(snapshotValue) || isPlainObject(snapshotValue))
		? cloneHydrationTarget(snapshotValue)
		: snapshotValue;
}

function cloneHydrationTarget(value: unknown): unknown {
	if (value instanceof Signal) {
		return new Signal(cloneHydrationTarget(value.value));
	}

	const shouldRemainObservable = isObservable(value);
	const sourceValue = shouldRemainObservable ? getSource(value) : value;
	let clonedValue: unknown;

	if (sourceValue instanceof Date) {
		clonedValue = new Date(sourceValue.getTime());
	} else if (Array.isArray(sourceValue)) {
		clonedValue = sourceValue.map(cloneHydrationTarget);
	} else if (isPlainObject(sourceValue)) {
		const clone = Object.create(Object.getPrototypeOf(sourceValue)) as Record<
			string,
			unknown
		>;
		Object.keys(sourceValue).forEach((key) => {
			defineOwnDataProperty(
				clone,
				key,
				cloneHydrationTarget((sourceValue as Record<string, unknown>)[key])
			);
		});
		clonedValue = clone;
	} else {
		return value;
	}

	return shouldRemainObservable ? getObservable(clonedValue) : clonedValue;
}

// Define dictionary entries without invoking inherited setters such as __proto__.
function defineOwnDataProperty(
	target: object,
	key: string,
	value: unknown
): void {
	Object.defineProperty(target, key, {
		value,
		writable: true,
		enumerable: true,
		configurable: true,
	});
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

type SnapshotConfigLookup = (
	snapshot: object
) => ModelConfiguration<unknown> | undefined;

type SnapshotIdentity = {
	config: ModelConfiguration<unknown>;
	key: string;
	id: IdType;
};

// Effective configurations are reused across snapshots; a new configuration
// gets its own entry. Cache misses too, without retaining individual snapshots.
const identifierKeys = new WeakMap<
	ModelConfiguration<unknown>,
	string | null
>();

function getSnapshotIdentity(
	snapshot: object,
	getConfig: SnapshotConfigLookup
): SnapshotIdentity | undefined {
	const config = getConfig(snapshot);
	if (!config) return undefined;
	let key = identifierKeys.get(config);
	if (key === undefined) {
		key =
			Object.keys(config).find(
				(key) => getConfigType(config[key]) === ModelCfgTypes.id
			) ?? null;
		identifierKeys.set(config, key);
	}
	if (key === null) return undefined;
	const id = (snapshot as Record<string, unknown>)[key];
	return typeof id === "string" || typeof id === "number"
		? { config, key, id }
		: undefined;
}

function getIdentifiedChildDiff(
	previous: object,
	next: object,
	identity: SnapshotIdentity,
	getConfig: SnapshotConfigLookup
): object {
	// Even an unchanged child needs its identifier: the containing array
	// describes membership/order, and hydration must reuse the correct Model.
	return previous === next
		? { [identity.key]: identity.id }
		: { ...getDiff(previous, next, getConfig), [identity.key]: identity.id };
}

// Ordinary collection values are cloned each time their Model is snapshotted.
// Compare those values after a reference miss, without walking cached subtrees.
function equalSnapshotValues(
	left: unknown,
	right: unknown,
	getConfig?: SnapshotConfigLookup
): boolean {
	if (Object.is(left, right)) return true;
	if (!left || !right || typeof left !== "object" || typeof right !== "object")
		return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	if (Array.isArray(left) && left.length !== (right as unknown[]).length)
		return false;
	if (getConfig && getConfig(left) !== getConfig(right)) return false;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	const lhs = left as Record<string, unknown>;
	const rhs = right as Record<string, unknown>;
	return keys.every(
		(key) =>
			Object.hasOwn(rhs, key) &&
			equalSnapshotValues(lhs[key], rhs[key], getConfig)
	);
}

const unchangedChild = Symbol();

function getChildDiff(
	previous: unknown,
	next: unknown,
	getConfig: SnapshotConfigLookup
): unknown {
	if (Array.isArray(previous) && Array.isArray(next)) {
		let previousByConfig:
			| Map<ModelConfiguration<unknown>, Map<IdType, object>>
			| undefined;
		let changed = previous.length !== next.length;
		const items = next.map((snapshot: object, index: number) => {
			const identity = getSnapshotIdentity(snapshot, getConfig);
			const positional = previous[index];
			if (!identity) {
				changed ||= !equalSnapshotValues(positional, snapshot, getConfig);
				return snapshot;
			}
			if (positional === snapshot) return { [identity.key]: identity.id };

			if (!previousByConfig) {
				// Position is only a shortcut when identity agrees. Ordinary edits
				// need no index; structural changes build one, then reuse it.
				const positionalIdentity =
					positional && getSnapshotIdentity(positional, getConfig);
				if (
					positionalIdentity?.config === identity.config &&
					Object.is(positionalIdentity.id, identity.id)
				) {
					const fields = getDiff(positional, snapshot, getConfig);
					changed ||= fields !== null;
					return { ...fields, [identity.key]: identity.id };
				}
				changed = true;
				previousByConfig = new Map();
				for (const oldSnapshot of previous) {
					const oldIdentity = getSnapshotIdentity(oldSnapshot, getConfig);
					if (!oldIdentity) continue;
					let byId = previousByConfig.get(oldIdentity.config);
					if (!byId) {
						byId = new Map();
						previousByConfig.set(oldIdentity.config, byId);
					}
					byId.set(oldIdentity.id, oldSnapshot);
				}
			}
			const match = previousByConfig.get(identity.config)?.get(identity.id);
			return match
				? getIdentifiedChildDiff(match, snapshot, identity, getConfig)
				: snapshot;
		});
		return changed ? items : unchangedChild;
	}

	if (isPlainObject(previous) && isPlainObject(next)) {
		const previousIdentity = getSnapshotIdentity(previous, getConfig);
		const identity = getSnapshotIdentity(next, getConfig);
		if (
			identity &&
			previousIdentity?.config === identity.config &&
			Object.is(previousIdentity.id, identity.id)
		) {
			const fields = getDiff(previous, next, getConfig);
			return fields
				? { ...fields, [identity.key]: identity.id }
				: unchangedChild;
		}
		if (
			!identity &&
			!previousIdentity &&
			equalSnapshotValues(previous, next, getConfig)
		)
			return unchangedChild;
	}

	// Missing/changed identity, null, or a single/array transition may require
	// creation rather than patching. Never omit persisted data in those cases.
	return next;
}

/**
 * Match children by configured identifier, never by array position. Children
 * present on both sides carry only their id and changed fields; children that
 * may need recreation carry full snapshots. Changed ordinary fields are
 * included in full, not recursively patched.
 */
export function getDiff<T extends object>(
	o1: T,
	o2: T,
	getConfig: SnapshotConfigLookup
): Partial<T> | null {
	if (o1 === o2) return null;
	const config = getConfig(o2);
	let diff: Record<string, unknown> | null = null;
	const obj1 = o1 as Record<string, unknown>;
	const obj2 = o2 as Record<string, unknown>;

	for (const key of Object.keys(obj2)) {
		const previous = obj1[key];
		const next = obj2[key];
		if (Object.is(previous, next)) continue;
		if (getConfigType(config?.[key]) === CommonCfgTypes.child) {
			const childDiff = getChildDiff(previous, next, getConfig);
			if (childDiff !== unchangedChild)
				defineOwnDataProperty((diff ??= {}), key, childDiff);
		} else if (!equalSnapshotValues(previous, next)) {
			defineOwnDataProperty((diff ??= {}), key, next);
		}
	}

	return diff as Partial<T> | null;
}
