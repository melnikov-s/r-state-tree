import type {
	StoreElement,
	Snapshot,
	SnapshotDiff,
	IdType,
	StoreSnapshot,
} from "./types.js";
import { getDiff } from "./utils.js";
import Store from "./store/Store.js";
import { allowNewStore } from "./store/Store.js";
import { getStoreAdm } from "./store/StoreAdministration.js";
import type Model from "./model/Model.js";
import {
	getModelAdm,
	getConfigurationFromSnapshot,
} from "./model/ModelAdministration.js";
import { getModelById } from "./model/idMap.js";
import { batch } from "./observables/index.js";

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
	return allowNewStore(() => {
		const element = container as unknown as StoreElement;
		const s = new element.Type(element.props);
		const adm = getStoreAdm(s);
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
	let prev = getModelAdm(model).getSnapshot();

	return getModelAdm(model).onSnapshotChange(function (next, model) {
		const diff = {
			undo: getDiff(next, prev, getConfigurationFromSnapshot)!,
			redo: getDiff(prev, next, getConfigurationFromSnapshot)!,
		};

		callback(diff as any, model);
		prev = next;
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
	if (value instanceof Store) {
		// Store instance: applies in place. Unmounted stores are quiescent
		// (effects/reactions start only at mount), and mounted stores reconcile
		// through the same machinery as any reactive child/props update.
		getStoreAdm(value).loadSnapshot(snapshot as StoreSnapshot | undefined);
		return value;
	}

	const element = value as unknown as Partial<StoreElement> | null;
	if (element && typeof element.Type === "function") {
		// Not yet instantiated (result of createStore): hold the snapshot on
		// the element; mount() applies it before any effect or reaction starts.
		(value as unknown as StoreElement).snapshot = snapshot as StoreSnapshot;
		return value;
	}

	const adm = getModelAdm(value);
	const previousSnapshot = adm.getSnapshotForRollback();
	batch(() => {
		try {
			adm.loadSnapshot(snapshot as Snapshot);
		} catch (error) {
			adm.loadSnapshot(previousSnapshot);
			adm.recordSnapshotRollback();
			throw error;
		}
	});

	return value;
}
