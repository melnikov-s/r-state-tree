import { getSource } from "../observables/index.js";
import { getConfigType } from "../configuration.js";
import { CommonCfgTypes, ModelCfgTypes } from "../types.js";
import type {
	IdType,
	ModelConfiguration,
	RefSnapshot,
	Snapshot,
} from "../types.js";
import { clone } from "../utils.js";
import type Model from "./Model.js";
import {
	getModelAdm,
	type ModelAdministration,
} from "./ModelAdministration.js";
import { getModelIdKey } from "./idMap.js";

/** The administration owns reference observation and the reactive child array cache. */
export type SnapshotReads = {
	observeReference(model: ModelAdministration, key: string): typeof Model;
	childArraySnapshot(model: ModelAdministration, key: string): unknown[];
};

function getModelRefSnapshotFromId(
	Ctor: typeof Model,
	id: IdType
): RefSnapshot | null {
	const idKey = getModelIdKey(Ctor);
	return idKey ? { [idKey]: id } : null;
}

function writeSnapshotKey(
	model: ModelAdministration,
	reads: SnapshotReads,
	json: Record<string, unknown>,
	config: ModelConfiguration<any>,
	source: Record<string, unknown>,
	key: string,
	isOwn: boolean
): void {
	switch (getConfigType(config[key])) {
		case ModelCfgTypes.transient:
			break;
		case ModelCfgTypes.id: {
			const idVal = model.read(key);
			json[key] =
				typeof idVal === "string" ||
				typeof idVal === "number" ||
				idVal === undefined ||
				idVal === null
					? idVal
					: clone(getSource(idVal), key);
			break;
		}
		case ModelCfgTypes.modelRef: {
			const Type = reads.observeReference(model, key);
			const reference = source[key] as IdType | IdType[] | null | undefined;
			if (Array.isArray(reference)) {
				json[key] = clone(
					reference.map((id) => getModelRefSnapshotFromId(Type, id)),
					key
				);
				break;
			}
			json[key] =
				reference == null
					? null
					: clone(getModelRefSnapshotFromId(Type, reference), key);
			break;
		}
		case CommonCfgTypes.child: {
			const child = model.read(key) as Model | Model[] | undefined;
			if (Array.isArray(child)) {
				json[key] = reads.childArraySnapshot(model, key);
				break;
			}
			json[key] = child ? getModelAdm(child).getSnapshot() : null;
			break;
		}
		default:
			if (isOwn) {
				const val = model.read(key);
				json[key] =
					val === null ||
					val === undefined ||
					typeof val === "string" ||
					typeof val === "number" ||
					typeof val === "boolean"
						? val
						: clone(val, key);
			}
			break;
	}
}

export function serializeModelSnapshot(
	model: ModelAdministration,
	config: ModelConfiguration<any>,
	reads: SnapshotReads
): Snapshot<Model> {
	const source = model.source;
	const json: Record<string, unknown> = {};

	for (const key in source) {
		if (Object.prototype.hasOwnProperty.call(source, key)) {
			writeSnapshotKey(model, reads, json, config, source, key, true);
		}
	}
	for (const key in config) {
		if (
			Object.prototype.hasOwnProperty.call(config, key) &&
			!Object.prototype.hasOwnProperty.call(source, key)
		) {
			writeSnapshotKey(model, reads, json, config, source, key, false);
		}
	}

	return json as Snapshot<Model>;
}
