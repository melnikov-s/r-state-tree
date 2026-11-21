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
} from "../observables/index.js";
import type {
	ListenerNode,
	SignalNode,
	ComputedNode,
	AtomNode,
} from "../observables/index.js";
import { constructStore } from "./Store.js";
import { debugWrite, debugEnabled } from "../observables/internal/debug.js";
import { retainedChildRead } from "../observables/internal/retainedRead.js";
import type Store from "./Store.js";
import type {
	StoreConfiguration,
	StoreElement,
	Props,
	StoreSnapshot,
	StoreChildSnapshot,
	StoreSnapshotChange,
} from "../types.js";
import { CommonCfgTypes, StoreCfgTypes } from "../types.js";
import { getConfigType } from "../configuration.js";
import {
	clone,
	getPropertyDescriptor,
	hydrateSnapshotValue,
} from "../utils.js";

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
	initialized?: boolean;
	reconciledElement?: StoreElement | null | StoreElement[];
	value: SignalNode<Store | null | Store[]>;
	computed: ComputedNode<StoreElement | null | StoreElement[]>;
	listener?: ListenerNode;
};

type ChildSnapshot = NonNullable<StoreSnapshot["children"]>[string];

type ChildStorePlan = {
	value: Store | Store[] | null;
	retired: Iterable<Store>;
};

function captureChildError(errors: unknown[], operation: () => void): void {
	try {
		operation();
	} catch (error) {
		errors.push(error);
	}
}

function batchChildChanges(operation: (errors: unknown[]) => void): void {
	const errors: unknown[] = [];
	// A reaction flushing at the end of the batch must not mask an earlier error.
	captureChildError(errors, () =>
		batch(() => captureChildError(errors, () => operation(errors)))
	);
	if (errors.length === 1) throw errors[0];
	if (errors.length) {
		throw new AggregateError(
			errors,
			"r-state-tree: child reconciliation failed",
			{
				cause: errors[0],
			}
		);
	}
}

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
	StoreType extends Store = Store,
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
	private disposalState: "active" | "disposing" | "disposed" = "active";
	private contextCache = new Map<symbol, ComputedNode<unknown>>();
	private contextParentAtom: AtomNode = createAtom();
	private childStoreDataMap: Map<PropertyKey, ChildStoreData> = new Map();
	private reactiveRegistrations = new Set<ReactiveRegistration>();
	private configurationGetter?: () => StoreConfiguration<StoreType>;
	private computedSnapshot?: ComputedNode<StoreSnapshot | undefined>;
	private snapshotStructureAtom: AtomNode = createAtom();
	private pendingChildSnapshots: NonNullable<StoreSnapshot["children"]> = {};

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

	/** Retained metadata only: does not evaluate child getters. */
	getInspectionMetadata() {
		return {
			fields: Reflect.ownKeys(this.configuration).map((key) => ({
				key,
				type: getConfigType(this.configuration[key as string]),
			})),
			parent: this.parent?.proxy ?? null,
			status: this.signal.aborted
				? "disposed"
				: this.isMounted
					? "mounted"
					: "unmounted",
		} as const;
	}

	/** Read realized storage, deliberately bypassing the public reconciling getter. */
	peekInspectionChild(name: PropertyKey): {
		initialized: boolean;
		value?: Store | Store[] | null;
	} {
		const data = this.childStoreDataMap.get(name);
		return data?.initialized
			? { initialized: true, value: untracked(() => data.value.get()) }
			: { initialized: false };
	}

	private getPendingChildSnapshot(name: PropertyKey) {
		const propertyName = String(name);
		return Object.prototype.hasOwnProperty.call(
			this.pendingChildSnapshots,
			propertyName
		)
			? this.pendingChildSnapshots[propertyName]
			: undefined;
	}

	private matchChildSnapshots(snapshots: ChildSnapshot | undefined) {
		if (!snapshots) return undefined;

		const keyed = new Map<string | number, StoreChildSnapshot>();
		const positional: (StoreChildSnapshot | null)[] = [];
		for (const snapshot of Array.isArray(snapshots) ? snapshots : [snapshots]) {
			if (snapshot === undefined) continue;
			if (snapshot?.key === undefined) {
				positional.push(snapshot);
			} else if (!keyed.has(snapshot.key)) {
				keyed.set(snapshot.key, snapshot);
			}
		}

		// Assign once in target order, including null snapshot slots for empty
		// unkeyed stores. The retained input is not changed until the plan succeeds.
		let position = 0;
		return (key: string | number | undefined) =>
			key === undefined ? positional[position++] : keyed.get(key);
	}

	private finishPendingChildSnapshots(name: PropertyKey): void {
		if (this.getPendingChildSnapshot(name) !== undefined) {
			delete this.pendingChildSnapshots[String(name)];
			if (this.childStoreDataMap.get(name)?.initialized) {
				this.snapshotStructureAtom.reportChanged();
			}
		}
	}

	private validateStoreChildValue(value: unknown, name: PropertyKey): void {
		validateStoreChildValue(
			value,
			name,
			(this.proxy.constructor as { name?: string }).name || "Store"
		);
	}

	private planStoreList(
		elements: Array<StoreElement | null>,
		snapshots: ChildSnapshot | undefined,
		previous: Store | Store[] | null,
		created: Store[]
	): ChildStorePlan {
		const oldStores = Array.isArray(previous) ? previous : [];
		const removedStores = new Set(
			Array.isArray(previous) ? previous : previous ? [previous] : []
		);
		const stores: Store[] = [];
		const propsUpdates: Array<{
			store: Store;
			props: Props;
			snapshot: StoreChildSnapshot | null | undefined;
		}> = [];
		const keyed = new Map<string | number, Store>();
		for (const store of oldStores) {
			if (store.key !== undefined) keyed.set(store.key, store);
		}

		const matchSnapshot = this.matchChildSnapshots(snapshots);
		for (const element of elements) {
			if (!element) continue;
			const { key, props, Type } = element;
			// Descriptors without a child do not occupy a realized position.
			const old = key === undefined ? oldStores[stores.length] : keyed.get(key);
			const snapshot = matchSnapshot?.(key);
			if (
				(key !== undefined || old?.key === undefined) &&
				old instanceof Type
			) {
				removedStores.delete(old);
				propsUpdates.push({ store: old, props, snapshot });
				stores.push(old);
			} else {
				const store = constructStore(Type, props);
				created.push(store);
				if (snapshot) getStoreAdm(store).loadSnapshot(snapshot);
				stores.push(store);
			}
		}

		for (const { store, props, snapshot } of propsUpdates) {
			updateProps(store.props, props);
			if (snapshot) getStoreAdm(store).loadSnapshot(snapshot);
		}

		const unchanged =
			previous === oldStores &&
			stores.length === oldStores.length &&
			stores.every((store, index) => store === oldStores[index]);
		return { value: unchanged ? oldStores : stores, retired: removedStores };
	}

	private planSingleStore(
		element: StoreElement | null,
		snapshots: ChildSnapshot | undefined,
		previous: Store | Store[] | null,
		created: Store[]
	): ChildStorePlan {
		const oldStore = Array.isArray(previous) ? null : previous;
		const snapshot = element
			? this.matchChildSnapshots(snapshots)?.(element.key)
			: undefined;
		if (
			element &&
			oldStore?.props.key === element.key &&
			oldStore instanceof element.Type
		) {
			updateProps(oldStore.props, element.props);
			if (snapshot) getStoreAdm(oldStore).loadSnapshot(snapshot);
			return { value: oldStore, retired: [] };
		}

		// Construction must succeed before retiring the currently valid child.
		let replacement: Store | null = null;
		if (element) {
			const { Type, props } = element;
			replacement = constructStore(Type, props);
			created.push(replacement);
			if (snapshot) getStoreAdm(replacement).loadSnapshot(snapshot);
		}
		return {
			value: replacement,
			retired: Array.isArray(previous) ? previous : previous ? [previous] : [],
		};
	}

	private reconcileStore(
		name: PropertyKey,
		storeElement: StoreElement | null | StoreElement[],
		snapshots = this.getPendingChildSnapshot(name)
	): void {
		this.validateStoreChildValue(storeElement, name);
		const data = this.childStoreDataMap.get(name)!;
		const previous = untracked(() => data.value.get());
		const wasInitialized = data.initialized;
		batchChildChanges((errors) => {
			const created: Store[] = [];
			let plan: ChildStorePlan;
			try {
				plan = Array.isArray(storeElement)
					? this.planStoreList(storeElement, snapshots, previous, created)
					: this.planSingleStore(storeElement, snapshots, previous, created);
			} catch (error) {
				errors.push(error);
				for (const store of created) {
					captureChildError(errors, () => getStoreAdm(store).dispose(true));
				}
				return;
			}

			// Ownership is committed before running callbacks. Failures in those
			// callbacks must not retry construction or abandon the published stores.
			this.finishPendingChildSnapshots(name);
			data.reconciledElement = storeElement;
			data.initialized = true;
			if (plan.value !== previous) {
				if (Array.isArray(plan.value)) Object.freeze(plan.value);
				data.value.set(plan.value);
			}

			for (const store of plan.retired) {
				captureChildError(errors, () => getStoreAdm(store).dispose(true));
			}
			for (const store of created) {
				if (!this.isMounted || this.disposalState !== "active") break;
				const adm = getStoreAdm(store);
				// User callbacks may have synchronously replaced this child again.
				if (!adm.signal.aborted && !adm.isMounted) {
					captureChildError(errors, () => adm.mount(this, name));
				}
			}
			if (!wasInitialized && errors.length) {
				// The lazy initializer's normal notification will not run on error.
				this.snapshotStructureAtom.reportChanged();
			}
			if (debugEnabled) {
				const before = wasInitialized ? previous : undefined;
				const after = this.peekInspectionChild(name).value;
				if (before !== after)
					debugWrite(this.source, name, "child", before, after);
			}
		});
	}

	private updateStore(
		name: PropertyKey,
		restore?: { snapshot: ChildSnapshot | undefined }
	): void {
		// Abort handlers and child cleanups can mutate dependencies before listeners stop.
		if (this.disposalState !== "active") return;
		const childStoreData = this.childStoreDataMap.get(name)!;
		const storeElement = childStoreData.listener
			? childStoreData.computed.get()
			: this.trackStoreGetter(name, childStoreData);
		const initialized = childStoreData.initialized;
		if (
			restore ||
			!initialized ||
			!Object.is(childStoreData.reconciledElement, storeElement)
		) {
			this.reconcileStore(name, storeElement, restore?.snapshot);
			if (!initialized) this.snapshotStructureAtom.reportChanged();
		}
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

	private trackStoreGetter(name: PropertyKey, childStoreData: ChildStoreData) {
		const listener = createListener(() => this.updateStore(name));
		childStoreData.listener = listener;
		try {
			return listener.track(() => childStoreData.computed.get());
		} catch (error) {
			// A failed initial evaluation has no subscription to reuse on retry.
			childStoreData.listener = undefined;
			throw error;
		}
	}

	private getStore(name: PropertyKey): Store | null {
		if (this.disposalState !== "active") {
			throw new Error(
				"r-state-tree: cannot read child stores on a disposed store"
			);
		}
		const childStoreData = this.childStoreDataMap.get(name);
		if (retainedChildRead) {
			if (!childStoreData?.initialized)
				throw new Error(
					"Child requires explicit initialization before retained reads"
				);
			return childStoreData.value.get() as Store | null;
		}

		const data = untracked(() => {
			const data = childStoreData ?? {
				computed: this.getComputedGetter(name),
				value: createSignal<Store | Store[] | null>(null),
			};
			if (!childStoreData) this.childStoreDataMap.set(name, data);
			// Refresh stale descriptors synchronously, including inside a batch before
			// the listener runs. Unchanged descriptors need no reconciliation work.
			this.updateStore(name);
			return data;
		});
		return data.value.get() as Store | null;
	}

	loadSnapshot(snapshot: StoreSnapshot | undefined): void {
		if (snapshot === undefined) return;
		if (!snapshot || typeof snapshot !== "object") {
			throw new Error("r-state-tree: invalid Store snapshot");
		}

		const state = snapshot.state ?? {};
		const children = snapshot.children ?? {};
		untracked(() => {
			batchChildChanges(() => {
				let hasInPlaceStateChange = false;
				const pending = clone(children, "children");
				const realized = new Map<PropertyKey, ChildSnapshot | undefined>();
				for (const [name, data] of this.childStoreDataMap) {
					if (!data.initialized) continue;
					const key = String(name);
					const snapshot = Object.hasOwn(pending, key)
						? pending[key]
						: undefined;
					realized.set(name, snapshot);
					delete pending[key];
				}
				// Only unopened properties retain their input for lazy hydration.
				// A failed explicit restore must not feed future saves or reads.
				this.pendingChildSnapshots = pending;
				this.snapshotStructureAtom.reportChanged();
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
				// child getter. Reconcile using the explicit input even when the
				// descriptor is unchanged.
				for (const [name, snapshot] of realized) {
					this.updateStore(name, { snapshot });
				}
			});
		});
	}

	private snapshotChild(store: Store): StoreChildSnapshot | undefined {
		const snapshot = getStoreAdm(store).getSnapshot();
		if (!snapshot) return undefined;
		return store.key === undefined ? snapshot : { key: store.key, ...snapshot };
	}

	private toJSON(): StoreSnapshot | undefined {
		this.snapshotStructureAtom.reportObserved();
		let state: StoreSnapshot["state"];
		let children: StoreSnapshot["children"];

		Object.keys(this.configuration).forEach((key) => {
			if (getConfigType(this.configuration[key]) === StoreCfgTypes.snapshot) {
				(state ??= {})[key] = clone((this.proxy as any)[key], key);
			}
		});

		this.childStoreDataMap.forEach(({ value }, name) => {
			const stores = value.get();
			const key = String(name);
			let snapshot:
				| StoreChildSnapshot
				| (StoreChildSnapshot | null)[]
				| undefined;
			if (Array.isArray(stores)) {
				const snapshots: (StoreChildSnapshot | null)[] = [];
				for (const store of stores) {
					const child = this.snapshotChild(store);
					if (child || store.key === undefined) snapshots.push(child ?? null);
				}
				if (snapshots.some((child) => child !== null)) snapshot = snapshots;
			} else if (stores) {
				snapshot = this.snapshotChild(stores);
			}
			if (snapshot) (children ??= {})[key] = snapshot;
		});

		Object.entries(this.pendingChildSnapshots).forEach(([key, value]) => {
			if (value) {
				(children ??= {})[key] = clone(value, `children.${key}`);
			}
		});

		if (!state && !children) return undefined;
		const snapshot: StoreSnapshot = {};
		if (state) snapshot.state = state;
		if (children) snapshot.children = children;
		return snapshot;
	}

	getSnapshot(): StoreSnapshot | undefined {
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
		// Bypass caches along the entire provider chain during restricted inspection.
		if (retainedChildRead)
			return this.lookupContextValue(
				contextId,
				provideSymbol,
				defaultValue,
				hasDefault
			);

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

		// An early read may cache the fallback before ownership is established.
		this.contextParentAtom.reportObserved();
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
		if (this.isMounted) this.startReactiveRegistration(registration);

		return () => {
			if (registration.disposed) return;
			registration.disposed = true;
			this.reactiveRegistrations.delete(registration);
			const stop = registration.stop;
			registration.stop = undefined;
			stop?.();
		};
	}

	private startReactiveRegistration(registration: ReactiveRegistration): void {
		if (registration.disposed || registration.stop) return;
		const stop = registration.start();
		// Setup runs synchronously and can dispose the registration before it has a stopper.
		if (registration.disposed) stop();
		else registration.stop = stop;
	}

	private startReactiveRegistrations(): void {
		this.reactiveRegistrations.forEach((registration) => {
			this.startReactiveRegistration(registration);
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
				this.contextParentAtom.reportChanged();
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
		if (this.disposalState !== "active") return;
		if (!internal && !this.isRoot()) {
			throw new Error("r-state-tree: can only dispose root stores");
		}
		this.disposalState = "disposing";
		let errors: unknown[];
		try {
			errors = this.disposeResources();
		} finally {
			// disposeResources stops Store-owned observers. Drop the Store's cache references.
			this.childStoreDataMap.clear();
			this.contextCache.clear();
			this.computedSnapshot = undefined;
			this.pendingChildSnapshots = {};
			this.reactiveRegistrations.clear();
			this.parent = null;
			this.mounted = false;
			this.disposalState = "disposed";
		}
		if (errors.length) {
			throw new AggregateError(errors, "r-state-tree: store disposal failed");
		}
	}

	private disposeResources(): unknown[] {
		const errors: unknown[] = [];
		try {
			this.abortController.abort();
		} catch (error) {
			errors.push(error);
		}
		try {
			batch(() => {
				this.childStoreDataMap.forEach(({ value, listener }) => {
					try {
						listener?.dispose();
					} catch (error) {
						errors.push(error);
					}
					try {
						const stores = value.get();
						const children = Array.isArray(stores)
							? stores
							: stores
								? [stores]
								: [];
						for (const store of children) {
							try {
								getStoreAdm(store).dispose(true);
							} catch (error) {
								errors.push(error);
							}
						}
					} catch (error) {
						errors.push(error);
					}
				});
				this.reactiveRegistrations.forEach((registration) => {
					registration.disposed = true;
					const stop = registration.stop;
					registration.stop = undefined;
					try {
						stop?.();
					} catch (error) {
						errors.push(error);
					}
				});
			});
		} catch (error) {
			// Reactions flushed at the end of the batch may also throw.
			errors.push(error);
		}
		return errors;
	}
}
