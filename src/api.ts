import { type } from "lobx";
import { StoreElement } from "./types";
import Store, { allowNewStore } from "./store/Store";
import { getStoreAdm, storePropertyType } from "./store/StoreAdministration";
import { modelPropertyType } from "./model/ModelAdministration";

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

export const rStateTypes = {
	...type,
	...storePropertyType,
	...modelPropertyType,
};
