import { createComputed, ComputedNode } from "./observables";

export default function <T extends Record<PropertyKey, any>>(
	computed: ComputedNode<T>
): T {
	const initial: Record<string, unknown> = {};
	Object.keys(computed.get()).forEach((k) => (initial[k] = undefined));

	const proxy = new Proxy(initial as T, {
		get(target: T, key: PropertyKey): unknown {
			if (!target[key]) {
				(target[key] as unknown) = createComputed(
					() => computed.get()[key],
					null
				);
			}

			return target[key].get();
		},
	});

	return proxy;
}
