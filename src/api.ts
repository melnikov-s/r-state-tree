import { type } from "lobx";
import { StoreElement } from "./types";
import Store, { allowNewStore } from "./store/Store";
import { getStoreAdm, storePropertyType } from "./store/StoreAdministration";
import Model from "./model/Model";
import { getModelAdm, modelPropertyType } from "./model/ModelAdministration";

export function mount<T extends Store | Model>(container: T): T {
	if (container instanceof Model) {
		const adm = getModelAdm(container);
		adm.mount();
		return container;
	} else {
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
}

export function unmount<S extends Store | Model>(container: S): void {
	if (container instanceof Store) {
		const internalStore = getStoreAdm(container);
		if (!internalStore.isRoot()) {
			throw new Error("r-state-tree: can only unmount root stores");
		}

		internalStore.unmount();
	} else {
		const internalModel = getModelAdm(container as Model);
		// is root check?
		internalModel.unmount();
	}
}

export const rStateTypes = {
	...type,
	...storePropertyType,
	...modelPropertyType,
};
