import { StoreElement, Snapshot } from "./types";
import Store, { allowNewStore } from "./store/Store";
import { getStoreAdm } from "./store/StoreAdministration";
import Model from "./model/Model";
import { getModelAdm } from "./model/ModelAdministration";

export function mount<T extends Store>(container: T): T {
	return allowNewStore(() => {
		const element = (container as unknown) as StoreElement;
		const s = new element.Type();
		if (element.props) {
			Object.assign(s.props, element.props);
		}
		getStoreAdm(s).mount();
		return s;
	}) as T;
}

export function unmount<S extends Store>(container: S): void {
	const internalStore = getStoreAdm(container);
	if (!internalStore.isRoot()) {
		throw new Error("r-state-tree: can only unmount root stores");
	}

	internalStore.unmount();
}

export function toSnapshot(model: Model): Snapshot {
	return getModelAdm(model).getSnapshot();
}

export function onSnapshot(
	model: Model,
	callback: (snapshot: Snapshot, model: Model) => void
): () => void {
	return getModelAdm(model).onSnapshotChange(callback);
}
