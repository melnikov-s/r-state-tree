import type {
	Props,
	StoreProps,
	StoreConfiguration,
	Configuration,
	StoreElement,
} from "../types.js";
import {
	getStoreAdm,
	StoreAdministration,
	updateProps,
} from "./StoreAdministration.js";
import {
	createObservableWithCustomAdministration,
	getObservable,
	untracked,
} from "../observables/index.js";
import { getConfigurationForCtor } from "../configuration.js";

type StoreConstruction = { administration?: StoreAdministration };
let currentConstruction: StoreConstruction | undefined;

export function constructStore<T extends Store>(
	Type: new (props: Props) => T,
	props: Props
): T {
	const previousConstruction = currentConstruction;
	const construction: StoreConstruction = {};
	try {
		currentConstruction = construction;
		try {
			return new Type(props);
		} finally {
			currentConstruction = previousConstruction;
		}
	} catch (error) {
		try {
			// Derived initializers can realize children before `new` returns.
			untracked(() => construction.administration?.dispose(true));
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"r-state-tree: store construction and cleanup failed",
				{ cause: error }
			);
		}
		throw error;
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

const storeElements = new WeakSet<object>();

export function isStoreElement(value: unknown): value is StoreElement {
	if (typeof value !== "object" || value === null) return false;
	if (storeElements.has(value)) return true;

	// Keep accepting structural descriptors, but do not duck-type Store or
	// Model instances (or invoke an accessor named Type on an unrelated object).
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	const Type = Object.getOwnPropertyDescriptor(value, "Type")?.value;
	const props = Object.getOwnPropertyDescriptor(value, "props")?.value;
	return (
		typeof Type === "function" &&
		(Type === Store || Type.prototype instanceof Store) &&
		typeof props === "object" &&
		props !== null
	);
}

export function createStore<
	K extends Store<any>,
	T extends Record<string, any> = K extends Store<infer P> ? P : never,
>(
	Type: new (props: StoreProps<T>) => K,
	...args: RequiredKeys<T> extends never
		? [props?: CreateStoreProps<T>]
		: [props: CreateStoreProps<T>]
): K {
	const props = args[0];
	const element = {
		Type,
		props: props ?? {},
		key: props && props.key,
	};
	storeElements.add(element);
	return element as unknown as K;
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
	PropsType extends Record<string, any> = StoreProps<Props>,
> implements Disposable {
	declare static types?: StoreConfiguration<unknown>;

	props!: StoreProps<PropsType>;

	constructor(props: StoreProps<PropsType>) {
		const construction = currentConstruction;
		if (!construction || construction.administration) {
			throw new Error("r-state-tree: Can't initialize store directly");
		}

		const observable = createObservableWithCustomAdministration(
			this,
			StoreAdministration
		);
		const adm = getStoreAdm(observable);
		construction.administration = adm;
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

	get signal(): AbortSignal {
		return getStoreAdm(this).signal;
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
