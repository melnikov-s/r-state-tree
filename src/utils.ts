import { ModelConfiguration, CommonCfgTypes } from "./types";

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
		return (val.map((v) => clone(v)) as unknown) as T;
	} else if (val && typeof val === "object") {
		const keys = Object.keys(val);
		const cloned: T = {} as T;

		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			cloned[key] = clone(val[key]);
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
	const diff: Partial<T> = {};

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];

		if (o1[key] !== o2[key]) {
			if (config?.[key]?.type === CommonCfgTypes.child) {
				const childDiff = getDiff(o1[key], o2[key], getConfig);
				if (childDiff) {
					diff[key] = childDiff;
				}
			} else if (config?.[key]?.type === CommonCfgTypes.children) {
				diff[key] = o2[key].map((model: object, index: number) => {
					if (o1[key][index]) {
						return getDiff(o1[key][index], model, getConfig);
					}

					return model;
				});
			} else {
				diff[key] = o2[key];
			}
		}
	}

	return Object.keys(diff).length > 0 ? diff : null;
}
