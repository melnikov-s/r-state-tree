import type {
	Props,
	StoreProps,
	StoreConfiguration,
	StoreElement,
} from "../types.js";
import { StoreAdministration } from "./StoreAdministration.js";
import { updateProps } from "./storeProps.js";
import {
	getAdministration,
	getObservable,
	registerAdministration,
	untracked,
} from "../observables/index.js";
import { debugEnabled } from "../observables/internal/debug.js";

export function getStoreAdm(store: Store): StoreAdministration {
	return getAdministration(store) as unknown as StoreAdministration;
}

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
			if (construction.administration) {
				construction.administration._constructing = false;
			}
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

export const STORE_ELEMENT = Symbol("r-state-tree.storeElement");

export function isStoreElement(value: unknown): value is StoreElement {
	if (typeof value !== "object" || value === null) return false;
	if ((value as any)[STORE_ELEMENT] === true) return true;

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
	return {
		[STORE_ELEMENT]: true,
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
	PropsType extends Record<string, any> = StoreProps<Props>,
> implements Disposable {
	declare static types?: StoreConfiguration<unknown>;

	props!: StoreProps<PropsType>;

	constructor(props: StoreProps<PropsType>) {
		const construction = currentConstruction;
		if (!construction || construction.administration) {
			throw new Error("r-state-tree: Can't initialize store directly");
		}

		const adm = registerAdministration(new StoreAdministration(this));
		const observable = adm.proxy as this;
		construction.administration = adm;
		adm.setCtor(this.constructor as unknown as Function);
		adm._constructing = true;
		if (debugEnabled) {
			const propsProxy = getObservable({});
			adm.propsAdm = getAdministration(propsProxy);
			adm.write("props", propsProxy);
			updateProps(observable.props, props);
		} else {
			// Materialize props observable proxy lazily when store.props is read.
			const propsSource: Record<string, unknown> = {};
			if (props) {
				let explicitKeys: Set<string> | undefined;
				for (const key in props) {
					if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
					const val = props[key];
					if (typeof val === "object" && val !== null) {
						const valAdm = getAdministration(val);
						if (valAdm && valAdm.proxy === val) {
							(explicitKeys ??= new Set()).add(key);
							propsSource[key] = valAdm.source;
							continue;
						}
					}
					propsSource[key] = val;
				}
				if (explicitKeys) adm._propsExplicitKeys = explicitKeys;
			}
			(adm.source as any).props = propsSource;
			adm.markExplicitObservable("props");
		}

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
