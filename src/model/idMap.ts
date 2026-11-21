import { AtomMap } from "../observables/internal/NodeMap.js";
import type { IdType } from "../types.js";
import type Model from "./Model.js";
import { getModelAdm } from "./ModelAdministration.js";

export type ModelConstructor<T extends Model = Model> = new (
	...args: any[]
) => T;
// Identifier buckets are internal and already contain canonical Models and IDs.
// Validate and move entries without observing the index; only public lookups
// need a dependency, including lookups for identifiers not present yet.
class IdBucket extends Map<IdType, Model> {
	private reads?: AtomMap<IdType>;

	read(id: IdType): Model | undefined {
		(this.reads ??= new AtomMap()).reportObserved(id);
		return this.get(id);
	}

	override set(id: IdType, model: Model): this {
		if (this.get(id) === model) return this;
		super.set(id, model);
		this.reads?.reportChanged(id);
		return this;
	}

	override delete(id: IdType): boolean {
		const removed = super.delete(id);
		if (removed) this.reads?.reportChanged(id);
		return removed;
	}
}

const attachedIdMap = new WeakMap<Model, Map<ModelConstructor, IdBucket>>();
const idMap: WeakMap<Model, IdType> = new WeakMap();

function getModelType(model: Model): ModelConstructor {
	return Object.getPrototypeOf(model).constructor as ModelConstructor;
}

function peekParent(model: Model): Model | null {
	return getModelAdm(model).peekParent()?.proxy ?? null;
}

function entriesFor(model: Model): Array<[ModelConstructor, IdType, Model]> {
	const entries: Array<[ModelConstructor, IdType, Model]> = [];
	attachedIdMap.get(model)?.forEach((ids, Type) => {
		ids.forEach((value, id) => entries.push([Type, id, value]));
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

function bucket(node: Model, Type: ModelConstructor): IdBucket {
	let map = attachedIdMap.get(node);
	if (!map) {
		map = new Map();
		attachedIdMap.set(node, map);
	}
	let ids = map.get(Type);
	if (!ids) {
		ids = new IdBucket();
		map.set(Type, ids);
	}
	return ids;
}

export function setIdentifier(model: Model, id: IdType | undefined): void {
	const previousId = idMap.get(model);
	if (previousId === id) return;
	const Type = getModelType(model);
	const ancestors: Model[] = [];
	let node = peekParent(model);
	while (node) {
		if (id !== undefined) assertAvailable(node, [[Type, id, model]]);
		ancestors.push(node);
		node = peekParent(node);
	}
	for (const ancestor of ancestors) {
		const ids = bucket(ancestor, Type);
		if (previousId != null && ids.get(previousId) === model)
			ids.delete(previousId);
		if (id !== undefined) ids.set(id, model);
	}
	if (id !== undefined) idMap.set(model, id);
	else idMap.delete(model);
}

export function getIdentifier(model: Model): IdType | undefined {
	return idMap.get(model);
}

export function getModelById<T extends Model>(
	root: Model,
	Type: ModelConstructor<T>,
	id: IdType
): T | undefined {
	// A stable bucket also lets misses observe the first insertion of this type.
	return bucket(root, Type).read(id) as T | undefined;
}

/** Snapshot planning is already untracked and need not allocate read dependencies. */
export function peekModelById<T extends Model>(
	root: Model,
	Type: ModelConstructor<T>,
	id: IdType
): T | undefined {
	return attachedIdMap.get(root)?.get(Type)?.get(id) as T | undefined;
}

/** Validate only the changed subtrees, allowing identifiers released by removals. */
export function validateModelAttachments(
	parent: Model,
	added: Model[],
	removed: Model[]
): void {
	if (!added.length) return;
	const released = removed.length
		? new Set(removed.flatMap(entriesFor).map(([, , model]) => model))
		: undefined;
	const ancestors: Array<Map<ModelConstructor, IdBucket>> = [];
	for (let node: Model | null = parent; node; node = peekParent(node)) {
		const map = attachedIdMap.get(node);
		if (map) ancestors.push(map);
	}
	const incoming = new Map<ModelConstructor, Map<IdType, Model>>();
	for (const model of added) {
		for (const [Type, id, value] of entriesFor(model)) {
			const duplicate = incoming.get(Type)?.get(id);
			if (duplicate && duplicate !== value) {
				throw new Error(
					`r-state-tree: id: ${id} is already assigned to another model`
				);
			}
			for (const ancestor of ancestors) {
				const existing = ancestor.get(Type)?.get(id);
				if (existing && existing !== value && !released?.has(existing)) {
					throw new Error(
						`r-state-tree: id: ${id} is already assigned to another model`
					);
				}
			}
			let ids = incoming.get(Type);
			if (!ids) incoming.set(Type, (ids = new Map()));
			ids.set(id, value);
		}
	}
}

export function onModelAttached(model: Model): void {
	const entries = entriesFor(model);
	if (!entries.length) return;
	const ancestors: Model[] = [];
	let node = peekParent(model);
	while (node) {
		assertAvailable(node, entries);
		ancestors.push(node);
		node = peekParent(node);
	}
	for (const ancestor of ancestors) {
		for (const [Type, id, value] of entries)
			bucket(ancestor, Type).set(id, value);
	}
}

export function onModelDetached(model: Model): void {
	const entries = entriesFor(model);
	if (!entries.length) return;
	let node = peekParent(model);
	while (node) {
		const map = attachedIdMap.get(node);
		for (const [Type, id, value] of entries) {
			const ids = map?.get(Type);
			if (ids?.get(id) === value) ids.delete(id);
		}
		node = peekParent(node);
	}
}
