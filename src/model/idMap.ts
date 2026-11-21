import { AtomMap } from "../observables/internal/NodeMap.js";
import type { IdType } from "../types.js";
import type Model from "./Model.js";
import { getModelAdm } from "./ModelAdministration.js";
import type { ModelAdministration } from "./ModelAdministration.js";

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
	const id = getIdentifier(model);
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

export function setIdentifier(
	adm: ModelAdministration,
	id: IdType | undefined
): void {
	const previousId = adm.identifier;
	if (previousId === id) return;
	const model = adm.proxy as Model;
	const parent = adm.peekParent()?.proxy as Model | undefined;
	if (parent) {
		const Type = getModelType(model);
		const ancestors: Model[] = [];
		for (let node: Model | null = parent; node; node = peekParent(node)) {
			if (id !== undefined) assertAvailable(node, [[Type, id, model]]);
			ancestors.push(node);
		}
		for (const ancestor of ancestors) {
			const ids = bucket(ancestor, Type);
			if (previousId != null && ids.get(previousId) === model)
				ids.delete(previousId);
			if (id !== undefined) ids.set(id, model);
		}
	}
	adm.identifier = id;
}

export function getIdentifier(model: Model): IdType | undefined {
	return getModelAdm(model)?.identifier;
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
	parent: ModelAdministration,
	added: ModelAdministration[],
	removed: ModelAdministration[]
): void {
	if (!added.length) return;
	const released = removed.length ? new Set<Model>() : undefined;
	for (const adm of removed) {
		for (const [, , model] of entriesFor(adm.proxy)) released!.add(model);
	}
	const ancestors: Array<Map<ModelConstructor, IdBucket>> = [];
	for (
		let node: ModelAdministration | null = parent;
		node;
		node = node.peekParent()
	) {
		const map = attachedIdMap.get(node.proxy);
		if (map) ancestors.push(map);
	}
	const incoming = new Map<ModelConstructor, Map<IdType, Model>>();
	const validate = (Type: ModelConstructor, id: IdType, value: Model) => {
		let ids = incoming.get(Type);
		const duplicate = ids?.get(id);
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
		if (!ids) incoming.set(Type, (ids = new Map()));
		ids.set(id, value);
	};
	for (const adm of added) {
		const model = adm.proxy as Model;
		attachedIdMap.get(model)?.forEach((ids, Type) => {
			ids.forEach((value, id) => validate(Type, id, value));
		});
		const id = adm.identifier;
		if (id != null) validate(getModelType(model), id, model);
	}
}

export function onModelAttached(adm: ModelAdministration): void {
	const model = adm.proxy as Model;
	const parent = adm.peekParent();
	if (!parent) return;
	if (!attachedIdMap.has(model)) {
		const id = adm.identifier;
		if (id == null) return;
		const Type = getModelType(model);
		for (
			let node: ModelAdministration | null = parent;
			node;
			node = node.peekParent()
		) {
			const existing = attachedIdMap.get(node.proxy)?.get(Type)?.get(id);
			if (existing && existing !== model)
				throw new Error(
					`r-state-tree: id: ${id} is already assigned to another model`
				);
		}
		for (
			let node: ModelAdministration | null = parent;
			node;
			node = node.peekParent()
		) {
			bucket(node.proxy, Type).set(id, model);
		}
		return;
	}
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
