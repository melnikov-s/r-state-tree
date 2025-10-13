import { CollectionAdministration } from "../collection";
import { PreactObjectAdministration } from "../preact";
import { ArrayAdministration } from "../array";
import { DateAdministration } from "../date";
import { Administration } from "./Administration";
import { isPlainObject } from "./utils";
import { batch } from "@preact/signals-core";

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
	administrationMap.set(adm.source, adm);
	return adm.proxy as unknown as T;
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

export function getObservable<T>(value: T): T {
	if (!value) {
		return value;
	}

	const adm = getAdministration(value);

	if (adm) {
		return adm.proxy as unknown as T;
	}

	if (
		(typeof value === "object" || typeof value === "function") &&
		!Object.isFrozen(value)
	) {
		const obj = value as unknown as object;

		let Adm: new (obj: any) => Administration = PreactObjectAdministration;

		if (Array.isArray(obj)) {
			Adm = ArrayAdministration;
		} else if (obj instanceof Map || obj instanceof WeakMap) {
			Adm = CollectionAdministration;
		} else if (obj instanceof Set || obj instanceof WeakSet) {
			Adm = CollectionAdministration;
		} else if (obj instanceof Date) {
			Adm = DateAdministration;
		} else if (!isPlainObject(value)) {
			return value;
		}

		const adm = new Adm(obj);
		administrationMap.set(adm.proxy, adm);
		administrationMap.set(adm.source, adm);
		return adm.proxy as unknown as T;
	}

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
