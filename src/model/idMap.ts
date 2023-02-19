import { getObservable } from "nu-observables";
import { graph } from "../graph";
import { IdType } from "../types";
import Model from "./Model";
import { getModelAdm } from "./ModelAdministration";

const attachedIdMap: WeakMap<
	Model,
	Map<IdType, Model | undefined>
> = new WeakMap();

const idMap: WeakMap<Model, IdType> = new WeakMap();
let loadingSnapshot = false;

const potentialDups: Set<Model> = new Set();

export function onSnapshotLoad<T>(fn: () => T): T {
	const wasLoadingSnapshot = loadingSnapshot;
	loadingSnapshot = true;

	try {
		return fn();
	} finally {
		if (!wasLoadingSnapshot) {
			loadingSnapshot = false;
			const rootMap: Map<Model, Set<IdType>> = new Map();

			try {
				potentialDups.forEach((model) => {
					const root = getModelAdm(model).root.proxy;

					let set = rootMap.get(root);

					if (!set) {
						set = new Set();
						rootMap.set(root, set);
					}

					if (idMap.has(model)) {
						const id = idMap.get(model)!;
						if (set.has(id)) {
							throw new Error(
								"r-state-tree duplicate ids detected after snapshot was loaded"
							);
						}

						set.add(id);
					}
				});
			} finally {
				potentialDups.clear();
			}
		}
	}
}

export function setIdentifier(model: Model, id: string | number): void {
	const prevId = idMap.get(model);
	idMap.set(model, id);

	if (prevId == null) {
		if (model.parent) {
			onModelAttached(model);
		}
	} else if (prevId !== id) {
		updateIdentifier(model);
	}
}

export function getIdentifier(model: Model): IdType | undefined {
	return idMap.get(model);
}

export function getModelById(root: Model, id: IdType): Model | undefined {
	return attachedIdMap.get(root)?.get(id);
}

function updateIdentifier(model: Model): void {
	const id = idMap.get(model)!;

	let node: Model | null = model.parent;

	while (node) {
		const map = attachedIdMap.get(node);

		if (map) {
			map.set(id, model);
		}

		node = node.parent;
	}
}

export function onModelAttached(model: Model): void {
	const attachedMap = attachedIdMap.get(model);
	const id = idMap.get(model);

	if (attachedMap || id != null) {
		const id = idMap.get(model);
		let node = model.parent;

		while (node) {
			let map = attachedIdMap.get(node);

			if (!map) {
				map = getObservable(new Map(), graph);
				attachedIdMap.set(node, map);
			}

			attachedMap?.forEach((value, key) => {
				if (map!.has(key)) {
					if (loadingSnapshot) {
						potentialDups.add(model);
						potentialDups.add(map!.get(key)!);
					} else {
						throw new Error(
							`r-state-tree: id: ${key} is already assigned to another model`
						);
					}
				}
				map!.set(key, value);
			});

			if (id != null) {
				if (map!.has(id)) {
					if (loadingSnapshot) {
						potentialDups.add(model);
						potentialDups.add(map!.get(id)!);
					} else {
						throw new Error(
							`r-state-tree: id: ${id} is already assigned to another model`
						);
					}
				}
				map.set(id, model);
			}

			node = node.parent;
		}
	}
}

// TODO: clean up if not observed
export function onModelDetached(model: Model): void {
	const id = idMap.get(model);
	if (attachedIdMap.has(model) || id != null) {
		const attachedMap = attachedIdMap.get(model);
		let node = model.parent;

		while (node) {
			const map = attachedIdMap.get(node);

			if (map) {
				attachedMap?.forEach((value, key) => {
					map!.delete(key);
				});

				if (id != null) {
					map!.delete(id);
				}
			}

			node = node.parent;
		}
	}
}
