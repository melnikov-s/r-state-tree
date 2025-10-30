import { Props, StoreConfiguration, Configuration } from "../types";
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

type CreateStoreProps<T extends Props> = {
	[K in keyof T as undefined extends T[K] ? K : never]?: T[K] extends infer U
		? U extends undefined
			? never
			: undefined extends U
			? U | undefined
			: U
		: never;
} & {
	[K in keyof T as undefined extends T[K] ? never : K]?: T[K];
} & Pick<Props, 'key'>;

export function createStore<K extends Store<T>, T extends Props>(
	Type: new (props: T) => K,
	props?: CreateStoreProps<T>
): K {
	return {
		Type,
		props: props ?? {},
		key: props && props.key,
	} as unknown as K;
}

export function updateStore<K extends Store<T>, T extends Props>(
	store: K,
	props: CreateStoreProps<T>
): K {
	updateProps(store.props, props);

	return store;
}

export function types<T extends Store>(
	config: Partial<StoreConfiguration<T>>
): Partial<StoreConfiguration<T>> {
	return config;
}

export default class Store<PropsType extends Props = Props> {
	static get types(): StoreConfiguration<unknown> {
		return (this as any)[Symbol.metadata];
	}

	props!: PropsType;

	constructor(props: PropsType) {
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
				((this.constructor as typeof Store).types as Configuration<this>) ?? {}
		);
		adm.write("props", getObservable({}));
		updateProps(observable.props, props);

		return observable;
	}

	get key(): string | number | undefined {
		return this.props.key;
	}

	reaction<T>(track: () => T, callback: (a: T) => void): () => void {
		return getStoreAdm(this).reaction(track, callback);
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	storeDidMount(): void {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	storeWillUnmount(): void {}
}
