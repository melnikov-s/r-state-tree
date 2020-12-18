import {
	Computed,
	computed,
	getAdministration,
	observable,
	Observable,
	reaction,
	Configuration as LobxConfiguration,
} from "lobx";
import Store, { allowNewStore } from "./Store";
import Model from "../model/Model";
import {
	StoreConfiguration,
	StoreElement,
	Props,
	CommonCfgTypes,
	StoreCfgTypes,
	Context,
} from "../types";
import { getPropertyDescriptor } from "../utils";
import computedProxy from "../computedProxy";
import { listener, Listener, graph, graphOptions } from "../lobx";

const administrationMap: WeakMap<Store, StoreAdministration> = new WeakMap();

export function updateProps(props: Props, newProps: Props): void {
	graph.untracked(() => {
		graph.batch(() => {
			const propKeys = Object.keys(newProps);
			propKeys.forEach((k) => {
				if (k !== "models") {
					props[k] = newProps[k];
				}
			});

			if (newProps.models) {
				if (!props.models) props.models = {};
				Object.assign(props.models, newProps.models);
			}
		});
	});
}

export function getStoreAdm(store: Store): StoreAdministration {
	return administrationMap.get(store)!;
}

type ChildStoreData = {
	value: Observable<Store | null | Store[]>;
	computed: Computed<StoreElement | null | StoreElement[]>;
	listener: Listener;
};

export class StoreAdministration<StoreType extends Store = Store> {
	proxy: StoreType;
	source: StoreType;
	configuration: StoreConfiguration<StoreType>;
	parent: StoreAdministration | null = null;
	mounted: boolean = false;
	computedContext!: Context;
	private contextReactionUnsub: (() => void) | null = null;
	private childStoreDataMap: Map<PropertyKey, ChildStoreData>;
	private observableProxyGet: ProxyHandler<StoreType>["get"];
	private observableProxySet: ProxyHandler<StoreType>["set"];
	private reactionsUnsub: (() => void)[] = [];

	constructor(source: StoreType, configuration: StoreConfiguration<StoreType>) {
		this.source = source;
		this.proxy = observable.configure(
			(configuration as unknown) as LobxConfiguration<StoreType>,
			source,
			graphOptions
		);
		const proxyTraps = getAdministration(this.proxy)!.proxyTraps;
		this.observableProxyGet = proxyTraps.get;
		this.observableProxySet = proxyTraps.set;
		proxyTraps.get = (_, name) => this.proxyGet(name);
		proxyTraps.set = (_, name, value) => this.proxySet(name, value);
		this.configuration = configuration;
		this.childStoreDataMap = new Map();
		administrationMap.set(this.proxy, this);
		administrationMap.set(this.source, this);
	}

	private proxyGet(name: PropertyKey): unknown {
		switch (this.configuration[name as string]?.type) {
			case CommonCfgTypes.child:
				return this.getStore(name);
			case CommonCfgTypes.children:
				return this.getStores(name);
			case StoreCfgTypes.model:
				return this.getModelRef(name);
			default:
				return this.observableProxyGet!(this.source, name, this.proxy);
		}
	}

	private proxySet(name: PropertyKey, value: unknown): boolean {
		if (name === "props" || name === "context") {
			throw new Error(`r-state-tree: ${name} is read-only`);
		}

		if (this.configuration[name as string]?.type === StoreCfgTypes.model) {
			throw new Error(`r-state-tree: model ${String(name)} is read-only`);
		}

		return this.observableProxySet!(this.source, name, value, this.proxy);
	}

	private createChildStore(element: StoreElement): Store {
		return allowNewStore(() => {
			const store = new element.Type();
			updateProps(store.props, element.props);
			return store;
		});
	}

	private setStoreList(
		name: PropertyKey,
		elements: Array<StoreElement | null>
	): Store[] {
		const childStoreData = this.childStoreDataMap.get(name)!;
		const oldStores = graph.untracked(() =>
			childStoreData.value.get()
		) as Store[];
		const stores: Store[] = [];
		let keyedIndexChanged = false;

		if (!oldStores) {
			elements.forEach((e) => {
				if (e) {
					const childStore = this.createChildStore(e);

					stores.push(childStore);
				}
			});

			childStoreData.value.set(stores);
			stores.forEach((s) => getStoreAdm(s).mount(this));

			return stores;
		}

		const newStores: Set<Store> = new Set();
		const removedStores: Set<Store> = new Set(oldStores);
		type KeyValue = { store: Store; index: number };

		const keyMap = oldStores.reduce<Map<unknown, KeyValue>>(
			(map, store, index) => {
				if (store.key !== undefined) {
					map.set(store.key, { store, index });
				}

				return map;
			},
			new Map()
		);

		const addStore = (
			element: NonNullable<StoreElement>,
			index: number
		): void => {
			const childStore = this.createChildStore(element);
			newStores.add(childStore);

			stores.push(childStore);
		};

		const updateStore = (
			element: NonNullable<StoreElement>,
			store: Store,
			index: number
		): void => {
			removedStores.delete(store);
			updateProps(store.props, element.props);
			stores.push(store);
		};

		elements.forEach((e, index) => {
			if (e) {
				const { Type, key } = e;
				const old = oldStores[index];

				if (key === undefined && (!old || old.key === undefined)) {
					if (old instanceof Type) {
						updateStore(e, old, index);
					} else {
						addStore(e, index);
					}
				} else if (key !== undefined) {
					const keyedStore = keyMap.get(key)?.store;
					if (keyedStore && keyedStore instanceof Type) {
						updateStore(e, keyedStore, index);
						if (keyMap.get(key)!.index !== index) {
							keyedIndexChanged = true;
						}
					} else {
						addStore(e, index);
					}
				}
			}
		});

		if (newStores.size || removedStores.size || keyedIndexChanged) {
			childStoreData.value.set(stores);
		}

		removedStores.forEach((s) => getStoreAdm(s).unmount());
		newStores.forEach((s) => getStoreAdm(s).mount(this));

		return stores;
	}

	private setSingleStore(
		name: PropertyKey,
		element: StoreElement | null
	): Store | null {
		const childStoreData = this.childStoreDataMap.get(name)!;
		const oldStore = graph.untracked(() =>
			childStoreData.value.get()
		) as Store | null;
		const { key, Type, props } = element || {};

		if (!element) {
			oldStore && getStoreAdm(oldStore).unmount();
			childStoreData.value.set(null);
			return null;
		} else if (
			!oldStore ||
			oldStore.props.key !== key ||
			!(oldStore instanceof Type!)
		) {
			if (oldStore) {
				getStoreAdm(oldStore).unmount();
			}

			const childStore = this.createChildStore(element);
			childStoreData.value.set(childStore);
			getStoreAdm(childStore).mount(this);
			return childStore;
		} else {
			updateProps(oldStore.props, props!);
			return oldStore;
		}
	}

	private updateStore(name: PropertyKey): void {
		const childStoreData = this.childStoreDataMap.get(name)!;
		const storeElement = childStoreData.listener.track(() =>
			childStoreData.computed.get()
		);
		this.setSingleStore(name, storeElement as StoreElement | null);
	}

	private updateStores(name: PropertyKey): void {
		const childStoreData = this.childStoreDataMap.get(name)!;
		const storeElement = childStoreData.listener.track(() =>
			childStoreData.computed.get()
		);
		this.setStoreList(name, storeElement as StoreElement[]);
	}

	private getComputedGetter(
		name: PropertyKey
	): Computed<StoreElement | null | StoreElement[]> {
		const descriptor = getPropertyDescriptor(this.source, name)!;
		if (typeof descriptor?.get !== "function") {
			throw new Error("child stores are only supported on getters");
		}

		return computed(descriptor.get, {
			context: this.proxy,
			keepAlive: true,
			graph,
		});
	}

	private initializeStore(name: PropertyKey): Store | null {
		const childStoreData: ChildStoreData = this.childStoreDataMap.get(name) ?? {
			computed: this.getComputedGetter(name),
			listener: listener(() => this.updateStore(name)),
			value: observable.box(null, graphOptions) as Observable<
				null | Store | Store[]
			>,
		};

		this.childStoreDataMap.set(name, childStoreData);
		const storeElement = childStoreData.listener.track(() =>
			childStoreData.computed.get()
		);
		this.setSingleStore(name, storeElement as StoreElement | null);
		return childStoreData.value.get() as Store | null;
	}

	private initializeStores(name: PropertyKey): Store[] {
		const childStoreData: ChildStoreData = this.childStoreDataMap.get(name) ?? {
			computed: this.getComputedGetter(name),
			listener: listener(() => this.updateStores(name)),
			value: observable.box([] as Store[], graphOptions) as Observable<
				null | Store | Store[]
			>,
		};

		this.childStoreDataMap.set(name, childStoreData);
		const storeElement = childStoreData.listener.track(() =>
			childStoreData.computed.get()
		);
		this.setStoreList(name, storeElement as StoreElement[]);
		return childStoreData.value.get() as Store[];
	}

	private getStore(name: PropertyKey): Store | null {
		const childStoreData = this.childStoreDataMap.get(name);

		if (!childStoreData || childStoreData.computed.isDirty()) {
			return this.initializeStore(name);
		} else {
			return childStoreData!.value.get() as Store | null;
		}
	}

	private getStores(name: PropertyKey): Store[] {
		const childStoreData = this.childStoreDataMap.get(name);

		if (!childStoreData || childStoreData.computed.isDirty()) {
			return this.initializeStores(name);
		} else {
			return childStoreData!.value.get() as Store[];
		}
	}

	private getModelRef(name: PropertyKey): Model | Model[] | null {
		return this.proxy.props.models?.[name as string] ?? null;
	}

	isRoot(): boolean {
		return !this.parent;
	}

	reaction<T>(track: () => T, callback: (a: T) => void): () => void {
		const unsub = reaction(track, callback, graphOptions);
		this.reactionsUnsub.push(unsub);
		return unsub;
	}

	mount(parent: StoreAdministration | null = null): void {
		this.parent = parent || null;
		if (this.parent) {
			const parentSource = this.parent.proxy;
			this.computedContext = computedProxy(
				computed(
					() => ({
						...parentSource.context,
						...parentSource.provideContext(),
					}),
					graphOptions
				)
			);
		}

		this.childStoreDataMap.forEach((data) => {
			const { value } = data;
			const stores = value.get();
			if (Array.isArray(stores)) {
				stores?.forEach((s) => getStoreAdm(s)?.mount(this));
			} else if (stores) {
				getStoreAdm(stores)?.mount(this);
			}
		});
		this.mounted = true;
		graph.runInAction(() => this.proxy.storeDidMount?.());
	}

	unmount(): void {
		this.proxy.storeWillUnmount?.();
		this.mounted = false;
		this.childStoreDataMap.forEach((data) => {
			const { value, computed, listener } = data;

			const stores = value.get();

			if (Array.isArray(stores)) {
				stores?.forEach((s) => getStoreAdm(s)?.unmount());
			} else if (stores) {
				getStoreAdm(stores)?.unmount();
			}
			computed.clear();
			listener.dispose();
		});
		this.childStoreDataMap.clear();
		this.contextReactionUnsub?.();
		this.reactionsUnsub.forEach((u) => u());
		this.parent = null;
	}
}
