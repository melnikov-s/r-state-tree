import type { Snapshot, SnapshotDiff, IdType, StoreSnapshot } from "./types.js";
import { getDiff } from "./utils.js";
import Store, { allowNewStore, isStoreElement } from "./store/Store.js";
import {
	getStoreAdm,
	StoreAdministration,
} from "./store/StoreAdministration.js";
import type Model from "./model/Model.js";
import {
	getModelAdm,
	getConfigurationFromSnapshot,
	ModelAdministration,
} from "./model/ModelAdministration.js";
import { getModelById } from "./model/idMap.js";
import { getAdministration } from "./observables/index.js";

export function findModelById<T extends Model>(
	root: Model,
	ModelType: new (...args: any[]) => T,
	id: IdType
): T | undefined {
	return getModelById(getModelAdm(root).root.proxy, ModelType, id);
}

export function mount<T extends Store>(
	container: T,
	options?: { snapshot?: StoreSnapshot }
): T {
	if (!isStoreElement(container)) {
		throw new TypeError("r-state-tree: mount expected a Store descriptor");
	}

	const element = container;
	return allowNewStore(() => {
		const s = new element.Type(element.props);
		const adm = getStoreAdm(s);
		if (!(adm instanceof StoreAdministration)) {
			throw new TypeError("r-state-tree: mount expected a Store descriptor");
		}
		try {
			// Prefer an explicit mount-time snapshot; otherwise consume one stashed
			// earlier by applySnapshot on the not-yet-instantiated element.
			const snapshot = options?.snapshot ?? element.snapshot;
			delete element.snapshot;
			if (snapshot) adm.loadSnapshot(snapshot);
			adm.mount();
		} catch (error) {
			adm.dispose(true);
			throw error;
		}
		return s;
	}) as T;
}

export function toSnapshot<T extends Model>(value: T): Snapshot<T>;
export function toSnapshot<T extends Store>(
	value: T
): StoreSnapshot | undefined;
export function toSnapshot(
	value: Model | Store
): Snapshot | StoreSnapshot | undefined {
	return value instanceof Store
		? getStoreAdm(value).getSnapshot()
		: getModelAdm(value).getSnapshot();
}

export function onSnapshot<T extends Model>(
	value: T,
	callback: (snapshot: Snapshot<T>, model: T) => void
): () => void;
export function onSnapshot<T extends Store>(
	value: T,
	callback: (snapshot: StoreSnapshot | undefined, store: T) => void
): () => void;
export function onSnapshot(
	value: Model | Store,
	callback: (snapshot: any, value: any) => void
): () => void {
	return value instanceof Store
		? getStoreAdm(value).onSnapshotChange(callback as any)
		: getModelAdm(value).onSnapshotChange(callback as any);
}

export function onSnapshotDiff<T extends Model>(
	model: T,
	callback: (snapshotDiff: SnapshotDiff<T>, model: T) => void
): () => void {
	const adm = getModelAdm(model);
	let prev: Snapshot<T> = adm.getSnapshot();

	return adm.onSnapshotChange((next: Snapshot<T>, value) => {
		const undo = getDiff(next, prev, getConfigurationFromSnapshot);
		const redo = getDiff(prev, next, getConfigurationFromSnapshot);
		prev = next;
		if (!undo && !redo) return;
		callback({ undo: undo ?? {}, redo: redo ?? {} }, value as T);
	});
}

export function applySnapshot<T extends Model>(
	model: T,
	snapshot: Snapshot<T>
): T;
export function applySnapshot<T extends Store>(
	store: T,
	snapshot: StoreSnapshot | undefined
): T;
export function applySnapshot(
	value: Model | Store,
	snapshot: Snapshot | StoreSnapshot | undefined
): Model | Store {
	const adm = getAdministration(value);
	if (adm instanceof StoreAdministration) {
		// Store instance: applies in place. Unmounted stores are quiescent
		// (effects/reactions start only at mount), and mounted stores reconcile
		// through the same machinery as any reactive child/props update.
		adm.loadSnapshot(snapshot as StoreSnapshot | undefined);
		return value;
	}

	if (!(adm instanceof ModelAdministration)) {
		if (isStoreElement(value)) {
			// mount() applies the snapshot before any effect or reaction starts.
			value.snapshot = snapshot as StoreSnapshot | undefined;
			return value;
		}
		throw new TypeError(
			"r-state-tree: applySnapshot expected a Model, Store, or Store descriptor"
		);
	}

	adm.applySnapshot(snapshot as Snapshot);

	return value;
}
