import {
	Props,
	Context,
	StoreConfiguration,
	Configuration,
	ReactionParams,
	ReactionReturn,
} from "../types";
import { observable } from "lobx";
import {
	StoreAdministration,
	getStoreAdm,
	updateProps,
} from "./StoreAdministration";
import { graphOptions } from "../lobx";

let initEnabled = false;
export function allowNewStore<T>(fn: () => T): T {
	initEnabled = true;
	try {
		return fn();
	} finally {
		initEnabled = false;
	}
}

export function createStore<K extends Store<T>, T extends Props>(
	Type: new (...args: unknown[]) => K,
	props?: T
): K {
	return ({
		Type,
		props: props || {},
		key: props && props.key,
	} as unknown) as K;
}

export function updateStore<K extends Store<T>, T extends Props>(
	store: K,
	props: T
): K {
	updateProps(store.props, props);

	return store;
}

export function types<T extends Store>(
	config: Partial<StoreConfiguration<T>>
): Partial<StoreConfiguration<T>> {
	return config;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default class Store<T extends Props = any, S extends Context = any> {
	static types: unknown = {};
	props: T = observable({}, graphOptions) as T;

	constructor() {
		if (!initEnabled) {
			throw new Error("r-state-tree: Can't initialize store directly");
		}

		const config = (this.constructor as typeof Store).types as Configuration<
			this
		>;

		const adm = new StoreAdministration<this>(this, config);

		return adm.proxy;
	}

	get key(): string | number | undefined {
		return this.props.key;
	}

	get context(): S {
		return getStoreAdm(this).computedContext;
	}

	reaction(...args: ReactionParams): ReactionReturn {
		return getStoreAdm(this).reaction(...args);
	}

	provideContext(): null | Record<string, unknown> {
		return null;
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	storeDidMount(): void {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	storeWillUnmount(): void {}
}
