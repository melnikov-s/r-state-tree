import { batch, untracked } from "../observables/index.js";
import type { SignalNode } from "../observables/index.js";
import { debugEnabled, debugWrite } from "../observables/internal/debug.js";
import type {
	Props,
	StoreChildSnapshot,
	StoreElement,
	StoreSnapshot,
} from "../types.js";
import { constructStore, getStoreAdm, STORE_ELEMENT } from "./Store.js";
import type Store from "./Store.js";
import type { StoreAdministration } from "./StoreAdministration.js";
import { updateStoreProps } from "./storeProps.js";

const EMPTY_STORES: Store[] = [];

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

export function validateStoreChildValue(
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

type ChildElements = StoreElement | null | StoreElement[];

export type ChildSlot = {
	initialized?: boolean;
	reconciledElement?: ChildElements;
	value: SignalNode<Store | null | Store[]>;
	keyedStores?: Map<string | number, Store>;
};

export type ChildSnapshot = NonNullable<StoreSnapshot["children"]>[string];

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

export function batchChildChanges(
	operation: (errors: unknown[]) => void
): void {
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

function matchChildSnapshots(snapshots: ChildSnapshot | undefined) {
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

function planStoreList(
	elements: Array<StoreElement | null>,
	snapshots: ChildSnapshot | undefined,
	previous: Store | Store[] | null,
	created: Store[],
	cachedKeyed?: Map<string | number, Store>
): ChildStorePlan {
	const matchSnapshot = matchChildSnapshots(snapshots);

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
	const updateSnapshots: (StoreChildSnapshot | null | undefined)[] | undefined =
		matchSnapshot ? [] : undefined;
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
		const old = key === undefined ? oldStores[stores.length] : keyed?.get(key);
		const snapshot = matchSnapshot?.(key);
		if ((key !== undefined || old?.key === undefined) && old instanceof Type) {
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

function planSingleStore(
	element: StoreElement | null,
	snapshots: ChildSnapshot | undefined,
	previous: Store | Store[] | null,
	created: Store[]
): ChildStorePlan {
	const oldStore = Array.isArray(previous) ? null : previous;
	const snapshot = element
		? matchChildSnapshots(snapshots)?.(element.key)
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

function updateKeyedStores(
	data: ChildSlot,
	plan: ChildStorePlan,
	previous: Store | Store[] | null,
	created: Store[]
): void {
	if (!Array.isArray(plan.value) || plan.value.length === 0) {
		data.keyedStores = undefined;
		return;
	}

	const keyed = plan.keyedStores;
	if (created.length === 0 && plan.retired === EMPTY_STORES) {
		// No ownership changes; keep the existing index or cache the one just built.
		if (keyed) data.keyedStores = keyed;
		return;
	}
	if (!keyed) {
		data.keyedStores = undefined;
		return;
	}

	if (plan.retired === previous) {
		keyed.clear();
	} else {
		for (const store of plan.retired) {
			const key = store.key;
			if (key !== undefined && keyed.get(key) === store) {
				keyed.delete(key);
			}
		}
	}
	for (let i = 0; i < created.length; i++) {
		const store = created[i];
		const key = store.key;
		if (key !== undefined) keyed.set(key, store);
	}
	data.keyedStores = keyed.size > 0 ? keyed : undefined;
}

/** Reconcile a validated descriptor without observing or re-reading its getter. */
export function reconcileChildStores(
	parent: StoreAdministration,
	name: PropertyKey,
	data: ChildSlot,
	storeElement: ChildElements,
	snapshots: ChildSnapshot | undefined
): void {
	const previous = untracked(() => data.value.get());
	const wasInitialized = data.initialized;
	batchChildChanges((errors) => {
		const created: Store[] = [];
		let plan: ChildStorePlan;
		try {
			plan = Array.isArray(storeElement)
				? planStoreList(
						storeElement,
						snapshots,
						previous,
						created,
						data.keyedStores
					)
				: planSingleStore(storeElement, snapshots, previous, created);
		} catch (error) {
			errors.push(error);
			for (let i = 0; i < created.length; i++) {
				captureChildError(errors, () => getStoreAdm(created[i]).dispose(true));
			}
			return;
		}

		// Ownership is committed before running callbacks. Failures in those
		// callbacks must not retry construction or abandon the published stores.
		parent.finishPendingChildSnapshots(name);
		data.reconciledElement = storeElement;
		data.initialized = true;
		updateKeyedStores(data, plan, previous, created);
		if (plan.value !== previous) {
			if (Array.isArray(plan.value)) Object.freeze(plan.value);
			data.value.set(plan.value);
		}

		for (const store of plan.retired) {
			captureChildError(errors, () => getStoreAdm(store).dispose(true));
		}
		for (let i = 0; i < created.length; i++) {
			if (!parent.isMounted || !parent.isActive) break;
			const adm = getStoreAdm(created[i]);
			// User callbacks may have synchronously replaced this child again.
			if (adm.isActive && !adm.isMounted) {
				captureChildError(errors, () => adm.mount(parent, name));
			}
		}
		if (!wasInitialized && errors.length) {
			// The lazy initializer's normal notification will not run on error.
			parent.reportChildStructureChanged();
		}
		if (debugEnabled) {
			const before = wasInitialized ? previous : undefined;
			const after = parent.peekInspectionChild(name).value;
			if (before !== after)
				debugWrite(parent.source, name, "child", before, after);
		}
	});
}
