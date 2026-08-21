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
	createAtom,
} from "../observables";
import type {
	ListenerNode,
	SignalNode,
	ComputedNode,
	AtomNode,
} from "../observables";
import { allowNewStore } from "./Store";
import type Store from "./Store";
import type {
	StoreConfiguration,
	StoreElement,
	Props,
	StoreSnapshot,
	StoreChildSnapshot,
	StoreSnapshotChange,
} from "../types";
import { CommonCfgTypes, StoreCfgTypes } from "../types";
import { getConfigType } from "../configuration";
import { clone, getPropertyDescriptor, hydrateSnapshotValue } from "../utils";

const MAX_MOUNT_DEPTH = 100;

type MountFrame = {
	storeName: string;
	childName?: PropertyKey;
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
		return [...start, { storeName: "...", childName: undefined }, ...end]
			.map(formatMountFrame)
			.join(" -> ");
	}

	return chain.map(formatMountFrame).join(" -> ");
}

function createCircularMountError(frame: MountFrame): Error {
	const chain = formatMountChain(frame);
	return new Error(
		`r-state-tree: detected circular store creation while mounting ${chain}. Break the ownership cycle.`
	);
}

export function updateProps(props: Props, newProps: Props): void {
	untracked(() => {
		batch(() => {
			Object.keys(newProps).forEach((key) => {
				props[key] = newProps[key];
			});
		});
	});
}

export function getStoreAdm(store: Store): StoreAdministration {
	return getAdministration(store) as unknown as StoreAdministration;
}

function isStoreElement(value: unknown): value is StoreElement {
	return (
		typeof value === "object" &&
		value !== null &&
		"Type" in value &&
		"props" in value &&
		typeof value.Type === "function" &&
		typeof value.props === "object"
	);
}

function validateStoreChildValue(
	value: unknown,
	propertyName: PropertyKey,
	parentTypeName: string
): void {
	if (value === null || value === undefined) {
		return;
	}

	if (Array.isArray(value)) {
		const elements = value.map(
			(item: unknown): StoreElement | null | undefined => {
				if (item === null || item === undefined || isStoreElement(item)) {
					return item;
				}
				throw new Error(
					`r-state-tree: child property '${String(
						propertyName
					)}' must be a StoreElement ({ Type, props, key }), an array of StoreElements, or null/undefined. Found invalid array item: ${typeof item}`
				);
			}
		);

		const keys = new Set<unknown>();
		for (const item of elements) {
			if (item === null || item === undefined || item.key === undefined)
				continue;
			if (keys.has(item.key)) {
				const formattedKey =
					typeof item.key === "string"
						? JSON.stringify(item.key)
						: String(item.key);
				throw new Error(
					`r-state-tree: duplicate key ${formattedKey} in child property ${JSON.stringify(
						String(propertyName)
					)} of ${parentTypeName}`
				);
			}
			keys.add(item.key);
		}
		return;
	}

	if (isStoreElement(value)) {
		return;
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
					default:
						return ObjectAdministration.proxyTraps.get?.apply(
							null,
							arguments as any
						);
				}
			},

			set(target, name, value) {
				if (name === "props") {
					throw new Error(`r-state-tree: ${name} is read-only`);
				}

				return ObjectAdministration.proxyTraps.set?.apply(
					null,
					arguments as any
				);
			},
		} as ProxyHandler<object>
	);

	parent: StoreAdministration | null = null;
	private readonly abortController = new AbortController();
	private mounted = false;
	private contextCache = new Map<symbol, ComputedNode<unknown>>();
	private childStoreDataMap: Map<PropertyKey, ChildStoreData> = new Map();
	private reactiveRegistrations = new Set<ReactiveRegistration>();
	private configurationGetter?: () => StoreConfiguration<StoreType>;
	private computedSnapshot?: ComputedNode<StoreSnapshot>;
	private snapshotStructureAtom: AtomNode = createAtom();
	private pendingChildSnapshots: Record<
		string,
		StoreChildSnapshot | StoreChildSnapshot[] | null
	> = {};

	get signal(): AbortSignal {
		return this.abortController.signal;
	}

	setConfiguration(
		configurationGetter: () => StoreConfiguration<StoreType>
	): void {
		this.configurationGetter = configurationGetter;
	}

	private get configuration(): StoreConfiguration<StoreType> {
		return this.configurationGetter?.() ?? {};
	}

	private findPendingChildSnapshot(
		name: PropertyKey,
		key: string | number | undefined
	): { snapshot: StoreChildSnapshot; commit: () => void } | undefined {
		const propertyName = String(name);
		if (
			!Object.prototype.hasOwnProperty.call(
				this.pendingChildSnapshots,
				propertyName
			)
		) {
			return undefined;
		}
		const pending = this.pendingChildSnapshots[propertyName];
		if (!pending) return undefined;

		let snapshot: StoreChildSnapshot | undefined;
		if (Array.isArray(pending)) {
			const matchIndex =
				key !== undefined
					? pending.findIndex((item) => item.key === key)
					: pending.findIndex((item) => item.key === undefined);
			if (matchIndex >= 0) snapshot = pending[matchIndex];
		} else if (
			pending &&
			(pending.key === key || (pending.key === undefined && key === undefined))
		) {
			snapshot = pending;
		}

		if (!snapshot) return undefined;

		return {
			snapshot,
			commit: () => {
				const current = this.pendingChildSnapshots[propertyName];
				if (Array.isArray(current)) {
					const matchIndex = current.indexOf(snapshot!);
					if (matchIndex < 0) return;
					const remaining = current.filter((_, i) => i !== matchIndex);
					if (remaining.length) {
						this.pendingChildSnapshots[propertyName] = remaining;
					} else {
						delete this.pendingChildSnapshots[propertyName];
					}
				} else if (current === snapshot) {
					delete this.pendingChildSnapshots[propertyName];
				}
			},
		};
	}

	private hydrateChildStoreFromPendingSnapshot(
		store: Store,
		name: PropertyKey
	): void {
		const pending = this.findPendingChildSnapshot(name, store.key);
		if (!pending) return;
		getStoreAdm(store).loadSnapshot(pending.snapshot);
		pending.commit();
	}

	private createChildStore(element: StoreElement, name: PropertyKey): Store {
		const child = allowNewStore(() => new element.Type(element.props));
		try {
			this.hydrateChildStoreFromPendingSnapshot(child, name);
			return child;
		} catch (error) {
			getStoreAdm(child).dispose(true);
			throw error;
		}
	}

	private finishPendingChildSnapshots(name: PropertyKey): void {
		const stores = this.childStoreDataMap.get(name)!.value.get();
		if (Array.isArray(stores)) {
			stores.forEach((store) => {
				this.hydrateChildStoreFromPendingSnapshot(store, name);
			});
		} else if (stores) {
			this.hydrateChildStoreFromPendingSnapshot(stores, name);
		}

		delete this.pendingChildSnapshots[String(name)];
	}

	private validateStoreChildValue(value: unknown, name: PropertyKey): void {
		validateStoreChildValue(
			value,
			name,
			(this.proxy.constructor as { name?: string }).name || "Store"
		);
	}

	private setStoreList(
		name: PropertyKey,
		elements: Array<StoreElement | null>
	): Store[] {
		const childStoreData = this.childStoreDataMap.get(name)!;
		const oldStores = untracked(() => childStoreData.value.get()) as Store[];
		const stores: Store[] = [];
		const propertyName = String(name);
		const hadPendingSnapshots = Object.prototype.hasOwnProperty.call(
			this.pendingChildSnapshots,
			propertyName
		);
		const pendingSnapshotsBefore = this.pendingChildSnapshots[propertyName];
		const rollbackPendingSnapshots = (): void => {
			if (hadPendingSnapshots) {
				this.pendingChildSnapshots[propertyName] = pendingSnapshotsBefore;
			} else {
				delete this.pendingChildSnapshots[propertyName];
			}
		};
		let keyedIndexChanged = false;

		if (!oldStores) {
			try {
				elements.forEach((e) => {
					if (e) {
						const childStore = this.createChildStore(e, name);

						stores.push(childStore);
					}
				});

				childStoreData.value.set(stores);
				if (this.isMounted) {
					stores.forEach((s) => getStoreAdm(s).mount(this, name));
				}
			} catch (error) {
				childStoreData.value.set(null);
				stores.forEach((store) => getStoreAdm(store).dispose(true));
				rollbackPendingSnapshots();
				throw error;
			}

			return stores;
		}

		const newStores: Set<Store> = new Set();
		const removedStores: Set<Store> = new Set(oldStores);
		const propsUpdates: Array<{ store: Store; props: Props }> = [];
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

		const addStore = (element: NonNullable<StoreElement>): void => {
			const childStore = this.createChildStore(element, name);
			newStores.add(childStore);

			stores.push(childStore);
		};

		const updateStore = (
			element: NonNullable<StoreElement>,
			store: Store
		): void => {
			removedStores.delete(store);
			propsUpdates.push({ store, props: element.props });
			stores.push(store);
		};

		try {
			elements.forEach((e, index) => {
				if (e) {
					const { Type, key } = e;
					const old = oldStores[index];

					if (key === undefined && (!old || old.key === undefined)) {
						if (old instanceof Type) {
							updateStore(e, old);
						} else {
							addStore(e);
						}
					} else if (key !== undefined) {
						const keyedStore = keyMap.get(key)?.store;
						if (keyedStore && keyedStore instanceof Type) {
							updateStore(e, keyedStore);
							if (keyMap.get(key)!.index !== index) {
								keyedIndexChanged = true;
							}
						} else {
							addStore(e);
						}
					}
				}
			});
		} catch (error) {
			newStores.forEach((store) => getStoreAdm(store).dispose(true));
			rollbackPendingSnapshots();
			throw error;
		}

		propsUpdates.forEach(({ store, props }) => updateProps(store.props, props));

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

			const childStore = this.createChildStore(element, name);
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
		const storeElement = childStoreData.computed.get();
		this.validateStoreChildValue(storeElement, name);
		Array.isArray(storeElement)
			? this.setStoreList(name, storeElement)
			: this.setSingleStore(name, storeElement as StoreElement | null);
		this.finishPendingChildSnapshots(name);
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
		this.validateStoreChildValue(storeElement, name);
		Array.isArray(storeElement)
			? this.setStoreList(name, storeElement)
			: this.setSingleStore(name, storeElement as StoreElement | null);
		this.finishPendingChildSnapshots(name);
		this.snapshotStructureAtom.reportChanged();
		return childStoreData.value.get() as Store | null;
	}

	private getStore(name: PropertyKey): Store | null {
		const childStoreData = this.childStoreDataMap.get(name);

		if (!childStoreData) {
			untracked(() => this.initializeStore(name));
			return this.childStoreDataMap.get(name)!.value.get() as Store | null;
		} else {
			const storeElement = untracked(() => childStoreData.computed.get());
			this.validateStoreChildValue(storeElement, name);
			Array.isArray(storeElement)
				? this.setStoreList(name, storeElement)
				: this.setSingleStore(name, storeElement as StoreElement | null);
			this.finishPendingChildSnapshots(name);
			return childStoreData.value.get() as Store | null;
		}
	}

	loadSnapshot(snapshot: StoreSnapshot): void {
		if (!snapshot || typeof snapshot !== "object") {
			throw new Error("r-state-tree: invalid Store snapshot");
		}

		const state = snapshot.state ?? {};
		const children = snapshot.children ?? {};
		untracked(() => {
			batch(() => {
				let hasInPlaceStateChange = false;
				this.pendingChildSnapshots = clone(children, "children");
				Object.keys(state).forEach((key) => {
					if (
						getConfigType(this.configuration[key]) !== StoreCfgTypes.snapshot
					) {
						console.warn(
							`r-state-tree: Store snapshot key '${key}' is not decorated with @snapshot and was ignored.`
						);
						return;
					}
					const currentValue = (this.proxy as any)[key];
					const changeTracker = { changed: false };
					const hydratedValue = hydrateSnapshotValue(
						currentValue,
						clone(state[key], `state.${key}`),
						changeTracker
					);
					(this.proxy as any)[key] = hydratedValue;
					if (changeTracker.changed && Object.is(currentValue, hydratedValue)) {
						hasInPlaceStateChange = true;
					}
				});
				if (hasInPlaceStateChange) {
					this.atom.reportChanged();
				}
				// Hydrated state can select a different Type from an already-realized
				// child getter. Reconcile it before hydrating any reused children.
				Array.from(this.childStoreDataMap.keys()).forEach((name) => {
					this.updateStore(name);
				});
				this.snapshotStructureAtom.reportChanged();
			});
		});
	}

	private snapshotChild(store: Store): StoreChildSnapshot {
		const snapshot = getStoreAdm(store).getSnapshot();
		return store.key === undefined ? snapshot : { key: store.key, ...snapshot };
	}

	private toJSON(): StoreSnapshot {
		this.snapshotStructureAtom.reportObserved();
		const state: Record<string, unknown> = {};
		const children: StoreSnapshot["children"] = {};

		Object.keys(this.configuration).forEach((key) => {
			if (getConfigType(this.configuration[key]) === StoreCfgTypes.snapshot) {
				state[key] = clone((this.proxy as any)[key], key);
			}
		});

		Object.entries(this.pendingChildSnapshots).forEach(([key, value]) => {
			children[key] = clone(value, `children.${key}`);
		});

		this.childStoreDataMap.forEach(({ value }, name) => {
			const stores = value.get();
			const key = String(name);
			if (Array.isArray(stores)) {
				const realized = stores.map((store) => this.snapshotChild(store));
				const pending = this.pendingChildSnapshots[key];
				children[key] = Array.isArray(pending)
					? [...realized, ...clone(pending, `children.${key}`)]
					: realized;
			} else if (stores) {
				children[key] = this.snapshotChild(stores);
			} else if (!Object.prototype.hasOwnProperty.call(children, key)) {
				children[key] = null;
			}
		});

		return { state, children };
	}

	getSnapshot(): StoreSnapshot {
		if (!this.computedSnapshot) {
			this.computedSnapshot = createComputed(() => this.toJSON());
		}
		return this.computedSnapshot.get();
	}

	onSnapshotChange(onChange: StoreSnapshotChange<StoreType>): () => void {
		return reaction(
			() => this.getSnapshot(),
			(snapshot) => onChange(snapshot, this.proxy as StoreType)
		);
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
		if (this.signal.aborted) {
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
		if (this.signal.aborted) {
			throw new Error("r-state-tree: cannot mount a disposed store");
		}
		if (this.isMounted) {
			throw new Error("r-state-tree: store is already mounted");
		}
		const frame: MountFrame = {
			storeName: (this.proxy.constructor as { name?: string }).name || "Store",
			childName,
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
		if (this.signal.aborted) return;
		if (!internal && !this.isRoot()) {
			throw new Error("r-state-tree: can only dispose root stores");
		}
		this.abortController.abort();
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
			this.computedSnapshot?.clear();
			this.computedSnapshot = undefined;
			this.pendingChildSnapshots = {};
			this.parent = null;
		});
		this.reactiveRegistrations.forEach((registration) => {
			registration.disposed = true;
			registration.stop?.();
			registration.stop = undefined;
		});
		this.reactiveRegistrations.clear();
		this.mounted = false;
	}
}
