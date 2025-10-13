import { Props, Context, StoreConfiguration, Configuration } from "../types";
import {
	getStoreAdm,
	StoreAdministration,
	updateProps,
} from "./StoreAdministration";
import {
	createObservableWithCustomAdministration,
	getObservable,
} from "../observables";

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
	Type: new (props: T) => K,
	props?: T
): K {
	return {
		Type,
		props: props ?? {},
		key: props && props.key,
	} as unknown as K;
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
> {
	static types: unknown = {};
	props!: PropsType;

	constructor(props: PropsType) {
		if (!initEnabled) {
			throw new Error("r-state-tree: Can't initialize store directly");
		}

		const config = (this.constructor as typeof Store)
			.types as Configuration<this>;

		const observable = createObservableWithCustomAdministration(
			this,
			StoreAdministration
		);
		const adm = getStoreAdm(observable);
		adm.setConfiguration(config ?? {});
		adm.write("props", getObservable({}));
		updateProps(observable.props, props);

		return observable;
	}

	get key(): string | number | undefined {
		return this.props.key;
	}

	get context(): ContextType {
		return getStoreAdm(this).computedContext as ContextType;
	}

	createReaction<T>(track: () => T, callback: (a: T) => void): () => void {
		return getStoreAdm(this).createReaction(track, callback);
	}

	provideContext(): null | Record<string, unknown> {
		return null;
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	storeDidMount(): void {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	storeWillUnmount(): void {}
}
