import { observable } from "lobx";
import { IdType } from "../types";
import Model from "./Model";
import { getModelAdm } from "./ModelAdministration";
import { graphOptions } from "../lobx";

const mountedIdMap: WeakMap<
	Model,
	Map<IdType, Model | undefined>
> = new WeakMap();

const idMap: WeakMap<Model, IdType> = new WeakMap();

function getRootModel(model: Model): Model {
	return getModelAdm(model).root!.proxy;
}

export function setIdentifier(
	model: Model,
	id: string | number,
	name: string
): void {
	if (idMap.has(model)) {
		throw new Error("r-state-tree identifier already set.");
	}

	if (id !== undefined) {
		idMap.set(model, id);
		if (getModelAdm(model).isMounted) {
			onModelMounted(model);
		}
	}
}

export function getIdentifier(model: Model): IdType | undefined {
	return idMap.get(model);
}

export function getModelById(
	root: Model | undefined,
	id: IdType
): Model | undefined {
	if (!root) {
		return undefined;
	}

	const model = mountedIdMap?.get(root)?.get(id);

	return model;
}

export function onModelMounted(model: Model): void {
	if (idMap.has(model)) {
		const root = getRootModel(model);
		let map = mountedIdMap.get(root);
		if (!map) {
			map = observable(new Map(), graphOptions);
			mountedIdMap.set(root, map);
		}
		const id = idMap.get(model)!;
		if (map.has(id)) {
			map.set(id, model);
		} else {
			map.set(id, model);
		}
	}
}

// TODO: clean up if not observed
export function onModelUnmounted(model: Model): void {
	if (idMap.has(model)) {
		const root = getRootModel(model);
		const map = mountedIdMap.get(root);
		if (map) {
			const id = idMap.get(model)!;
			if (map.has(id)) {
				map.set(id, undefined);
			}
		}
	}
}
