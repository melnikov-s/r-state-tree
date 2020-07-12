import { Computed, computed } from "lobx";
import { graphOptions } from "./lobx";

export default function <T extends object>(computedObject: Computed<T>): T {
	const initial = {};
	Object.keys(computedObject.get()).forEach((k) => (initial[k] = undefined));

	const proxy = new Proxy(initial as T, {
		get(target: T, key: PropertyKey): unknown {
			if (!target[key]) {
				target[key] = computed(() => computedObject.get()[key], graphOptions);
			}

			return target[key].get();
		},
	});

	return proxy;
}
