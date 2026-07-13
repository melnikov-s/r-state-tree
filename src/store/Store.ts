import type {
	Props,
	StoreProps,
	StoreConfiguration,
	Configuration,
} from "../types";
import {
	getStoreAdm,
	StoreAdministration,
	updateProps,
} from "./StoreAdministration";
import {
	createObservableWithCustomAdministration,
	getObservable,
} from "../observables";
import { getConfigurationForCtor } from "../configuration";

let initEnabled = false;
export function allowNewStore<T>(fn: () => T): T {
	initEnabled = true;
	try {
		return fn();
	} finally {
		initEnabled = false;
	}
}

type RequiredKeys<T> = {
	[K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

type CreateStoreProps<T extends Record<string, any>> = T &
	Pick<Props, "key"> &
	Partial<Record<string, unknown>>;

type UpdateStoreProps<T extends Record<string, any>> = Partial<T> &
	Pick<Props, "key"> &
	Partial<Record<string, unknown>>;

type PropsOfStore<T extends Store<any>> = T extends Store<infer P> ? P : never;

export function createStore<
	K extends Store<any>,
	T extends Record<string, any> = K extends Store<infer P> ? P : never
>(
	Type: new (props: StoreProps<T>) => K,
	...args: RequiredKeys<T> extends never
		? [props?: CreateStoreProps<T>]
		: [props: CreateStoreProps<T>]
): K {
	const props = args[0];
	return {
		Type,
		props: props ?? {},
		key: props && props.key,
	} as unknown as K;
}

export function updateStore<K extends Store<any>>(
	store: K,
	props: UpdateStoreProps<PropsOfStore<K>>
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
	PropsType extends Record<string, any> = StoreProps<Props>
> implements Disposable
{
	declare static types?: StoreConfiguration<unknown>;

	props!: StoreProps<PropsType>;

	constructor(props: StoreProps<PropsType>) {
		if (!initEnabled) {
			throw new Error("r-state-tree: Can't initialize store directly");
		}

		const observable = createObservableWithCustomAdministration(
			this,
			StoreAdministration
		);
		const adm = getStoreAdm(observable);
		adm.setConfiguration(
			() =>
				(getConfigurationForCtor(
					this.constructor as unknown as Function
				) as Configuration<this>) ?? {}
		);
		adm.write("props", getObservable({}));
		updateProps(observable.props, props);

		return observable;
	}

	get key(): string | number | undefined {
		return this.props.key;
	}

	reaction<T>(
		track: () => T,
		callback: (value: T, previousValue: T) => void
	): () => void {
		return getStoreAdm(this).reaction(track, callback);
	}

	effect(callback: () => void | (() => void)): () => void {
		return getStoreAdm(this).effect(callback);
	}

	[Symbol.dispose](): void {
		getStoreAdm(this).dispose();
	}
}
