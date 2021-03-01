import { Props, Context, StoreConfiguration, Configuration } from "../types";
import { Observable } from "lobx";
import {
	StoreAdministration,
	getStoreAdm,
	updateProps,
} from "./StoreAdministration";
import {  graph } from "../lobx";

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

export default class Store<
	PropsType extends Props = Props,
	ContextType extends Context = Context
> extends Observable {
	static types: unknown = {};
	props: PropsType = {} as PropsType;

	constructor() {
		super({ graph, configuration: {} });
		if (!initEnabled) {
			throw new Error("r-state-tree: Can't initialize store directly");
		}

		const config = (this.constructor as typeof Store).types as Configuration<
			this
		>;

		new StoreAdministration<this>(this, config);
	}

	get key(): string | number | undefined {
		return this.props.key;
	}

	get context(): ContextType {
		return getStoreAdm(this).computedContext as ContextType;
	}

	reaction<T>(track: () => T, callback: (a: T) => void): () => void {
		return getStoreAdm(this).reaction(track, callback);
	}

	provideContext(): null | Record<string, unknown> {
		return null;
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	storeDidMount(): void {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	storeWillUnmount(): void {}
}
