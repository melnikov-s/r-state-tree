import type { ModelConfiguration } from "./types";
import { CommonCfgTypes } from "./types";

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

export function clone<T>(val: T): T {
	if (Array.isArray(val)) {
		return val.map((v) => clone(v)) as unknown as T;
	} else if (val && typeof val === "object") {
		const keys = Object.keys(val);
		const cloned: any = {} as any;

		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			cloned[key] = clone((val as any)[key]);
		}

		return cloned;
	}

	return val;
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
