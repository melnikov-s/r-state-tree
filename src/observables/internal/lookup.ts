import { CollectionAdministration } from "../collection";
import { PreactObjectAdministration } from "../preact";
import { ArrayAdministration } from "../array";
import { DateAdministration } from "../date";
import type { Administration } from "./Administration";
import { batch } from "@preact/signals-core";
import { isPlainObject } from "./utils";

const administrationMap: WeakMap<object, Administration> = new WeakMap();

export function getAdministration<T extends object>(
	obj: T
): T extends Set<infer S>
	? CollectionAdministration<S>
	: T extends Map<infer K, infer V>
	? CollectionAdministration<K, V>
	: T extends Array<infer R>
	? ArrayAdministration<R>
	: T extends Date
	? DateAdministration
	: PreactObjectAdministration<any> {
	return administrationMap.get(obj as object)! as ReturnType<
		typeof getAdministration
	>;
}

const actionsMap: WeakMap<Function, Function> = new WeakMap();

export function getSource<T>(obj: T): T {
	const adm = getAdministration(obj as object);

	return adm ? (adm.source as unknown as T) : obj;
}

export function getAction<T extends Function>(fn: T): T {
	let action = actionsMap.get(fn);

	if (!action) {
		action = function (this: unknown, ...args: unknown[]): unknown {
			if (new.target) {
				return new (fn as any)(...args);
			}

			return batch(() => fn.apply(this, args));
		};

		actionsMap.set(fn, action);
	}

	return action as T;
}

export function getObservableClassInstance<T extends object>(value: T): T {
	const adm = new PreactObjectAdministration(value);
	administrationMap.set(adm.proxy, adm);
	administrationMap.set(adm.source, adm);
	return adm.proxy as unknown as T;
}

export class Observable {
	constructor() {
		return getObservableClassInstance(this);
	}
}

export function getObservableIfExists<T>(value: T): T | undefined {
	const adm = getAdministration(value as object);
	if (adm) {
		return adm.proxy;
	}

	return undefined;
}

export function createObservableWithCustomAdministration<T>(
	value: T,
	Adm: new (obj: any) => Administration
): T {
	const adm = new Adm(value);
	administrationMap.set(adm.proxy, adm);
	administrationMap.set(adm.source, adm);
	return adm.proxy as unknown as T;
}

/**
 * Wraps a value as an observable container.
 * All objects are wrapped as observable proxies for explicit reactivity.
 */
export function getObservable<T>(value: T): T {
	if (!value) {
		return value;
	}

	// Already has an administration - return the existing proxy
	const existingAdm = getAdministration(value);
	if (existingAdm) {
		return existingAdm.proxy as unknown as T;
	}

	// Functions are NOT observable containers.
	// They are still batched when read as actions from observable objects, but observable(fn) is not supported.
	if (typeof value === "function") {
		if (process.env.NODE_ENV !== "production") {
			console.warn(
				`r-state-tree: functions are not observable containers. ` +
					`The function will be returned unchanged. ` +
					`Note: functions read from observable objects are still automatically batched as actions.`
			);
		}
		return value;
	}

	if (typeof value === "object") {
		const obj = value as unknown as object;

		let Adm: (new (obj: any) => Administration) | null = null;

		// Wrap all supported types as observable proxies
		// Shallow behavior: the container is observable, but nested values are NOT wrapped when read
		//
		// Note: Map/Set/Date are wrapped even if frozen because Object.freeze only prevents
		// property additions/deletions on the object shell, but internal slots remain mutable.
		// A frozen Map can still be mutated via map.set(), etc.
		if (obj instanceof Map || obj instanceof WeakMap) {
			Adm = CollectionAdministration;
		} else if (obj instanceof Set || obj instanceof WeakSet) {
			Adm = CollectionAdministration;
		} else if (obj instanceof Date) {
			Adm = DateAdministration;
		} else if (!Object.isFrozen(obj)) {
			// Plain objects and arrays are only wrapped if not frozen
			if (Array.isArray(obj)) {
				Adm = ArrayAdministration;
			} else if (isPlainObject(obj)) {
				// Plain objects get observable proxies
				Adm = PreactObjectAdministration;
			}
		}

		if (Adm) {
			const adm = new Adm(obj);
			administrationMap.set(adm.proxy, adm);
			administrationMap.set(adm.source, adm);
			return adm.proxy as unknown as T;
		}

		// Non-plain objects (class instances, built-ins like URL/RegExp) are NOT wrapped.
		// This avoids issues with #private fields and internal slots/brand checks.
		if (process.env.NODE_ENV !== "production" && !Object.isFrozen(obj)) {
			const proto = Object.getPrototypeOf(obj);
			const typeName =
				proto?.constructor?.name && proto.constructor.name !== "Object"
					? `instance of ${proto.constructor.name}`
					: "non-plain object";

			console.warn(
				`r-state-tree: observable() was called with a ${typeName}. ` +
					`This object will NOT be made observable because proxying arbitrary class instances ` +
					`can break #private fields and built-in brand checks. ` +
					`To make a class observable, use 'class MyClass extends Observable'.`
			);
		}
	}

	// For other types (primitives, frozen objects, etc.), return raw value
	return value;
}

export function isObservable(obj: unknown): boolean {
	if (!obj || typeof obj !== "object") return false;

	const adm = getAdministration(obj);
	return !!(adm && adm.proxy === obj);
}

export function getInternalNode(obj: object, key?: PropertyKey): any {
	const adm = getAdministration(obj);

	if (!adm) {
		throw new Error(
			"`getInternalNode` expected an observable object. Received: " + typeof obj
		);
	}

	return adm.getNode(key);
}
