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
