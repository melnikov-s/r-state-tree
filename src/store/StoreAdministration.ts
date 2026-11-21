import {
	registerAdministration,
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
import Store, { constructStore, STORE_ELEMENT } from "./Store.js";
import { debugWrite, debugEnabled } from "../observables/internal/debug.js";
import { retainedChildRead } from "../observables/internal/retainedRead.js";
import type {
	StoreConfiguration,
	StoreElement,
	Props,
	StoreSnapshot,
	StoreChildSnapshot,
	StoreSnapshotChange,
} from "../types.js";
import { CommonCfgTypes, StoreCfgTypes } from "../types.js";
import { getConfigType, getConfigurationForCtor } from "../configuration.js";
import {
	clone,
	getPropertyDescriptor,
	hydrateSnapshotValue,
} from "../utils.js";

const MAX_MOUNT_DEPTH = 100;
const EMPTY_STORES: Store[] = [];
const EMPTY_CONFIG: StoreConfiguration<any> = Object.create(null);
type MountFrame = {
	storeName: string;
	childName?: PropertyKey;
};

// Parallel arrays avoid allocating a MountFrame object on every normal mount().
const mountingStores: StoreAdministration[] = [];
const mountingChildNames: (PropertyKey | undefined)[] = [];

function formatMountFrame(frame: MountFrame): string {
	const childSegment =
		frame.childName === undefined ? "" : `.${String(frame.childName)}`;
	return `${frame.storeName}${childSegment}`;
}

function getStoreName(adm: StoreAdministration): string {
	return (adm.proxy.constructor as { name?: string }).name || "Store";
}

function formatMountChain(frame: MountFrame): string {
	const total = mountingStores.length + 1;
	const chain: MountFrame[] = new Array(total);
	for (let i = 0; i < mountingStores.length; i++) {
		chain[i] = {
			storeName: getStoreName(mountingStores[i]),
			childName: mountingChildNames[i],
		};
	}
	chain[total - 1] = frame;
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

function updatePropsByAdm(
	adm: ObjectAdministration<Props>,
	newProps: Props
): void {
	if (debugEnabled) {
		const proxy = adm.proxy;
		for (const key in newProps) {
			if (Object.prototype.hasOwnProperty.call(newProps, key)) {
				proxy[key] = newProps[key];
			}
		}
		return;
	}
	const source = adm.source;
	for (const key in newProps) {
		if (!Object.prototype.hasOwnProperty.call(newProps, key)) continue;
		const val = newProps[key];
		const isObj = typeof val === "object" && val !== null;
		if (isObj) {
			const valAdm = getAdministration(val);
			if (valAdm && valAdm.proxy === val) {
				if (
					adm.hasExplicitObservable(key) &&
					Object.prototype.hasOwnProperty.call(source, key) &&
					source[key] === valAdm.source
				) {
					continue;
				}
				adm.write(key, val);
				continue;
			}
		}
		if (
			Object.prototype.hasOwnProperty.call(source, key) &&
			source[key] === val &&
			!adm.hasExplicitObservable(key)
		) {
			continue;
		}
		adm.write(key, val);
	}
}

function updateRawProps(adm: StoreAdministration, newProps: Props): void {
	const source = (adm.source as any).props as Record<string, unknown>;
	let explicitKeys = adm._propsExplicitKeys;
	for (const key in newProps) {
		if (!Object.prototype.hasOwnProperty.call(newProps, key)) continue;
		const val = newProps[key];
		if (
			source[key] === val &&
			!explicitKeys?.has(key) &&
			Object.prototype.hasOwnProperty.call(source, key)
		) {
			continue;
		}
		if (typeof val === "object" && val !== null) {
			const valAdm = getAdministration(val);
			if (valAdm && valAdm.proxy === val) {
				(explicitKeys ??= adm._propsExplicitKeys = new Set()).add(key);
				source[key] = valAdm.source;
				continue;
			}
		}
		explicitKeys?.delete(key);
		source[key] = val;
	}
}

function updateStoreProps(adm: StoreAdministration, newProps: Props): void {
	if (adm.propsAdm) {
		updatePropsByAdm(adm.propsAdm, newProps);
	} else if (debugEnabled) {
		updatePropsInner(adm.proxy.props, newProps);
	} else {
		updateRawProps(adm, newProps);
	}
}
function updatePropsInner(props: Props, newProps: Props): void {
	const adm = getAdministration(props);
	if (adm) {
		updatePropsByAdm(adm, newProps);
		return;
	}
	for (const key in newProps) {
		if (Object.prototype.hasOwnProperty.call(newProps, key)) {
			props[key] = newProps[key];
		}
	}
}

export function updateProps(props: Props, newProps: Props): void {
	untracked(() => {
		batch(() => {
			updatePropsInner(props, newProps);
		});
	});
}

export function getStoreAdm(store: Store): StoreAdministration {
	return getAdministration(store) as unknown as StoreAdministration;
}

function isStoreElement(value: unknown): value is StoreElement {
	if (typeof value !== "object" || value === null) return false;
	if ((value as any)[STORE_ELEMENT] === true) return true;
	return (
		"Type" in value &&
		"props" in value &&
		typeof (value as any).Type === "function" &&
		typeof (value as any).props === "object"
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
		const len = value.length;
		let keys: Set<unknown> | undefined;
		for (let i = 0; i < len; i++) {
			const item = value[i];
			if (item === null || item === undefined) continue;
			if (!isStoreElement(item)) {
				throw new Error(
					`r-state-tree: child property '${String(
						propertyName
					)}' must be a StoreElement ({ Type, props, key }), an array of StoreElements, or null/undefined. Found invalid array item: ${typeof item}`
				);
			}
			const key = item.key;
			if (key !== undefined) {
				if (keys === undefined) {
					keys = new Set();
					keys.add(key);
				} else {
					const prevSize = keys.size;
					keys.add(key);
					if (keys.size === prevSize) {
						const formattedKey =
							typeof key === "string" ? JSON.stringify(key) : String(key);
						throw new Error(
							`r-state-tree: duplicate key ${formattedKey} in child property ${JSON.stringify(
								String(propertyName)
							)} of ${parentTypeName}`
						);
					}
				}
			}
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
	peek: () => StoreElement | null | StoreElement[];
	listener?: ListenerNode;
	keyedStores?: Map<string | number, Store>;
};

type ChildSnapshot = NonNullable<StoreSnapshot["children"]>[string];

type ChildStorePlan = {
	value: Store | Store[] | null;
	retired: Iterable<Store>;
	keyedStores?: Map<string | number, Store>;
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
	effectFn?: () => void | (() => void);
	start?: () => () => void;
	stop?: () => void;
	disposed: boolean;
};

export class StoreAdministration<
	StoreType extends Store = Store,
> extends ObjectAdministration<Store> {
	private static pendingStores: StoreAdministration[] = [];
	private static pendingDepths: number[] = [];
	private static isFlushingActivations = false;
	private static currentActivationDepth = 0;

	private static drainPendingActivations(): void {
		const stores = this.pendingStores;
		const depths = this.pendingDepths;
		this.isFlushingActivations = true;
		try {
			for (let i = 0; i < stores.length; i++) {
				const depth = depths[i];
				this.currentActivationDepth = depth;
				if (depth > MAX_MOUNT_DEPTH) {
					throw createCircularMountError({
						storeName: getStoreName(stores[i]),
					});
				}
				stores[i].startReactiveRegistrations();
			}
		} finally {
			stores.length = 0;
			depths.length = 0;
			this.currentActivationDepth = 0;
			this.isFlushingActivations = false;
		}
	}

	private static flushSingleReactiveRegistration(
		store: StoreAdministration
	): void {
		if (this.isFlushingActivations) {
			this.pendingStores.push(store);
			this.pendingDepths.push(this.currentActivationDepth + 1);
			return;
		}
		this.pendingStores.push(store);
		this.pendingDepths.push(0);
		this.drainPendingActivations();
	}

	private static flushReactiveRegistrations(
		stores: StoreAdministration[]
	): void {
		const depth = this.isFlushingActivations
			? this.currentActivationDepth + 1
			: 0;
		const queue = this.pendingStores;
		const depths = this.pendingDepths;
		for (let i = 0; i < stores.length; i++) {
			queue.push(stores[i]);
			depths.push(depth);
		}

		if (this.isFlushingActivations) return;

		this.drainPendingActivations();
	}

	static proxyTraps: ProxyHandler<object> = Object.assign(
		{},
		ObjectAdministration.proxyTraps,
		{
			get(target, name, receiver) {
				if (name === "key") {
					return (target as Store).key;
				}
				if (name === Symbol.dispose) {
					return Reflect.get(target, name);
				}

				const adm = getAdministration(target) as StoreAdministration;
				if (adm._lastChildName === name) {
					return adm.getCachedStore(adm._lastChildData!);
				}
				if (name === "props") {
					adm.ensurePropsObservable();
					return ObjectAdministration.trapGet(adm, name, receiver);
				}
				if (
					!debugEnabled &&
					(name === "effect" || name === "reaction") &&
					!Object.prototype.hasOwnProperty.call(target, name) &&
					(target as any)[name] === (Store.prototype as any)[name]
				) {
					return (Store.prototype as any)[name];
				}
				if (adm.configurationGetter) {
					const cfg = adm.configurationGetter()[name as string];
					if (
						cfg !== undefined &&
						getConfigType(cfg) === CommonCfgTypes.child
					) {
						return adm.getStore(name);
					}
				} else {
					const cfg = adm._config[name as string];
					if (cfg !== undefined && (cfg as any).type === CommonCfgTypes.child) {
						return adm.getStore(name);
					}
				}
				return ObjectAdministration.trapGet(adm, name, receiver);
			},

			set(target, name, value, receiver) {
				if (name === "props") {
					throw new Error(`r-state-tree: ${name} is read-only`);
				}

				return ObjectAdministration.trapSet(
					getAdministration(target) as StoreAdministration,
					name,
					value,
					receiver
				);
			},
		} as ProxyHandler<object>
	);

	protected override _cleanOwnDescriptors = true;
	parent: StoreAdministration | null = null;
	/** @internal Direct reference to props ObjectAdministration, materialized lazily on store.props access. */
	propsAdm?: ObjectAdministration<Props>;
	/** @internal Observable prop keys recorded before propsAdm is materialized. */
	_propsExplicitKeys?: Set<string>;
	private _abortController?: AbortController;
	private _disposedSignal?: AbortSignal;
	private mounted = false;
	private disposalState: "active" | "disposing" | "disposed" = "active";
	private _contextCache?: Map<symbol, ComputedNode<unknown>>;
	private _contextParentAtom?: AtomNode;
	private _childStoreDataMap?: Map<PropertyKey, ChildStoreData>;
	private _lastChildName: PropertyKey | undefined = undefined;
	private _lastChildData: ChildStoreData | undefined = undefined;
	private _reactiveRegistrations?: ReactiveRegistration[];

	/** @internal Materialize the observable proxy for store.props on first access. */
	ensurePropsObservable(): void {
		if (this.propsAdm) return;
		const propsSource = (this.source as any).props as Props | undefined;
		if (typeof propsSource !== "object" || propsSource === null) return;
		const existing = getAdministration(propsSource) as
			| ObjectAdministration<Props>
			| undefined;
		if (existing) {
			this.propsAdm = existing;
			return;
		}
		const propsAdm = registerAdministration(
			new ObjectAdministration(propsSource)
		);
		if (this._propsExplicitKeys) {
			for (const key of this._propsExplicitKeys) {
				propsAdm.markExplicitObservable(key);
			}
			this._propsExplicitKeys = undefined;
		}
		this.propsAdm = propsAdm;
	}
	private configurationGetter?: () => StoreConfiguration<StoreType>;
	private _config: StoreConfiguration<StoreType> = EMPTY_CONFIG;
	private computedSnapshot?: ComputedNode<StoreSnapshot | undefined>;
	private _snapshotStructureAtom?: AtomNode;
	private _pendingChildSnapshots?: NonNullable<StoreSnapshot["children"]>;

	/** @internal */
	get contextCache(): Map<symbol, ComputedNode<unknown>> {
		return (this._contextCache ??= new Map());
	}

	get signal(): AbortSignal {
		if (this._abortController) return this._abortController.signal;
		if (this.disposalState !== "active") {
			return (this._disposedSignal ??= AbortSignal.abort());
		}
		this._abortController = new AbortController();
		return this._abortController.signal;
	}

	setCtor(ctor: Function): void {
		this._config = getConfigurationForCtor(
			ctor
		) as StoreConfiguration<StoreType>;
	}

	setConfiguration(
		configurationGetter: () => StoreConfiguration<StoreType>
	): void {
		this.configurationGetter = configurationGetter;
	}

	private get configuration(): StoreConfiguration<StoreType> {
		return this.configurationGetter ? this.configurationGetter() : this._config;
	}

	protected override getInstanceConfig(): Record<PropertyKey, any> {
		return this.configuration;
	}

	/** Retained metadata only: does not evaluate child getters. */
	getInspectionMetadata() {
		const config = this.configuration;
		return {
			fields: Reflect.ownKeys(config).map((key) => ({
				key,
				type: getConfigType(config[key as string]),
			})),
			parent: this.parent?.proxy ?? null,
			status:
				this.disposalState !== "active"
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
		const data = this._childStoreDataMap?.get(name);
		return data?.initialized
			? { initialized: true, value: untracked(() => data.value.get()) }
			: { initialized: false };
	}

	private getPendingChildSnapshot(name: PropertyKey) {
		const pending = this._pendingChildSnapshots;
		if (!pending) return undefined;
		const propertyName = String(name);
		return Object.prototype.hasOwnProperty.call(pending, propertyName)
			? pending[propertyName]
			: undefined;
	}

	private matchChildSnapshots(snapshots: ChildSnapshot | undefined) {
		if (!snapshots) return undefined;

		const keyed = new Map<string | number, StoreChildSnapshot>();
		const positional: (StoreChildSnapshot | null)[] = [];
		const list = Array.isArray(snapshots) ? snapshots : [snapshots];
		for (let i = 0; i < list.length; i++) {
			const snapshot = list[i];
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
			delete this._pendingChildSnapshots![String(name)];
			if (this._childStoreDataMap?.get(name)?.initialized) {
				this._snapshotStructureAtom?.reportChanged();
			}
		}
	}

	private validateStoreChildValue(value: unknown, name: PropertyKey): void {
		validateStoreChildValue(value, name, getStoreName(this));
	}

	private planStoreList(
		elements: Array<StoreElement | null>,
		snapshots: ChildSnapshot | undefined,
		previous: Store | Store[] | null,
		created: Store[],
		cachedKeyed?: Map<string | number, Store>
	): ChildStorePlan {
		const matchSnapshot = this.matchChildSnapshots(snapshots);

		// Fast path: initial realization with no previous children
		if (!previous || (Array.isArray(previous) && previous.length === 0)) {
			const stores: Store[] = [];
			for (let i = 0; i < elements.length; i++) {
				const element = elements[i];
				if (!element) continue;
				const store = constructStore(element.Type, element.props);
				created.push(store);
				if (matchSnapshot) {
					const snapshot = matchSnapshot(element.key);
					if (snapshot) getStoreAdm(store).loadSnapshot(snapshot);
				}
				stores.push(store);
			}
			const unchanged = Array.isArray(previous) && stores.length === 0;
			return { value: unchanged ? previous : stores, retired: EMPTY_STORES };
		}

		const isPrevArray = Array.isArray(previous);
		const oldStores = isPrevArray ? previous : EMPTY_STORES;
		const oldLen = oldStores.length;
		const stores: Store[] = [];
		const updateStores: Store[] = [];
		const updatePropsList: Props[] = [];
		const updateSnapshots:
			| (StoreChildSnapshot | null | undefined)[]
			| undefined = matchSnapshot ? [] : undefined;
		let keyed = cachedKeyed;
		if (!keyed && oldLen > 0) {
			for (let i = 0; i < oldLen; i++) {
				const store = oldStores[i];
				const k = store.key;
				if (k !== undefined) {
					(keyed ??= new Map()).set(k, store);
				}
			}
		}

		for (let i = 0; i < elements.length; i++) {
			const element = elements[i];
			if (!element) continue;
			const { key, props, Type } = element;
			// Descriptors without a child do not occupy a realized position.
			const old =
				key === undefined ? oldStores[stores.length] : keyed?.get(key);
			const snapshot = matchSnapshot?.(key);
			if (
				(key !== undefined || old?.key === undefined) &&
				old instanceof Type
			) {
				updateStores.push(old);
				updatePropsList.push(props);
				if (updateSnapshots) updateSnapshots.push(snapshot);
				stores.push(old);
			} else {
				const store = constructStore(Type, props);
				created.push(store);
				if (snapshot) getStoreAdm(store).loadSnapshot(snapshot);
				stores.push(store);
			}
		}

		const reusedCount = updateStores.length;
		for (let i = 0; i < reusedCount; i++) {
			const storeAdm = getStoreAdm(updateStores[i]);
			updateStoreProps(storeAdm, updatePropsList[i]);
			const snapshot = updateSnapshots?.[i];
			if (snapshot) storeAdm.loadSnapshot(snapshot);
		}

		let retired: Iterable<Store>;
		if (!isPrevArray) {
			retired = [previous];
		} else if (reusedCount === oldLen) {
			retired = EMPTY_STORES;
		} else if (reusedCount === 0) {
			retired = oldStores;
		} else {
			const reusedSet = new Set(updateStores);
			const retiredList: Store[] = [];
			for (let i = 0; i < oldLen; i++) {
				if (!reusedSet.has(oldStores[i])) retiredList.push(oldStores[i]);
			}
			retired = retiredList;
		}

		let unchanged = isPrevArray && stores.length === oldLen;
		if (unchanged) {
			for (let i = 0; i < stores.length; i++) {
				if (stores[i] !== oldStores[i]) {
					unchanged = false;
					break;
				}
			}
		}
		return {
			value: unchanged ? oldStores : stores,
			retired,
			keyedStores: keyed,
		};
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
			oldStore?.key === element.key &&
			oldStore instanceof element.Type
		) {
			const oldAdm = getStoreAdm(oldStore);
			updateStoreProps(oldAdm, element.props);
			if (snapshot) oldAdm.loadSnapshot(snapshot);
			return { value: oldStore, retired: EMPTY_STORES };
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
			retired: Array.isArray(previous)
				? previous
				: previous
					? [previous]
					: EMPTY_STORES,
		};
	}

	private reconcileStore(
		name: PropertyKey,
		storeElement: StoreElement | null | StoreElement[],
		snapshots = this.getPendingChildSnapshot(name)
	): void {
		this.validateStoreChildValue(storeElement, name);
		const data = this._childStoreDataMap!.get(name)!;
		const previous = untracked(() => data.value.get());
		const wasInitialized = data.initialized;
		batchChildChanges((errors) => {
			const created: Store[] = [];
			let plan: ChildStorePlan;
			try {
				plan = Array.isArray(storeElement)
					? this.planStoreList(
							storeElement,
							snapshots,
							previous,
							created,
							data.keyedStores
						)
					: this.planSingleStore(storeElement, snapshots, previous, created);
			} catch (error) {
				errors.push(error);
				for (let i = 0; i < created.length; i++) {
					captureChildError(errors, () =>
						getStoreAdm(created[i]).dispose(true)
					);
				}
				return;
			}

			// Ownership is committed before running callbacks. Failures in those
			// callbacks must not retry construction or abandon the published stores.
			this.finishPendingChildSnapshots(name);
			data.reconciledElement = storeElement;
			data.initialized = true;
			if (Array.isArray(plan.value)) {
				if (plan.value.length === 0) {
					data.keyedStores = undefined;
				} else if (created.length === 0 && plan.retired === EMPTY_STORES) {
					if (plan.keyedStores) data.keyedStores = plan.keyedStores;
				} else if (plan.keyedStores) {
					const keyed = plan.keyedStores;
					if (plan.retired === previous) {
						keyed.clear();
					} else {
						for (const store of plan.retired) {
							const k = store.key;
							if (k !== undefined && keyed.get(k) === store) {
								keyed.delete(k);
							}
						}
					}
					for (let i = 0; i < created.length; i++) {
						const store = created[i];
						const k = store.key;
						if (k !== undefined) keyed.set(k, store);
					}
					data.keyedStores = keyed.size > 0 ? keyed : undefined;
				} else {
					data.keyedStores = undefined;
				}
			} else {
				data.keyedStores = undefined;
			}
			if (plan.value !== previous) {
				if (Array.isArray(plan.value)) Object.freeze(plan.value);
				data.value.set(plan.value);
			}

			for (const store of plan.retired) {
				captureChildError(errors, () => getStoreAdm(store).dispose(true));
			}
			for (let i = 0; i < created.length; i++) {
				if (!this.isMounted || this.disposalState !== "active") break;
				const adm = getStoreAdm(created[i]);
				// User callbacks may have synchronously replaced this child again.
				if (adm.disposalState === "active" && !adm.isMounted) {
					captureChildError(errors, () => adm.mount(this, name));
				}
			}
			if (!wasInitialized && errors.length) {
				// The lazy initializer's normal notification will not run on error.
				this._snapshotStructureAtom?.reportChanged();
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
		const childStoreData = this._childStoreDataMap!.get(name)!;
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
			if (!initialized) this._snapshotStructureAtom?.reportChanged();
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

	private getCachedStore(childStoreData: ChildStoreData): Store | null {
		if (this.disposalState !== "active") {
			throw new Error(
				"r-state-tree: cannot read child stores on a disposed store"
			);
		}
		if (retainedChildRead) {
			if (!childStoreData.initialized)
				throw new Error(
					"Child requires explicit initialization before retained reads"
				);
			return childStoreData.value.node!.value as Store | null;
		}
		if (
			childStoreData.initialized &&
			childStoreData.listener &&
			Object.is(
				childStoreData.reconciledElement,
				untracked(childStoreData.peek)
			)
		) {
			return childStoreData.value.node!.value as Store | null;
		}
		return this.getStore(this._lastChildName!);
	}

	private getStore(name: PropertyKey): Store | null {
		if (this.disposalState !== "active") {
			throw new Error(
				"r-state-tree: cannot read child stores on a disposed store"
			);
		}
		const childStoreData =
			this._lastChildName === name
				? this._lastChildData
				: this._childStoreDataMap?.get(name);
		if (retainedChildRead) {
			if (!childStoreData?.initialized)
				throw new Error(
					"Child requires explicit initialization before retained reads"
				);
			return childStoreData.value.node!.value as Store | null;
		}

		// Steady-state fast path: zero closure/Map/try-finally overhead when already initialized & fresh.
		if (childStoreData?.initialized && childStoreData.listener) {
			if (
				Object.is(
					childStoreData.reconciledElement,
					untracked(childStoreData.peek)
				)
			) {
				return childStoreData.value.node!.value as Store | null;
			}
		}

		if (this._constructing) this._constructing = false;

		const data = untracked(() => {
			let d = childStoreData;
			if (!d) {
				const computed = this.getComputedGetter(name);
				d = {
					computed,
					peek: () => computed.get(),
					value: createSignal<Store | Store[] | null>(null),
				};
				(this._childStoreDataMap ??= new Map()).set(name, d);
			}
			this._lastChildName = name;
			this._lastChildData = d;
			// Refresh stale descriptors synchronously, including inside a batch before
			// the listener runs. Unchanged descriptors need no reconciliation work.
			this.updateStore(name);
			return d;
		});
		return data.value.node!.value as Store | null;
	}

	loadSnapshot(snapshot: StoreSnapshot | undefined): void {
		if (snapshot === undefined) return;
		if (!snapshot || typeof snapshot !== "object") {
			throw new Error("r-state-tree: invalid Store snapshot");
		}

		const state = snapshot.state;
		const children = snapshot.children;
		untracked(() => {
			batchChildChanges(() => {
				let hasInPlaceStateChange = false;
				const pending = children ? clone(children, "children") : undefined;
				let realized: Map<PropertyKey, ChildSnapshot | undefined> | undefined;
				if (this._childStoreDataMap) {
					for (const [name, data] of this._childStoreDataMap) {
						if (!data.initialized) continue;
						const key = String(name);
						const childSnapshot =
							pending && Object.hasOwn(pending, key) ? pending[key] : undefined;
						(realized ??= new Map()).set(name, childSnapshot);
						if (pending) delete pending[key];
					}
				}
				// Only unopened properties retain their input for lazy hydration.
				// A failed explicit restore must not feed future saves or reads.
				this._pendingChildSnapshots = pending;
				this._snapshotStructureAtom?.reportChanged();
				if (state) {
					const config = this.configuration;
					for (const key in state) {
						if (!Object.prototype.hasOwnProperty.call(state, key)) continue;
						if (getConfigType(config[key]) !== StoreCfgTypes.snapshot) {
							console.warn(
								`r-state-tree: Store snapshot key '${key}' is not decorated with @snapshot and was ignored.`
							);
							continue;
						}
						const currentValue = (this.proxy as any)[key];
						const incoming = state[key];
						if (
							(currentValue === null || typeof currentValue !== "object") &&
							(incoming === null || typeof incoming !== "object")
						) {
							const cloned =
								incoming === null ||
								incoming === undefined ||
								typeof incoming === "string" ||
								typeof incoming === "number" ||
								typeof incoming === "boolean"
									? incoming
									: clone(incoming, `state.${key}`);
							(this.proxy as any)[key] = cloned;
							continue;
						}
						const changeTracker = { changed: false };
						const hydratedValue = hydrateSnapshotValue(
							currentValue,
							clone(incoming, `state.${key}`),
							changeTracker
						);
						(this.proxy as any)[key] = hydratedValue;
						if (
							changeTracker.changed &&
							Object.is(currentValue, hydratedValue)
						) {
							hasInPlaceStateChange = true;
						}
					}
				}
				if (hasInPlaceStateChange) {
					this.reportChanged();
				}
				// Hydrated state can select a different Type from an already-realized
				// child getter. Reconcile using the explicit input even when the
				// descriptor is unchanged.
				if (realized) {
					for (const [name, childSnapshot] of realized) {
						this.updateStore(name, { snapshot: childSnapshot });
					}
				}
			});
		});
	}

	private snapshotChild(store: Store): StoreChildSnapshot | undefined {
		const snapshot = getStoreAdm(store).getSnapshot();
		if (!snapshot) return undefined;
		const key = store.key;
		return key === undefined ? snapshot : { key, ...snapshot };
	}

	private toJSON(): StoreSnapshot | undefined {
		(this._snapshotStructureAtom ??= createAtom()).reportObserved();
		let state: StoreSnapshot["state"];
		let children: StoreSnapshot["children"];

		const config = this.configuration;
		for (const key in config) {
			if (
				Object.prototype.hasOwnProperty.call(config, key) &&
				getConfigType(config[key]) === StoreCfgTypes.snapshot
			) {
				const val = (this.proxy as any)[key];
				(state ??= {})[key] =
					val === null ||
					val === undefined ||
					typeof val === "string" ||
					typeof val === "number" ||
					typeof val === "boolean"
						? val
						: clone(val, key);
			}
		}

		if (this._childStoreDataMap) {
			for (const [name, { value }] of this._childStoreDataMap) {
				const stores = value.get();
				const key = String(name);
				let snapshot:
					| StoreChildSnapshot
					| (StoreChildSnapshot | null)[]
					| undefined;
				if (Array.isArray(stores)) {
					const snapshots: (StoreChildSnapshot | null)[] = [];
					let hasNonNull = false;
					for (let i = 0; i < stores.length; i++) {
						const store = stores[i];
						const child = this.snapshotChild(store);
						if (child) {
							snapshots.push(child);
							hasNonNull = true;
						} else if (store.key === undefined) {
							snapshots.push(null);
						}
					}
					if (hasNonNull) snapshot = snapshots;
				} else if (stores) {
					snapshot = this.snapshotChild(stores);
				}
				if (snapshot) (children ??= {})[key] = snapshot;
			}
		}

		const pending = this._pendingChildSnapshots;
		if (pending) {
			for (const key in pending) {
				if (!Object.prototype.hasOwnProperty.call(pending, key)) continue;
				const value = pending[key];
				if (value) {
					(children ??= {})[key] = clone(value, `children.${key}`);
				}
			}
		}

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
		const cache = (this._contextCache ??= new Map());
		let computed = cache.get(contextId);

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
			cache.set(contextId, computed);
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
		(this._contextParentAtom ??= createAtom()).reportObserved();
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

	private addRegistration(registration: ReactiveRegistration): () => void {
		if (this.disposalState !== "active") {
			throw new Error(
				"r-state-tree: cannot register reactive resources on a disposed store"
			);
		}
		const registrations = (this._reactiveRegistrations ??= []);
		registrations.push(registration);
		if (this.isMounted) this.startReactiveRegistration(registration);

		return () => {
			if (registration.disposed) return;
			registration.disposed = true;
			const idx = registrations.indexOf(registration);
			if (idx !== -1) registrations.splice(idx, 1);
			const stop = registration.stop;
			registration.stop = undefined;
			stop?.();
		};
	}

	private startReactiveRegistration(registration: ReactiveRegistration): void {
		if (registration.disposed || registration.stop) return;
		const stop = registration.effectFn
			? effect(registration.effectFn)
			: registration.start!();
		// Setup runs synchronously and can dispose the registration before it has a stopper.
		if (registration.disposed) stop();
		else registration.stop = stop;
	}

	private startReactiveRegistrations(): void {
		const regs = this._reactiveRegistrations;
		if (!regs || regs.length === 0) return;
		if (regs.length === 1) {
			this.startReactiveRegistration(regs[0]);
			return;
		}
		// Copy in case a registration disposes itself and splices the array.
		const snapshot = regs.slice();
		for (let i = 0; i < snapshot.length; i++) {
			this.startReactiveRegistration(snapshot[i]);
		}
	}

	reaction<T>(
		track: () => T,
		callback: (value: T, previousValue: T) => void
	): () => void {
		return this.addRegistration({
			start: () => reaction(track, callback),
			disposed: false,
		});
	}

	effect(callback: () => void | (() => void)): () => void {
		return this.addRegistration({
			effectFn: callback,
			disposed: false,
		});
	}

	mount(
		parent: StoreAdministration | null = null,
		childName?: PropertyKey,
		activationQueue?: StoreAdministration[]
	): void {
		if (this.disposalState !== "active") {
			throw new Error("r-state-tree: cannot mount a disposed store");
		}
		if (this.isMounted) {
			throw new Error("r-state-tree: store is already mounted");
		}

		if (mountingStores.length + 1 > MAX_MOUNT_DEPTH) {
			throw createCircularMountError({
				storeName: getStoreName(this),
				childName,
			});
		}

		mountingStores.push(this);
		mountingChildNames.push(childName);
		const isOutermostMount = activationQueue === undefined;
		try {
			// Fast path for leaf stores with no child stores or context parent observers.
			if (
				isOutermostMount &&
				!this._childStoreDataMap &&
				!this._contextParentAtom
			) {
				this.parent = parent || null;
				this.mounted = true;
				if (
					this._reactiveRegistrations &&
					this._reactiveRegistrations.length > 0
				) {
					StoreAdministration.flushSingleReactiveRegistration(this);
				}
				return;
			}

			const registrationsToStart = activationQueue ?? [];
			const doMount = () => {
				this.parent = parent || null;
				this._contextParentAtom?.reportChanged();
				if (this._childStoreDataMap) {
					for (const [name, { value }] of this._childStoreDataMap) {
						const stores = value.get();
						if (Array.isArray(stores)) {
							for (let i = 0; i < stores.length; i++) {
								getStoreAdm(stores[i])?.mount(this, name, registrationsToStart);
							}
						} else if (stores) {
							getStoreAdm(stores)?.mount(this, name, registrationsToStart);
						}
					}
				}
				this.mounted = true;
				if (
					this._reactiveRegistrations &&
					this._reactiveRegistrations.length > 0
				) {
					registrationsToStart.push(this);
				}
			};
			if (
				isOutermostMount &&
				(this._childStoreDataMap || this._contextParentAtom)
			) {
				batch(doMount);
			} else {
				doMount();
			}
			if (isOutermostMount && registrationsToStart.length > 0) {
				StoreAdministration.flushReactiveRegistrations(registrationsToStart);
			}
		} catch (error) {
			if (
				error instanceof Error &&
				((error instanceof RangeError && /call stack/i.test(error.message)) ||
					/cycle detected/i.test(error.message))
			) {
				throw createCircularMountError({
					storeName: getStoreName(this),
					childName,
				});
			}
			throw error;
		} finally {
			mountingStores.pop();
			mountingChildNames.pop();
		}
	}

	dispose(internal = false): void {
		if (this.disposalState !== "active") return;
		if (!internal && !this.isRoot()) {
			throw new Error("r-state-tree: can only dispose root stores");
		}
		this.disposalState = "disposing";
		let errors: unknown[] | undefined;
		try {
			errors = this.disposeResources(internal);
		} finally {
			// disposeResources stops Store-owned observers. Drop the Store's cache references.
			this._childStoreDataMap?.clear();
			this._lastChildName = undefined;
			this._lastChildData = undefined;
			this._contextCache?.clear();
			this.computedSnapshot = undefined;
			this._pendingChildSnapshots = undefined;
			if (this._reactiveRegistrations) this._reactiveRegistrations.length = 0;
			this.parent = null;
			this.mounted = false;
			this.disposalState = "disposed";
		}
		if (errors && errors.length) {
			throw new AggregateError(errors, "r-state-tree: store disposal failed");
		}
	}

	private cleanupResources(
		errors: unknown[] | undefined
	): unknown[] | undefined {
		if (this._childStoreDataMap) {
			for (const { value, listener } of this._childStoreDataMap.values()) {
				if (listener) {
					try {
						listener.dispose();
					} catch (error) {
						(errors ??= []).push(error);
					}
				}
				try {
					const stores = value.get();
					if (Array.isArray(stores)) {
						for (let i = 0; i < stores.length; i++) {
							try {
								getStoreAdm(stores[i]).dispose(true);
							} catch (error) {
								(errors ??= []).push(error);
							}
						}
					} else if (stores) {
						try {
							getStoreAdm(stores).dispose(true);
						} catch (error) {
							(errors ??= []).push(error);
						}
					}
				} catch (error) {
					(errors ??= []).push(error);
				}
			}
		}
		const regs = this._reactiveRegistrations;
		if (regs) {
			for (let i = 0; i < regs.length; i++) {
				const registration = regs[i];
				registration.disposed = true;
				const stop = registration.stop;
				registration.stop = undefined;
				if (stop) {
					try {
						stop();
					} catch (error) {
						(errors ??= []).push(error);
					}
				}
			}
		}
		return errors;
	}

	private disposeResources(inBatch: boolean): unknown[] | undefined {
		if (
			!this._abortController &&
			!this._childStoreDataMap &&
			!this._reactiveRegistrations
		) {
			return undefined;
		}
		let errors: unknown[] | undefined;
		if (this._abortController) {
			try {
				this._abortController.abort();
			} catch (error) {
				(errors ??= []).push(error);
			}
		}
		if (inBatch) {
			errors = this.cleanupResources(errors);
		} else {
			try {
				batch(() => {
					errors = this.cleanupResources(errors);
				});
			} catch (error) {
				// Reactions flushed at the end of the batch may also throw.
				(errors ??= []).push(error);
			}
		}
		return errors;
	}
}
