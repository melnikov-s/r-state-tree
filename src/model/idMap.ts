import { getConfigurationForCtor } from "../configuration.js";
import { AtomMap } from "../observables/internal/NodeMap.js";
import { getAdministration } from "../observables/internal/lookup.js";
import { ModelCfgTypes, type IdType } from "../types.js";
import type Model from "./Model.js";
import type { ModelAdministration } from "./ModelAdministration.js";

const ctorIdKeyMap = new WeakMap<typeof Model, string | null>();

export function getModelIdKey(Ctor: typeof Model): string | null {
	if (!ctorIdKeyMap.has(Ctor)) {
		const config = getConfigurationForCtor(Ctor as unknown as Function);
		const key =
			Object.keys(config).find(
				(prop) => (config as any)[prop]?.type === ModelCfgTypes.id
			) ?? null;

		ctorIdKeyMap.set(Ctor, key);
	}

	return ctorIdKeyMap.get(Ctor) ?? null;
}

export type ModelConstructor<T extends Model = Model> = new (
	...args: any[]
) => T;

export type IdBucket = {
	models: Map<IdType, Model>;
	atoms?: AtomMap<IdType>;
};

export type TypeMap = Map<ModelConstructor, IdBucket>;

function getAdm(model: Model): ModelAdministration {
	return getAdministration(model) as unknown as ModelAdministration;
}

function getModelType(adm: ModelAdministration): ModelConstructor {
	return (
		adm._modelCtor ??
		(Object.getPrototypeOf(adm.source).constructor as ModelConstructor)
	);
}

function getOrCreateBucket(
	adm: ModelAdministration,
	Type: ModelConstructor
): IdBucket {
	let map = adm._idIndex;
	if (!map) {
		map = new Map();
		adm._idIndex = map;
	}
	let b = map.get(Type);
	if (!b) {
		b = { models: new Map() };
		map.set(Type, b);
	}
	return b;
}

function assertAvailableForEntry(
	node: ModelAdministration,
	Type: ModelConstructor,
	id: IdType,
	model: Model
): void {
	const existing = node._idIndex?.get(Type)?.models.get(id);
	if (existing && existing !== model) {
		throw new Error(
			`r-state-tree: id: ${id} is already assigned to another model`
		);
	}
}

function assertAvailableForModel(
	node: ModelAdministration,
	modelAdm: ModelAdministration
): void {
	const targetMap = node._idIndex;
	if (!targetMap) return;
	const sourceMap = modelAdm._idIndex;
	if (sourceMap) {
		for (const [Type, srcBucket] of sourceMap) {
			const destBucket = targetMap.get(Type);
			if (!destBucket || destBucket.models.size === 0) continue;
			const destModels = destBucket.models;
			for (const [id, value] of srcBucket.models) {
				const existing = destModels.get(id);
				if (existing && existing !== value) {
					throw new Error(
						`r-state-tree: id: ${id} is already assigned to another model`
					);
				}
			}
		}
	}
	const selfId = modelAdm._modelId;
	if (selfId != null) {
		const selfType = getModelType(modelAdm);
		const existing = targetMap.get(selfType)?.models.get(selfId);
		if (existing && existing !== modelAdm.proxy) {
			throw new Error(
				`r-state-tree: id: ${selfId} is already assigned to another model`
			);
		}
	}
}

export function setIdentifierAdm(
	adm: ModelAdministration,
	id: IdType | undefined
): void {
	const previousId = adm._modelId;
	if (previousId === id) return;
	const firstParent = adm.rawParent;
	if (firstParent) {
		const Type = getModelType(adm);
		const proxy = adm.proxy;
		// Validate all ancestors before mutating any bucket.
		let node: ModelAdministration | null = firstParent;
		if (id !== undefined) {
			while (node) {
				assertAvailableForEntry(node, Type, id, proxy);
				node = node.rawParent;
			}
		}
		node = firstParent;
		while (node) {
			const b = getOrCreateBucket(node, Type);
			if (previousId != null && b.models.get(previousId) === proxy) {
				b.models.delete(previousId);
				b.atoms?.reportChanged(previousId);
			}
			if (id !== undefined) {
				b.models.set(id, proxy);
				b.atoms?.reportChanged(id);
			}
			node = node.rawParent;
		}
	}
	adm._modelId = id;
}

export function setIdentifier(model: Model, id: IdType | undefined): void {
	setIdentifierAdm(getAdm(model), id);
}

export function getIdentifier(model: Model): IdType | undefined {
	return getAdm(model)._modelId;
}

export function getModelByIdAdm<T extends Model>(
	rootAdm: ModelAdministration,
	Type: ModelConstructor<T>,
	id: IdType
): T | undefined {
	let b: IdBucket;
	if (rootAdm._lastIdType === Type) {
		b = rootAdm._lastIdBucket!;
	} else {
		b = getOrCreateBucket(rootAdm, Type);
		rootAdm._lastIdType = Type;
		rootAdm._lastIdBucket = b;
	}
	(b.atoms ??= new AtomMap()).reportObservedPrimitive(id);
	return b.models.get(id) as T | undefined;
}

export function getModelById<T extends Model>(
	root: Model,
	Type: ModelConstructor<T>,
	id: IdType
): T | undefined {
	return getModelByIdAdm(getAdm(root), Type, id);
}

/** Non-reactive internal lookup; does not materialize empty buckets or atoms. */
export function peekModelByIdAdm<T extends Model>(
	rootAdm: ModelAdministration,
	Type: ModelConstructor<T>,
	id: IdType
): T | undefined {
	if (rootAdm._lastIdType === Type) {
		return rootAdm._lastIdBucket!.models.get(id) as T | undefined;
	}
	return rootAdm._idIndex?.get(Type)?.models.get(id) as T | undefined;
}

/** Validate only the changed subtrees, allowing identifiers released by removals. */
export function validateModelAttachmentsAdm(
	parentAdm: ModelAdministration,
	added: ModelAdministration[],
	removed: ModelAdministration[]
): void {
	if (added.length === 0) return;

	let released: Set<Model> | undefined;
	if (removed.length > 0) {
		released = new Set<Model>();
		for (let i = 0; i < removed.length; i++) {
			const modelAdm = removed[i];
			const map = modelAdm._idIndex;
			if (map) {
				for (const b of map.values()) {
					for (const value of b.models.values()) {
						released.add(value);
					}
				}
			}
			if (modelAdm._modelId !== undefined) released.add(modelAdm.proxy);
		}
	}

	// Collect ancestor TypeMaps once instead of walking the parent chain per entry.
	let ancestorMaps: TypeMap[] | undefined;
	let node: ModelAdministration | null = parentAdm;
	while (node) {
		const map = node._idIndex;
		if (map) (ancestorMaps ??= []).push(map);
		node = node.rawParent;
	}

	let incoming: Map<ModelConstructor, Map<IdType, Model>> | undefined;
	let lastIncomingType: ModelConstructor | undefined;
	let lastIncomingIds: Map<IdType, Model> | undefined;
	const multipleAdded = added.length > 1;

	const checkEntry = (Type: ModelConstructor, id: IdType, value: Model) => {
		let ids: Map<IdType, Model> | undefined;
		if (multipleAdded) {
			if (lastIncomingType === Type) {
				ids = lastIncomingIds;
			} else {
				incoming ??= new Map();
				ids = incoming.get(Type);
				if (!ids) {
					ids = new Map();
					incoming.set(Type, ids);
				}
				lastIncomingType = Type;
				lastIncomingIds = ids;
			}
			const duplicate = ids!.get(id);
			if (duplicate && duplicate !== value) {
				throw new Error(
					`r-state-tree: id: ${id} is already assigned to another model`
				);
			}
		}
		if (ancestorMaps) {
			for (let j = 0; j < ancestorMaps.length; j++) {
				const existing = ancestorMaps[j].get(Type)?.models.get(id);
				if (
					existing &&
					existing !== value &&
					(!released || !released.has(existing))
				) {
					throw new Error(
						`r-state-tree: id: ${id} is already assigned to another model`
					);
				}
			}
		}
		if (ids) {
			ids.set(id, value);
		}
	};

	for (let i = 0; i < added.length; i++) {
		const modelAdm = added[i];
		const map = modelAdm._idIndex;
		if (map) {
			for (const [Type, b] of map) {
				for (const [id, value] of b.models) {
					checkEntry(Type, id, value);
				}
			}
		}
		const selfId = modelAdm._modelId;
		if (selfId != null) {
			checkEntry(getModelType(modelAdm), selfId, modelAdm.proxy);
		}
	}
}

/**
 * Bulk-register models already validated by validateModelAttachmentsAdm into
 * parentAdm and all of its ancestors without repeating collision checks.
 */
export function onModelsAttachedValidated(
	parentAdm: ModelAdministration,
	attaching: ModelAdministration[]
): void {
	const count = attaching.length;
	if (count === 0) return;

	let node: ModelAdministration | null = parentAdm;
	while (node) {
		let lastType: ModelConstructor | undefined;
		let lastBucket: IdBucket | undefined;
		for (let i = 0; i < count; i++) {
			const adm = attaching[i];
			const sourceMap = adm._idIndex;
			if (sourceMap) {
				for (const [Type, srcBucket] of sourceMap) {
					if (srcBucket.models.size === 0) continue;
					let destBucket: IdBucket;
					if (lastType === Type) {
						destBucket = lastBucket!;
					} else {
						destBucket = getOrCreateBucket(node, Type);
						lastType = Type;
						lastBucket = destBucket;
					}
					const destModels = destBucket.models;
					const destAtoms = destBucket.atoms;
					for (const [id, value] of srcBucket.models) {
						destModels.set(id, value);
						if (destAtoms) destAtoms.reportChanged(id);
					}
				}
			}
			const selfId = adm._modelId;
			if (selfId != null) {
				const selfType = getModelType(adm);
				let destBucket: IdBucket;
				if (lastType === selfType) {
					destBucket = lastBucket!;
				} else {
					destBucket = getOrCreateBucket(node, selfType);
					lastType = selfType;
					lastBucket = destBucket;
				}
				destBucket.models.set(selfId, adm.proxy);
				if (destBucket.atoms) destBucket.atoms.reportChanged(selfId);
			}
		}
		node = node.rawParent;
	}
}

export function onModelAttachedAdm(adm: ModelAdministration): void {
	const sourceMap = adm._idIndex;
	const selfId = adm._modelId;
	if (!sourceMap && selfId == null) return;

	const firstParent = adm.rawParent;
	if (!firstParent) return;

	// Fast path for a single-level leaf model (most common case).
	if (!sourceMap) {
		const selfType = getModelType(adm);
		const proxy = adm.proxy;
		let node: ModelAdministration | null = firstParent;
		while (node) {
			assertAvailableForEntry(node, selfType, selfId!, proxy);
			node = node.rawParent;
		}
		node = firstParent;
		while (node) {
			const b = getOrCreateBucket(node, selfType);
			b.models.set(selfId!, proxy);
			b.atoms?.reportChanged(selfId!);
			node = node.rawParent;
		}
		return;
	}

	let node: ModelAdministration | null = firstParent;
	while (node) {
		assertAvailableForModel(node, adm);
		node = node.rawParent;
	}

	const selfType = selfId != null ? getModelType(adm) : undefined;
	const proxy = adm.proxy;
	node = firstParent;
	while (node) {
		for (const [Type, srcBucket] of sourceMap) {
			if (srcBucket.models.size === 0) continue;
			const destBucket = getOrCreateBucket(node, Type);
			const destModels = destBucket.models;
			const destAtoms = destBucket.atoms;
			for (const [id, value] of srcBucket.models) {
				destModels.set(id, value);
				if (destAtoms) destAtoms.reportChanged(id);
			}
		}
		if (selfId != null) {
			const destBucket = getOrCreateBucket(node, selfType!);
			destBucket.models.set(selfId, proxy);
			destBucket.atoms?.reportChanged(selfId);
		}
		node = node.rawParent;
	}
}

export function onModelDetachedAdm(adm: ModelAdministration): void {
	const sourceMap = adm._idIndex;
	const selfId = adm._modelId;
	if (!sourceMap && selfId == null) return;

	let node = adm.rawParent;
	if (!node) return;

	const selfType = selfId != null ? getModelType(adm) : undefined;
	const proxy = adm.proxy;
	while (node) {
		const map = node._idIndex;
		if (map) {
			if (sourceMap) {
				for (const [Type, srcBucket] of sourceMap) {
					const destBucket = map.get(Type);
					if (!destBucket) continue;
					const destModels = destBucket.models;
					const destAtoms = destBucket.atoms;
					for (const [id, value] of srcBucket.models) {
						if (destModels.get(id) === value) {
							destModels.delete(id);
							if (destAtoms) destAtoms.reportChanged(id);
						}
					}
				}
			}
			if (selfId != null) {
				const destBucket = map.get(selfType!);
				if (destBucket && destBucket.models.get(selfId) === proxy) {
					destBucket.models.delete(selfId);
					destBucket.atoms?.reportChanged(selfId);
				}
			}
		}
		node = node.rawParent;
	}
}
