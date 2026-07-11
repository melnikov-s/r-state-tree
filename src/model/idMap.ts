import { observable } from "../observables";
import type { IdType } from "../types";
import Model from "./Model";

export type ModelConstructor<T extends Model = Model> = new (
	...args: any[]
) => T;
type TypeMap = Map<ModelConstructor, Map<IdType, Model | undefined>>;

const attachedIdMap: WeakMap<Model, TypeMap> = new WeakMap();
const idMap: WeakMap<Model, IdType> = new WeakMap();

function getModelType(model: Model): ModelConstructor {
	return Object.getPrototypeOf(model).constructor as ModelConstructor;
}

function entriesFor(model: Model): Array<[ModelConstructor, IdType, Model]> {
	const entries: Array<[ModelConstructor, IdType, Model]> = [];
	attachedIdMap.get(model)?.forEach((ids, Type) => {
		ids.forEach((value, id) => {
			if (value) entries.push([Type, id, value]);
		});
	});
	const id = idMap.get(model);
	if (id != null) entries.push([getModelType(model), id, model]);
	return entries;
}

function assertAvailable(
	node: Model,
	entries: Array<[ModelConstructor, IdType, Model]>
): void {
	const map = attachedIdMap.get(node);
	for (const [Type, id, model] of entries) {
		const existing = map?.get(Type)?.get(id);
		if (existing && existing !== model) {
			throw new Error(
				`r-state-tree: id: ${id} is already assigned to another model`
			);
		}
	}
}

function bucket(
	node: Model,
	Type: ModelConstructor
): Map<IdType, Model | undefined> {
	let map = attachedIdMap.get(node);
	if (!map) {
		map = observable(new Map());
		attachedIdMap.set(node, map);
	}
	let ids = map.get(Type);
	if (!ids) {
		ids = observable(new Map());
		map.set(Type, ids);
	}
	return ids;
}

export function setIdentifier(model: Model, id: IdType): void {
	const previousId = idMap.get(model);
	if (previousId === id) return;
	const Type = getModelType(model);
	const ancestors: Model[] = [];
	let node = model.parent;
	while (node) {
		assertAvailable(node, [[Type, id, model]]);
		ancestors.push(node);
		node = node.parent;
	}
	for (const ancestor of ancestors) {
		const ids = bucket(ancestor, Type);
		if (previousId != null && ids.get(previousId) === model)
			ids.delete(previousId);
		ids.set(id, model);
	}
	idMap.set(model, id);
}

export function getIdentifier(model: Model): IdType | undefined {
	return idMap.get(model);
}

export function getModelById<T extends Model>(
	root: Model,
	Type: ModelConstructor<T>,
	id: IdType
): T | undefined {
	return attachedIdMap.get(root)?.get(Type)?.get(id) as T | undefined;
}

export function onModelAttached(model: Model): void {
	const entries = entriesFor(model);
	if (!entries.length) return;
	const ancestors: Model[] = [];
	let node = model.parent;
	while (node) {
		assertAvailable(node, entries);
		ancestors.push(node);
		node = node.parent;
	}
	for (const ancestor of ancestors) {
		for (const [Type, id, value] of entries)
			bucket(ancestor, Type).set(id, value);
	}
}

export function onModelDetached(model: Model): void {
	const entries = entriesFor(model);
	let node = model.parent;
	while (node) {
		const map = attachedIdMap.get(node);
		for (const [Type, id, value] of entries) {
			const ids = map?.get(Type);
			if (ids?.get(id) === value) ids.delete(id);
		}
		node = node.parent;
	}
}
