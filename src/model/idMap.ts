import { observable } from "lobx";
import { IdType } from "../types";
import Model from "./Model";
import { graphOptions } from "../lobx";

const attachedIdMap: WeakMap<
	Model,
	Map<IdType, Model | undefined>
> = new WeakMap();

const idMap: WeakMap<Model, IdType> = new WeakMap();

export function setIdentifier(
	model: Model,
	id: string | number,
	name: string
): void {
	if (id !== undefined) {
		idMap.set(model, id);
		if (model.parent) {
			onModelAttached(model);
		}
	}
}

export function getIdentifier(model: Model): IdType | undefined {
	return idMap.get(model);
}

export function getModelById(root: Model, id: IdType): Model | undefined {
	return attachedIdMap.get(root)?.get(id);
}

export function onModelAttached(model: Model): void {
	// merge id map with parents id map
	if (attachedIdMap.has(model)) {
		const attachedMap = attachedIdMap.get(model);
		let node = model.parent;

		while (node) {
			let map = attachedIdMap.get(node);

			if (!map) {
				map = observable(new Map(), graphOptions);
				attachedIdMap.set(node, map);
			}

			attachedMap!.forEach((value, key) => {
				map!.set(key, value);
			});

			node = node.parent;
		}
	}

	if (idMap.has(model)) {
		let map = attachedIdMap.get(model.parent!);
		if (!map) {
			map = observable(new Map(), graphOptions);
			attachedIdMap.set(model.parent!, map);
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
export function onModelDetached(model: Model): void {
	if (attachedIdMap.has(model)) {
		const attachedMap = attachedIdMap.get(model);
		let node = model.parent;

		while (node) {
			const map = attachedIdMap.get(node);

			if (map) {
				attachedMap!.forEach((value, key) => {
					map!.delete(key);
				});
			}

			node = node.parent;
		}
	}

	if (idMap.has(model)) {
		const map = attachedIdMap.get(model.parent!);
		if (map) {
			const id = idMap.get(model)!;
			if (map.has(id)) {
				map.set(id, undefined);
			}
		}
	}
}
