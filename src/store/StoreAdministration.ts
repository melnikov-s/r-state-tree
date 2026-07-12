import {
	getAdministration,
	PreactObjectAdministration as ObjectAdministration,
	createSignal,
	createListener,
	reaction,
	effect,
	batch,
	untracked,
	createComputed,
	getObservable,
	isObservable,
} from "../observables";
import type { ListenerNode, SignalNode, ComputedNode } from "../observables";
import { allowNewStore } from "./Store";
import type Store from "./Store";
import type Model from "../model/Model";
import type { StoreConfiguration, StoreElement, Props } from "../types";
import { CommonCfgTypes, StoreCfgTypes } from "../types";
import { getConfigType } from "../configuration";
import { getPropertyDescriptor } from "../utils";

const MAX_MOUNT_DEPTH = 100;

type MountFrame = {
	storeName: string;
	childName?: PropertyKey;
	modelsKeys: string[];
};

const mountingStack: MountFrame[] = [];

function formatMountFrame(frame: MountFrame): string {
	const childSegment =
		frame.childName === undefined ? "" : `.${String(frame.childName)}`;
	return `${frame.storeName}${childSegment}`;
}

function formatMountChain(frame: MountFrame): string {
	const chain = [...mountingStack, frame];
	const maxParts = 6;

	if (chain.length > maxParts) {
		const start = chain.slice(0, 3);
		const end = chain.slice(-2);
		return [
			...start,
			{ storeName: "...", modelsKeys: [], childName: undefined },
			...end,
		]
			.map(formatMountFrame)
			.join(" -> ");
	}

	return chain.map(formatMountFrame).join(" -> ");
}

function createCircularMountError(frame: MountFrame): Error {
	const chain = formatMountChain(frame);
	const models =
		frame.modelsKeys.length === 0
			? "no models provided"
			: `models: ${frame.modelsKeys.join(", ")}`;
	return new Error(
		`r-state-tree: detected circular store/model creation while mounting ${chain} (using ${models}). Passing models into child stores during mount can create recursive wiring. Break the ownership cycle.`
	);
}

export function updateProps(props: Props, newProps: Props): void {
	untracked(() => {
		batch(() => {
			const propKeys = Object.keys(newProps);
			propKeys.forEach((k) => {
				if (k !== "models") {
					props[k] = newProps[k];
				}
			});

			if (newProps.models) {
				if (!props.models || !isObservable(props.models)) {
					props.models = getObservable(props.models || {});
				}
				Object.assign(props.models, newProps.models);
			}
		});
	});
}

export function getStoreAdm(store: Store): StoreAdministration {
	return getAdministration(store) as unknown as StoreAdministration;
}

function validateStoreChildValue(
	value: unknown,
	propertyName: PropertyKey
): void {
	if (value === null || value === undefined) {
		return;
	}

	if (Array.isArray(value)) {
		const invalidItem = value.find(
			(item) =>
				item !== null &&
				(typeof item !== "object" ||
					!("Type" in item) ||
					!("props" in item) ||
					typeof (item as StoreElement).Type !== "function" ||
					typeof (item as StoreElement).props !== "object")
		);
		if (invalidItem !== undefined) {
			throw new Error(
				`r-state-tree: child property '${String(
					propertyName
				)}' must be a StoreElement ({ Type, props, key }), an array of StoreElements, or null/undefined. Found invalid array item: ${typeof invalidItem}`
			);
		}
		return;
	}

	if (
		typeof value === "object" &&
		value !== null &&
		"Type" in value &&
		"props" in value
	) {
		const element = value as StoreElement;
		if (
			typeof element.Type === "function" &&
			typeof element.props === "object"
		) {
			return;
		}
	}

	throw new Error(
		`r-state-tree: child property '${String(
			propertyName
		)}' must be a StoreElement ({ Type, props, key }), an array of StoreElements, or null/undefined. Found: ${typeof value}`
	);
}

type ChildStoreData = {
	value: SignalNode<Store | null | Store[]>;
	computed: ComputedNode<StoreElement | null | StoreElement[]>;
	listener: ListenerNode;
};

type ReactiveRegistration = {
	start: () => () => void;
	stop?: () => void;
	disposed: boolean;
};

type ActivationEntry = {
	store: StoreAdministration;
	depth: number;
};

export class StoreAdministration<
	StoreType extends Store = Store
> extends ObjectAdministration<Store> {
	private static pendingActivations: ActivationEntry[] = [];
	private static isFlushingActivations = false;
	private static currentActivationDepth = 0;

	private static flushReactiveRegistrations(
		stores: StoreAdministration[]
	): void {
		const depth = this.isFlushingActivations
			? this.currentActivationDepth + 1
			: 0;
		this.pendingActivations.push(...stores.map((store) => ({ store, depth })));

		if (this.isFlushingActivations) return;

		this.isFlushingActivations = true;
		try {
			let entry: ActivationEntry | undefined;
			while ((entry = this.pendingActivations.shift())) {
				this.currentActivationDepth = entry.depth;
				if (entry.depth > MAX_MOUNT_DEPTH) {
					throw createCircularMountError({
						storeName:
							(entry.store.proxy.constructor as { name?: string }).name ||
							"Store",
						modelsKeys: Object.keys(entry.store.proxy.props?.models ?? {}),
					});
				}
				entry.store.startReactiveRegistrations();
			}
		} finally {
			this.pendingActivations.length = 0;
			this.currentActivationDepth = 0;
			this.isFlushingActivations = false;
		}
	}

	static proxyTraps: ProxyHandler<object> = Object.assign(
		{},
		ObjectAdministration.proxyTraps,
		{
			get(target, name) {
				if (name === "key" || name === Symbol.dispose) {
					return Reflect.get(target, name);
				}

				const adm = getAdministration(target) as StoreAdministration;
				switch (getConfigType(adm.configuration[name as string])) {
					case CommonCfgTypes.child:
						return adm.getStore(name);
					case StoreCfgTypes.model:
						return adm.getModelRef(name);
					default:
						return ObjectAdministration.proxyTraps.get?.apply(
							null,
							arguments as any
						);
				}
			},

			set(target, name, value) {
				const adm = getAdministration(target) as StoreAdministration;

				if (name === "props") {
					throw new Error(`r-state-tree: ${name} is read-only`);
				}

				if (
					getConfigType(adm.configuration[name as string]) ===
					StoreCfgTypes.model
				) {
					if (value !== undefined) {
						throw new Error(`r-state-tree: model ${String(name)} is read-only`);
					}
				}

				return ObjectAdministration.proxyTraps.set?.apply(
					null,
					arguments as any
				);
			},
		} as ProxyHandler<object>
	);

	parent: StoreAdministration | null = null;
	private mounted = false;
	private disposed = false;
	private contextCache = new Map<symbol, ComputedNode<unknown>>();
	private childStoreDataMap: Map<PropertyKey, ChildStoreData> = new Map();
	private reactiveRegistrations = new Set<ReactiveRegistration>();
	private configurationGetter?: () => StoreConfiguration<StoreType>;

	setConfiguration(
		configurationGetter: () => StoreConfiguration<StoreType>
	): void {
		this.configurationGetter = configurationGetter;
	}

	private get configuration(): StoreConfiguration<StoreType> {
		return this.configurationGetter?.() ?? {};
	}

	private createChildStore(element: StoreElement): Store {
		return allowNewStore(() => new element.Type(element.props));
	}

	private setStoreList(
		name: PropertyKey,
		elements: Array<StoreElement | null>
	): Store[] {
		const childStoreData = this.childStoreDataMap.get(name)!;
		const oldStores = untracked(() => childStoreData.value.get()) as Store[];
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
			if (this.isMounted) {
				stores.forEach((s) => getStoreAdm(s).mount(this, name));
			}

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
			batch(() => childStoreData.value.set(stores));
		}

		removedStores.forEach((s) => getStoreAdm(s).dispose(true));
		if (this.isMounted) {
			newStores.forEach((s) => getStoreAdm(s).mount(this, name));
		}

		return stores;
	}

	private setSingleStore(
		name: PropertyKey,
		element: StoreElement | null
	): Store | null {
		const childStoreData = this.childStoreDataMap.get(name)!;
		const oldStore = untracked(() =>
			childStoreData.value.get()
		) as Store | null;
		const { key, Type, props } = element || {};

		if (!element) {
			oldStore && getStoreAdm(oldStore).dispose(true);
			batch(() => childStoreData.value.set(null));
			return null;
		} else if (
			!oldStore ||
			oldStore.props.key !== key ||
			!(oldStore instanceof Type!)
		) {
			if (oldStore) {
				getStoreAdm(oldStore).dispose(true);
			}

			const childStore = this.createChildStore(element);
			batch(() => childStoreData.value.set(childStore));
			if (this.isMounted) {
				getStoreAdm(childStore).mount(this, name);
			}
			return childStore;
		} else {
			batch(() => updateProps(oldStore.props, props!));
			return oldStore;
		}
	}

	private updateStore(name: PropertyKey): void {
		const childStoreData = this.childStoreDataMap.get(name)!;
		const storeElement = childStoreData.listener.track(() =>
			childStoreData.computed.get()
		);
		validateStoreChildValue(storeElement, name);
		Array.isArray(storeElement)
			? this.setStoreList(name, storeElement)
			: this.setSingleStore(name, storeElement as StoreElement | null);
	}

	private getComputedGetter(
		name: PropertyKey
	): ComputedNode<StoreElement | null | StoreElement[]> {
		const descriptor = getPropertyDescriptor(this.source, name)!;
		if (typeof descriptor?.get !== "function") {
			throw new Error("child stores are only supported on getters");
		}

		return createComputed(descriptor.get, this.proxy);
	}

	private initializeStore(name: PropertyKey): Store | null {
		const value = createSignal<null | Store | Store[]>(null);
		const childStoreData: ChildStoreData = this.childStoreDataMap.get(name) ?? {
			computed: this.getComputedGetter(name),
			listener: createListener(() => this.updateStore(name)),
			value,
		};

		this.childStoreDataMap.set(name, childStoreData);
		const storeElement = childStoreData.listener.track(() =>
			childStoreData.computed.get()
		);
		validateStoreChildValue(storeElement, name);
		Array.isArray(storeElement)
			? this.setStoreList(name, storeElement)
			: this.setSingleStore(name, storeElement as StoreElement | null);
		return childStoreData.value.get() as Store | null;
	}

	private getStore(name: PropertyKey): Store | null {
		const childStoreData = this.childStoreDataMap.get(name);

		if (!childStoreData) {
			untracked(() => this.initializeStore(name));
			return this.childStoreDataMap.get(name)!.value.get() as Store | null;
		} else {
			const storeElement = untracked(() => childStoreData.computed.get());
			validateStoreChildValue(storeElement, name);
			Array.isArray(storeElement)
				? this.setStoreList(name, storeElement)
				: this.setSingleStore(name, storeElement as StoreElement | null);
			return childStoreData.value.get() as Store | null;
		}
	}

	private getModelRef(name: PropertyKey): Model | Model[] | null {
		const models = this.proxy.props.models;
		const ref = models?.[name as string] ?? null;
		return ref;
	}

	isRoot(): boolean {
		return !this.parent;
	}

	get isMounted(): boolean {
		return this.mounted;
	}

	getContextValue<T>(
		contextId: symbol,
		provideSymbol: symbol,
		defaultValue: T | undefined,
		hasDefault: boolean
	): T {
		// Check cache first
		let computed = this.contextCache.get(contextId);

		if (!computed) {
			// Create computed that walks up the parent chain
			computed = createComputed(() => {
				return this.lookupContextValue(
					contextId,
					provideSymbol,
					defaultValue,
					hasDefault
				);
			});
			this.contextCache.set(contextId, computed);
		}

		return computed.get() as T;
	}

	private lookupContextValue<T>(
		contextId: symbol,
		provideSymbol: symbol,
		defaultValue: T | undefined,
		hasDefault: boolean
	): T {
		// Check if current store provides this context
		const provideMethod = (this.source as any)[provideSymbol];
		if (typeof provideMethod === "function") {
			return provideMethod.call(this.proxy);
		}

		// Walk up the parent chain
		if (this.parent) {
			return this.parent.getContextValue(
				contextId,
				provideSymbol,
				defaultValue,
				hasDefault
			);
		}

		// No provider found, use default
		if (hasDefault) {
			return defaultValue as T;
		}

		// No default and no provider - return undefined
		return undefined as T;
	}

	private register(start: () => () => void): () => void {
		if (this.disposed) {
			throw new Error(
				"r-state-tree: cannot register reactive resources on a disposed store"
			);
		}
		const registration: ReactiveRegistration = { start, disposed: false };
		this.reactiveRegistrations.add(registration);
		if (this.isMounted) registration.stop = registration.start();

		return () => {
			if (registration.disposed) return;
			registration.disposed = true;
			this.reactiveRegistrations.delete(registration);
			registration.stop?.();
			registration.stop = undefined;
		};
	}

	private startReactiveRegistrations(): void {
		this.reactiveRegistrations.forEach((registration) => {
			if (!registration.disposed && !registration.stop) {
				registration.stop = registration.start();
			}
		});
	}

	reaction<T>(
		track: () => T,
		callback: (value: T, previousValue: T) => void
	): () => void {
		return this.register(() => reaction(track, callback));
	}

	effect(callback: () => void | (() => void)): () => void {
		return this.register(() => effect(callback));
	}

	mount(
		parent: StoreAdministration | null = null,
		childName?: PropertyKey,
		activationQueue?: StoreAdministration[]
	): void {
		if (this.disposed) {
			throw new Error("r-state-tree: cannot mount a disposed store");
		}
		if (this.isMounted) {
			throw new Error("r-state-tree: store is already mounted");
		}
		const frame: MountFrame = {
			storeName: (this.proxy.constructor as { name?: string }).name || "Store",
			childName,
			modelsKeys: Object.keys(this.proxy.props?.models ?? {}),
		};

		if (mountingStack.length + 1 > MAX_MOUNT_DEPTH) {
			throw createCircularMountError(frame);
		}

		mountingStack.push(frame);
		const isOutermostMount = activationQueue === undefined;
		const registrationsToStart = activationQueue ?? [];
		try {
			batch(() => {
				this.parent = parent || null;
				this.childStoreDataMap.forEach(({ value }, name) => {
					const stores = value.get();
					if (Array.isArray(stores)) {
						stores?.forEach((s) =>
							getStoreAdm(s)?.mount(this, name, registrationsToStart)
						);
					} else if (stores) {
						getStoreAdm(stores)?.mount(this, name, registrationsToStart);
					}
				});
				this.mounted = true;
				registrationsToStart.push(this);
			});
			if (isOutermostMount) {
				StoreAdministration.flushReactiveRegistrations(registrationsToStart);
			}
		} catch (error) {
			if (
				error instanceof Error &&
				((error instanceof RangeError && /call stack/i.test(error.message)) ||
					/cycle detected/i.test(error.message))
			) {
				throw createCircularMountError(frame);
			}
			throw error;
		} finally {
			mountingStack.pop();
		}
	}

	dispose(internal = false): void {
		if (this.disposed) return;
		if (!internal && !this.isRoot()) {
			throw new Error("r-state-tree: can only dispose root stores");
		}
		batch(() => {
			this.childStoreDataMap.forEach((data) => {
				const { value, computed, listener } = data;

				const stores = value.get();

				if (Array.isArray(stores)) {
					stores?.forEach((s) => getStoreAdm(s)?.dispose(true));
				} else if (stores) {
					getStoreAdm(stores)?.dispose(true);
				}
				computed.clear();
				listener.dispose();
			});
			this.childStoreDataMap.clear();
			this.contextCache.forEach((computed) => computed.clear());
			this.contextCache.clear();
			this.parent = null;
		});
		this.disposed = true;
		this.reactiveRegistrations.forEach((registration) => {
			registration.disposed = true;
			registration.stop?.();
			registration.stop = undefined;
		});
		this.reactiveRegistrations.clear();
		this.mounted = false;
	}
}
