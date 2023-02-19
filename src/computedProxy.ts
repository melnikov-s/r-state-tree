import { graph, ComputedNode } from "./graph";

export default function <T extends object>(computed: ComputedNode<T>): T {
	const initial = {};
	Object.keys(computed.get()).forEach((k) => (initial[k] = undefined));

	const proxy = new Proxy(initial as T, {
		get(target: T, key: PropertyKey): unknown {
			if (!target[key]) {
				target[key] = graph.createComputed(() => computed.get()[key], null);
			}

			return target[key].get();
		},
	});

	return proxy;
}
