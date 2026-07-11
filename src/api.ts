import type { StoreElement, Snapshot, SnapshotDiff, IdType } from "./types";
import { getDiff } from "./utils";
import type Store from "./store/Store";
import { allowNewStore } from "./store/Store";
import { getStoreAdm } from "./store/StoreAdministration";
import type Model from "./model/Model";
import {
	getModelAdm,
	getConfigurationFromSnapshot,
} from "./model/ModelAdministration";
import { getModelById } from "./model/idMap";

export function findModelById<T extends Model>(
	root: Model,
	ModelType: new (...args: any[]) => T,
	id: IdType
): T | undefined {
	return getModelById(getModelAdm(root).root.proxy, ModelType, id);
}

export function mount<T extends Store>(container: T): T {
	return allowNewStore(() => {
		const element = container as unknown as StoreElement;
		const s = new element.Type(element.props);
		const adm = getStoreAdm(s);
		try {
			adm.mount();
		} catch (error) {
			adm.dispose(true);
			throw error;
		}
		return s;
	}) as T;
}

export function toSnapshot<T extends Model>(model: T): Snapshot<T> {
	return getModelAdm(model).getSnapshot() as any;
}

export function onSnapshot<T extends Model>(
	model: T,
	callback: (snapshot: Snapshot<T>, model: T) => void
): () => void {
	return getModelAdm(model).onSnapshotChange(callback as any);
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
): T {
	const adm = getModelAdm(model);
	const previousSnapshot = adm.getSnapshotForRollback();
	try {
		adm.loadSnapshot(snapshot);
	} catch (error) {
		adm.loadSnapshot(previousSnapshot);
		throw error;
	}

	return model;
}
