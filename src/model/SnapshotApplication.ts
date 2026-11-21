import { batch, getAdministration, untracked } from "../observables/index.js";
import { getConfigChildType, getConfigType } from "../configuration.js";
import { CommonCfgTypes, ModelCfgTypes } from "../types.js";
import type {
	IdType,
	ModelConfiguration,
	RefSnapshot,
	Snapshot,
} from "../types.js";
import { hydrateSnapshotValue } from "../utils.js";
import Model, { createModelInstance } from "./Model.js";
import {
	getModelAdm,
	type ModelAdministration,
} from "./ModelAdministration.js";
import { ChildModelsAdministration } from "./ChildModelsAdministration.js";
import {
	getIdentifier,
	getIndexedModelsOfType,
	getModelIdKey,
} from "./idMap.js";

type ChildField = Model | Model[] | null | undefined;
export type SnapshotUndo = (() => void)[];
export type SnapshotIdUndo = { key: string; id: IdType };

/** Private runtime operations needed to reconcile and write snapshot fields. */
type SnapshotAccess = {
	configuration(model: ModelAdministration): ModelConfiguration<any>;
	snapshotIdUndo(
		model: ModelAdministration,
		snapshot: object
	): SnapshotIdUndo | undefined;
	peekField(model: ModelAdministration, key: string): unknown;
	extractChildModels(model: ModelAdministration, field: ChildField): Model[];
	tryReplaceRetainedChildArray(
		model: ModelAdministration,
		key: string,
		previous: ChildModelsAdministration<Model>,
		members: ModelAdministration[]
	): boolean;
	tryWriteScalar(
		model: ModelAdministration,
		key: string,
		current: unknown,
		value: unknown
	): boolean;
	writeReference(model: ModelAdministration, key: string, value: unknown): void;
	writeId(
		model: ModelAdministration,
		key: string,
		value: IdType | undefined,
		undo?: SnapshotUndo,
		clearId?: SnapshotIdUndo
	): void;
};

type SnapshotPlan = {
	releases: (() => void)[];
	writes: Array<(() => void) | SnapshotFields>;
	undo?: SnapshotUndo;
};

type SnapshotFields = {
	model: ModelAdministration;
	fields: unknown[];
	clearId?: SnapshotIdUndo;
};

const configHasChildMap: WeakMap<object, boolean> = new WeakMap();

function configHasChildren(config: ModelConfiguration<any>): boolean {
	let has = configHasChildMap.get(config);
	if (has === undefined) {
		has = false;
		for (const key in config) {
			if (getConfigType(config[key]) === CommonCfgTypes.child) {
				has = true;
				break;
			}
		}
		configHasChildMap.set(config, has);
	}
	return has;
}

function getSnapshotRefId(snapshot: RefSnapshot): IdType {
	const keys = Object.keys(snapshot);
	if (keys.length !== 1) {
		throw new Error(
			"r-state-tree: ref snapshot can only contain one property which is the id key"
		);
	}

	return snapshot[keys[0]];
}

function findIndexedChildInSlot(
	owner: ModelAdministration,
	key: string,
	index: ReadonlyMap<IdType, Model> | undefined,
	id: IdType
): ModelAdministration | undefined {
	const found = index?.get(id);
	if (found) {
		const adm = getModelAdm(found);
		if (adm.rawParent === owner && adm.parentName === key) return adm;
	}
	return undefined;
}

export class SnapshotApplication {
	private _rollbackVersion = 0;

	constructor(private readonly access: SnapshotAccess) {}

	get rollbackVersion(): number {
		return this._rollbackVersion;
	}

	apply(model: ModelAdministration, snapshot: Snapshot<any>): void {
		const undo: SnapshotUndo = [];
		let rejection: { error: unknown } | undefined;
		try {
			batch(() => {
				try {
					this.load(model, snapshot, undo);
				} catch (error) {
					rejection = { error };
					untracked(() => {
						// Reverse writes so acquisitions are undone before restoring
						// the original ownership edges and their identifiers.
						for (let i = undo.length - 1; i >= 0; i--) {
							try {
								undo[i]();
							} catch {
								// Custom runtime behavior can make restoration fail.
								// Keep restoring independent fields, and keep the cause.
							}
						}
					});
					this._rollbackVersion++;
					throw error;
				}
			});
		} catch (error) {
			// A failed load takes precedence over any error while flushing the
			// batch. A subscriber failure on success is not a load failure.
			throw rejection ? rejection.error : error;
		}
	}

	load(
		model: ModelAdministration,
		snapshot: Snapshot<any>,
		undo?: SnapshotUndo
	): void {
		untracked(() => {
			batch(() => {
				this.loadInBatch(model, snapshot, undo);
			});
		});
	}

	/** @internal Assumes caller is already inside untracked() + batch(). */
	loadInBatch(
		model: ModelAdministration,
		snapshot: Snapshot<any>,
		undo?: SnapshotUndo
	): void {
		const config = this.access.configuration(model);
		const clearId = this.access.snapshotIdUndo(model, snapshot);
		if (!configHasChildren(config)) {
			// Leaf hydration needs no release plan. Capture inputs before writing:
			// a snapshot getter can depend on a field we are about to replace.
			const keys = Object.keys(snapshot);
			const fields = new Array<unknown>(keys.length * 3);
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i];
				fields[3 * i] = key;
				fields[3 * i + 1] = snapshot[key];
				fields[3 * i + 2] = getConfigType(config[key]);
			}
			this.writeSnapshotFields(model, fields, undo, clearId);
			return;
		}
		const plan: SnapshotPlan = { releases: [], writes: [], undo };
		this.planSnapshot(model, snapshot, plan, clearId);
		// Release only edges absent from the final slots (at every depth)
		// before acquiring new ones. The ordinary setters still validate all
		// attachments against retained subtrees and other new children.
		for (let i = 0; i < plan.releases.length; i++) plan.releases[i]();
		for (const entry of plan.writes) {
			if (typeof entry === "function") entry();
			else
				this.writeSnapshotFields(
					entry.model,
					entry.fields,
					undo,
					entry.clearId
				);
		}
	}

	private planSnapshot(
		model: ModelAdministration,
		snapshot: Snapshot<any>,
		plan: SnapshotPlan,
		clearId?: SnapshotIdUndo
	): void {
		const config = this.access.configuration(model);
		let fields: unknown[] | undefined;
		for (const key of Object.keys(snapshot)) {
			const value = snapshot[key];
			const type = getConfigType(config[key]);
			if (type === CommonCfgTypes.child) {
				fields = undefined;
				this.planSnapshotChild(model, key, value, plan);
			} else {
				if (!fields)
					plan.writes.push({ model, fields: (fields = []), clearId });
				fields.push(key, value, type);
			}
		}
	}

	private planSnapshotChild(
		model: ModelAdministration,
		key: string,
		value: unknown,
		plan: SnapshotPlan
	): void {
		const current = this.access.peekField(model, key) as ChildField;
		const currentAdm = Array.isArray(current)
			? getAdministration(current)
			: undefined;
		const currentChildArray =
			currentAdm instanceof ChildModelsAdministration ? currentAdm : undefined;
		const memberAdms = currentChildArray
			? currentChildArray.getMemberAdms()
			: undefined;
		const currentChildren = memberAdms
			? undefined
			: this.access.extractChildModels(model, current);
		const currentCount = memberAdms
			? memberAdms.length
			: currentChildren!.length;
		let retained: Set<Model> | undefined;
		let snapshotIds: Set<IdType> | undefined;
		const Ctor = getConfigChildType(this.access.configuration(model)[key]) as
			| typeof Model
			| undefined;
		const inArray = Array.isArray(value);
		const idKey = Ctor ? getModelIdKey(Ctor) : null;
		const idBucketModels = Ctor
			? getIndexedModelsOfType(model.rawRoot, Ctor)
			: undefined;

		let prepareValue: Array<Model | Snapshot> | Model | Snapshot | null;
		let allReusedInOrder = false;

		if (inArray) {
			const arr = value as Snapshot[];
			const len = arr.length;
			allReusedInOrder =
				currentChildArray !== undefined && len === currentCount;
			let prepared: Array<Model | Snapshot> | undefined = allReusedInOrder
				? undefined
				: new Array<Model | Snapshot>(len);

			for (let i = 0; i < len; i++) {
				const entry: Snapshot | Model = arr[i] ?? {};
				let item: Model | Snapshot;
				let isModel = false;
				if (entry instanceof Model) {
					item = getModelAdm(entry).proxy as Model;
					isModel = true;
				} else {
					if (!Ctor) {
						throw new Error(
							"r-state-tree: child constructor must be specified to load snapshots with child/children. eg: `@child(ChildCtor) MyChild`"
						);
					}
					const hasId =
						idKey !== null &&
						Object.prototype.hasOwnProperty.call(entry, idKey);
					const id = hasId
						? (entry as Record<string, IdType | undefined>)[idKey!]
						: undefined;
					let matchAdm: ModelAdministration | undefined;
					if (id != null) {
						if (snapshotIds === undefined) {
							snapshotIds = new Set();
							snapshotIds.add(id);
						} else {
							const prevSize = snapshotIds.size;
							snapshotIds.add(id);
							if (snapshotIds.size === prevSize) {
								throw new Error(
									"r-state-tree duplicate ids detected after snapshot was loaded"
								);
							}
						}
						if (
							memberAdms &&
							i < currentCount &&
							memberAdms[i]._modelId === id &&
							memberAdms[i]._modelCtor === Ctor
						) {
							matchAdm = memberAdms[i];
						} else {
							matchAdm = findIndexedChildInSlot(model, key, idBucketModels, id);
						}
					} else if (Array.isArray(current)) {
						// An omitted identifier can patch the positional child. An explicit
						// unset ID describes an unidentified child, not a request to clear an
						// established ID; recreate in that case instead of changing the ID.
						if (memberAdms) {
							const posAdm = i < currentCount ? memberAdms[i] : undefined;
							if (posAdm && (!hasId || posAdm._modelId == null)) {
								matchAdm = posAdm;
							}
						} else {
							const positional = currentChildren![i];
							if (positional && (!hasId || getIdentifier(positional) == null)) {
								matchAdm = getModelAdm(positional);
							}
						}
					}
					if (matchAdm) {
						this.planSnapshot(matchAdm, entry, plan);
						item = matchAdm.proxy;
						isModel = true;
					} else {
						item = entry;
					}
				}

				if (allReusedInOrder) {
					if (item !== memberAdms![i].proxy) {
						allReusedInOrder = false;
						prepared = new Array<Model | Snapshot>(len);
						retained = new Set<Model>();
						for (let j = 0; j < i; j++) {
							const prevProxy = memberAdms![j].proxy;
							prepared[j] = prevProxy;
							retained.add(prevProxy);
						}
						prepared[i] = item;
						if (isModel) retained.add(item as Model);
					}
				} else {
					prepared![i] = item;
					if (isModel && currentCount > 0) {
						(retained ??= new Set()).add(item as Model);
					}
				}
			}
			if (allReusedInOrder) {
				const previousArray = currentChildArray!;
				const members = memberAdms!;
				plan.writes.push(() =>
					this.writeRetainedChildArray(
						model,
						key,
						previousArray,
						members,
						plan.undo
					)
				);
				return;
			}
			prepareValue = prepared!;
		} else if (value == null) {
			prepareValue = null;
		} else if (value instanceof Model) {
			const child = getModelAdm(value).proxy as Model;
			if (currentCount > 0) (retained ??= new Set()).add(child);
			prepareValue = child;
		} else {
			if (!Ctor) {
				throw new Error(
					"r-state-tree: child constructor must be specified to load snapshots with child/children. eg: `@child(ChildCtor) MyChild`"
				);
			}
			const hasId =
				idKey !== null && Object.prototype.hasOwnProperty.call(value, idKey);
			const id = hasId
				? (value as Record<string, IdType | undefined>)[idKey!]
				: undefined;
			const matchAdm =
				id == null
					? undefined
					: findIndexedChildInSlot(model, key, idBucketModels, id);
			if (matchAdm) {
				if (currentCount > 0) (retained ??= new Set()).add(matchAdm.proxy);
				this.planSnapshot(matchAdm, value as Snapshot, plan);
				prepareValue = matchAdm.proxy;
			} else {
				prepareValue = value as Snapshot;
			}
		}

		if (currentCount > 0 && (!retained || retained.size < currentCount)) {
			const remaining: Model[] = [];
			if (memberAdms) {
				for (let i = 0; i < currentCount; i++) {
					const childProxy = memberAdms[i].proxy;
					if (retained?.has(childProxy)) remaining.push(childProxy);
				}
			} else {
				for (let i = 0; i < currentCount; i++) {
					if (retained?.has(currentChildren![i]))
						remaining.push(currentChildren![i]);
				}
			}
			if (remaining.length !== currentCount) {
				plan.releases.push(() =>
					this.assignSnapshotField(
						model,
						key,
						Array.isArray(current) ? remaining : null,
						plan.undo
					)
				);
			}
		}

		plan.writes.push(() =>
			this.writeChildSlot(model, key, prepareValue, Ctor, plan.undo)
		);
	}

	private writeRetainedChildArray(
		model: ModelAdministration,
		key: string,
		previousArray: ChildModelsAdministration<Model>,
		members: ModelAdministration[],
		undo?: SnapshotUndo
	): void {
		if (
			!this.access.tryReplaceRetainedChildArray(
				model,
				key,
				previousArray,
				members
			)
		) {
			this.assignSnapshotField(
				model,
				key,
				members.map((adm) => adm.proxy),
				undo
			);
		} else if (undo) {
			undo.push(() => {
				model.proxy[key] = previousArray.proxy;
			});
		}
	}

	private writeChildSlot(
		model: ModelAdministration,
		key: string,
		value: Array<Model | Snapshot> | Model | Snapshot | null,
		Ctor: typeof Model | undefined,
		undo?: SnapshotUndo
	): void {
		if (Array.isArray(value)) {
			const len = value.length;
			const models = new Array<Model>(len);
			for (let i = 0; i < len; i++) {
				const entry = value[i];
				models[i] =
					entry instanceof Model ? entry : this.createChild(Ctor!, entry, undo);
			}
			this.assignSnapshotField(model, key, models, undo);
		} else if (value == null) {
			this.assignSnapshotField(model, key, null, undo);
		} else {
			const resolved =
				value instanceof Model ? value : this.createChild(Ctor!, value, undo);
			this.assignSnapshotField(model, key, resolved, undo);
		}
	}

	private createChild(
		Ctor: typeof Model,
		snapshot: Snapshot,
		undo?: SnapshotUndo
	): Model {
		if (!undo) {
			return Ctor.create === Model.create
				? createModelInstance(Ctor, snapshot, true)
				: Ctor.create(snapshot);
		}
		// During apply, an override still constructs without a snapshot so
		// any subsequent ownership changes join the enclosing rollback.
		if (Ctor.create !== Model.create) {
			const model = Ctor.create();
			getModelAdm(model).loadSnapshotInBatch(snapshot, undo);
			return model;
		}
		return createModelInstance(Ctor, snapshot, true, undo);
	}

	private writeSnapshotFields(
		model: ModelAdministration,
		fields: unknown[],
		undo?: SnapshotUndo,
		clearId?: SnapshotIdUndo
	): void {
		for (let i = 0; i < fields.length; i += 3) {
			this.loadSnapshotField(
				model,
				fields[i] as string,
				fields[i + 1],
				fields[i + 2] as ModelCfgTypes | CommonCfgTypes | undefined,
				undo,
				clearId
			);
		}
	}

	private loadSnapshotField(
		model: ModelAdministration,
		key: string,
		value: unknown,
		type: ModelCfgTypes | CommonCfgTypes | undefined,
		undo?: SnapshotUndo,
		clearId?: SnapshotIdUndo
	): void {
		switch (type) {
			case undefined: {
				if (!Object.prototype.hasOwnProperty.call(model.source, key)) {
					console.warn(
						`r-state-tree: invalid key '${key}' found in snapshot, ignored.`
					);
					break;
				}
				const currentValue = this.access.peekField(model, key);
				if (
					(currentValue === null || typeof currentValue !== "object") &&
					(value === null || typeof value !== "object")
				) {
					if (this.access.tryWriteScalar(model, key, currentValue, value)) {
						if (undo && !Object.is(currentValue, value))
							undo.push(() => {
								model.proxy[key] = currentValue;
							});
						break;
					}
					this.assignSnapshotField(model, key, value, undo, currentValue);
					break;
				}
				const changeTracker = { changed: false, undo, copyInput: true };
				const hydratedValue = hydrateSnapshotValue(
					currentValue,
					value,
					changeTracker
				);
				this.assignSnapshotField(model, key, hydratedValue, undo, currentValue);
				if (changeTracker.changed && Object.is(currentValue, hydratedValue)) {
					model.reportChanged();
				}
				break;
			}
			case ModelCfgTypes.transient:
				console.warn(
					`r-state-tree: transient Model key '${key}' found in snapshot, ignored.`
				);
				break;
			case ModelCfgTypes.modelRef:
				if (undo) {
					const previous = model.source[key];
					undo.push(() => this.access.writeReference(model, key, previous));
				}
				if (Array.isArray(value)) {
					if (value[0] instanceof Model) {
						model.proxy[key] = value;
					} else {
						this.access.writeReference(
							model,
							key,
							value.map((snapshot: RefSnapshot) => getSnapshotRefId(snapshot))
						);
					}
					break;
				} else if (value instanceof Model) {
					model.proxy[key] = value;
				} else if (value == null) {
					this.access.writeReference(model, key, undefined);
				} else {
					this.access.writeReference(
						model,
						key,
						getSnapshotRefId(value as RefSnapshot)
					);
				}
				break;
			case ModelCfgTypes.id:
				this.access.writeId(
					model,
					key,
					value as IdType | undefined,
					undo,
					clearId
				);
				break;
		}
	}

	private assignSnapshotField(
		model: ModelAdministration,
		key: string,
		value: unknown,
		undo?: SnapshotUndo,
		previous = this.access.peekField(model, key)
	): void {
		const hadOwn = undo && Object.hasOwn(model.source, key);
		model.proxy[key] = value;
		if (undo && !Object.is(previous, value)) {
			undo.push(() => {
				if (
					!hadOwn &&
					getConfigType(this.access.configuration(model)[key]) ===
						CommonCfgTypes.child
				)
					delete model.proxy[key];
				else model.proxy[key] = previous;
			});
		}
	}
}
