import {
	getAdministration,
	createObservableWithCustomAdministration,
	PreactObjectAdministration,
	getSource,
	batch,
	untracked,
	createComputed,
	createAtom,
	reaction,
} from "../observables/index.js";
import type { ComputedNode, AtomNode } from "../observables/index.js";
import { debugWrite, debugEnabled } from "../observables/internal/debug.js";
import { getPropertyDescriptor } from "../observables/internal/utils.js";
import Model from "../model/Model.js";
import type {
	ModelConfiguration,
	IdType,
	Snapshot,
	SnapshotChange,
	RefSnapshot,
} from "../types.js";
import { ModelCfgTypes, CommonCfgTypes } from "../types.js";
import {
	getIdentifier,
	getModelById,
	onModelAttached,
	onModelDetached,
	validateModelAttachments,
	setIdentifier,
} from "./idMap.js";
import { clone, hydrateSnapshotValue } from "../utils.js";
import {
	getConfigChildType,
	getConfigType,
	getConfigurationForCtor,
} from "../configuration.js";
import { ChildModelsAdministration } from "./ChildModelsAdministration.js";

const ctorIdKeyMap: WeakMap<typeof Model, IdType | null> = new WeakMap();
const configMap: WeakMap<object, ModelConfiguration<unknown>> = new WeakMap();
let snapshotRollbackVersion = 0;

// Snapshots contain only primitives, arrays, and plain objects. Compare values
// only after rollback, when reloading can create an equivalent new snapshot.
function equalSnapshots(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (!left || !right || typeof left !== "object" || typeof right !== "object")
		return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	if (Array.isArray(left) && left.length !== (right as unknown[]).length)
		return false;
	const keys = Object.keys(left);
	return (
		keys.length === Object.keys(right).length &&
		keys.every(
			(key) =>
				Object.hasOwn(right, key) &&
				equalSnapshots(
					(left as Record<string, unknown>)[key],
					(right as Record<string, unknown>)[key]
				)
		)
	);
}

export function getConfigurationFromSnapshot(
	snapshot: object
): ModelConfiguration<unknown> | undefined {
	return configMap.get(snapshot);
}

export function getModelAdm<T extends Model>(model: T): ModelAdministration {
	return getAdministration(model)! as unknown as ModelAdministration;
}

function getIdKey(Ctor: typeof Model): string | number | null {
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

function getModelRefSnapshotFromId(
	Ctor: typeof Model,
	id: IdType
): RefSnapshot | null {
	const idKey = getIdKey(Ctor);
	return idKey ? { [idKey]: id } : null;
}

function getSnapshotId(snapshot: Snapshot, Ctor: typeof Model): IdType | null {
	const idKey = getIdKey(Ctor);

	return idKey ? ((snapshot as any)[idKey] as IdType) : null;
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

function validateModelChildValue(
	value: unknown,
	propertyName: PropertyKey
): void {
	if (value === null || value === undefined) {
		return;
	}

	if (value instanceof Model) {
		return;
	}

	if (Array.isArray(value)) {
		const invalidItem = value.find((item) => !(item instanceof Model));
		if (invalidItem !== undefined) {
			throw new Error(
				`r-state-tree: child property '${String(
					propertyName
				)}' must be a Model instance, an array of Model instances, or null/undefined. Found invalid array item: ${typeof invalidItem}`
			);
		}
		return;
	}

	throw new Error(
		`r-state-tree: child property '${String(
			propertyName
		)}' must be a Model instance, an array of Model instances, or null/undefined. Found: ${typeof value}`
	);
}

function isManagedField(type: ModelCfgTypes | CommonCfgTypes | undefined) {
	return (
		type === CommonCfgTypes.child ||
		type === ModelCfgTypes.id ||
		type === ModelCfgTypes.modelRef
	);
}

export class ModelAdministration extends PreactObjectAdministration<any> {
	private getCfgType(
		name: PropertyKey
	): ModelCfgTypes | CommonCfgTypes | undefined {
		return getConfigType(this.configuration[name as any]) as any;
	}

	private getCfgChildType(name: PropertyKey): Function | undefined {
		return getConfigChildType(this.configuration[name as any]);
	}

	static proxyTraps: ProxyHandler<object> = Object.assign(
		{},
		PreactObjectAdministration.proxyTraps,
		{
			get(target, prop, proxy) {
				const adm = getAdministration(target) as ModelAdministration;
				if (prop === Symbol.dispose) {
					return Reflect.get(target, prop, proxy);
				}
				if (prop === "parent") {
					return (target as Model).parent;
				}
				switch (adm.getCfgType(prop)) {
					case ModelCfgTypes.modelRef:
						if (Array.isArray(adm.source[prop])) {
							return adm.getModelRefs(prop);
						}
						return adm.getModelRef(prop);
					default:
						return PreactObjectAdministration.proxyTraps.get?.apply(
							null,
							arguments as any
						);
				}
			},
			set(target, name, value, receiver) {
				const adm = getAdministration(target) as ModelAdministration;
				adm.assertUsable();
				const type = adm.getCfgType(name);
				if (isManagedField(type)) {
					if (receiver !== adm.proxy) {
						throw new TypeError(
							`r-state-tree: cannot write managed model field '${String(name)}' on a different receiver`
						);
					}
					if (!adm.canWriteManagedField(name)) return false;
				}
				adm.writeInProgress.add(name);
				try {
					switch (type) {
						case ModelCfgTypes.modelRef: {
							Array.isArray(value)
								? adm.setModelRefs(name, value)
								: adm.setModelRef(name, value as Model | undefined);
							return true;
						}
						case CommonCfgTypes.child: {
							validateModelChildValue(value, name);
							return Array.isArray(value)
								? adm.setModels(name, value)
								: adm.setModel(name, value);
						}
						case ModelCfgTypes.id: {
							return adm.setId(name as string, value as IdType);
						}
					}

					return PreactObjectAdministration.proxyTraps.set?.apply(
						null,
						arguments as any
					);
				} finally {
					adm.writeInProgress.delete(name);
				}
			},

			defineProperty(target, name, desc) {
				const adm = getAdministration(target) as ModelAdministration;
				// Reflect.set reenters this trap while writing the backing field.
				// A later reentrant reaction is not an internal write.
				if (
					!(adm.isWriting && adm.writeInProgress.has(name)) &&
					isManagedField(adm.getCfgType(name))
				) {
					if (
						!("value" in desc) ||
						desc.configurable === false ||
						desc.writable === false ||
						desc.enumerable === false
					) {
						throw new TypeError(
							`r-state-tree: managed model field '${String(name)}' only supports ordinary data writes`
						);
					}
					return Reflect.set(adm.proxy, name, desc.value);
				}

				const recording = debugEnabled && !adm.writeInProgress.has(name);
				const before = recording
					? Object.getOwnPropertyDescriptor(target, name)?.value
					: undefined;
				const result = Reflect.defineProperty(target, name, desc);
				if (recording && result)
					debugWrite(
						target,
						name,
						"define",
						before,
						"value" in desc ? desc.value : undefined
					);
				return result;
			},

			// Seal and freeze both reach this trap before modifying any descriptors.
			preventExtensions(): never {
				throw new TypeError(
					"r-state-tree: Model instances must remain extensible"
				);
			},

			deleteProperty(target, name) {
				const adm = getAdministration(target) as ModelAdministration;
				switch (adm.getCfgType(name)) {
					case CommonCfgTypes.child:
						return adm.removeChildField(name);
					case ModelCfgTypes.id:
					case ModelCfgTypes.modelRef:
						throw new TypeError(
							`r-state-tree: cannot delete managed model field '${String(name)}'`
						);
					default:
						return PreactObjectAdministration.proxyTraps.deleteProperty!(
							target,
							name
						);
				}
			},
		} as ProxyHandler<object>
	);

	private configurationGetter?: () => ModelConfiguration<any>;
	private _parent: ModelAdministration | null = null;
	private parentAtom: AtomNode = createAtom();
	referencedAtoms!: Map<PropertyKey, AtomNode>;
	referencedModels!: Map<PropertyKey, ComputedNode<Model[]>>;
	activeModels: Set<PropertyKey> = new Set();
	private modelsTraceUnsub: Map<PropertyKey, () => void> = new Map();
	private writeInProgress: Set<PropertyKey> = new Set();
	private computedSnapshot: ComputedNode<Snapshot<Model>> | undefined;
	private snapshotMap: Map<string, ComputedNode<unknown[]>> = new Map();
	private disposed = false;
	parentName: PropertyKey | null = null;

	get parent(): ModelAdministration | null {
		this.parentAtom.reportObserved();
		return this._parent;
	}

	set parent(value: ModelAdministration | null) {
		if (this._parent !== value) {
			this._parent = value;
			this.parentAtom.reportChanged();
		}
	}

	setConfiguration(configurationGetter: () => ModelConfiguration<any>): void {
		this.configurationGetter = configurationGetter;
	}

	assertUsable(): void {
		if (this.disposed) {
			throw new Error("r-state-tree: cannot use a disposed model");
		}
	}

	private get configuration(): ModelConfiguration<any> {
		return this.configurationGetter?.() ?? {};
	}

	/** Retained runtime metadata; snapshots intentionally have different semantics. */
	getInspectionMetadata() {
		return {
			fields: Reflect.ownKeys(this.configuration).map((key) => ({
				key,
				type: getConfigType(this.configuration[key as string]),
			})),
			parent: this.parent?.proxy ?? null,
			status: this.disposed ? "disposed" : "active",
		} as const;
	}

	private getReferencedAtom(name: PropertyKey): AtomNode {
		let a = this.referencedAtoms?.get(name);
		if (!a) {
			if (!this.referencedAtoms) this.referencedAtoms = new Map();
			a = createAtom();
			this.referencedAtoms.set(name, a!);
		}

		return a!;
	}

	private writeReference(name: PropertyKey, value: unknown): void {
		const before = debugEnabled ? this.source[name] : undefined;
		this.source[name] = value;
		if (debugEnabled && before !== value)
			debugWrite(this.source, name, "set", before, value);
		this.referencedAtoms?.get(name)?.reportChanged();
	}

	private setId(name: string, v: IdType): boolean {
		const id = getIdentifier(this.proxy);

		// Undefined IDs still need the backing field initialized.
		if (id !== undefined && id === v) {
			return true;
		}

		if (id != null && v == null) {
			throw new Error(
				"r-state-tree can't clear an id once it has already been set."
			);
		}

		return batch(() => {
			if (v !== undefined) {
				setIdentifier(this.proxy, v);
			}
			// Publish the field through the observable write path, in the same
			// batch as the index update so observers only see a consistent identity.
			return this.write(name, v);
		});
	}

	private canWriteManagedField(name: PropertyKey): boolean {
		const own = Object.getOwnPropertyDescriptor(this.source, name);
		if (own) return own.writable === true;
		if (getPropertyDescriptor(this.source, name)) {
			throw new TypeError(
				`r-state-tree: managed model field '${String(name)}' cannot be inherited from a prototype`
			);
		}
		return Object.isExtensible(this.source);
	}

	private setModel(
		name: PropertyKey,
		value: Model | null | undefined
	): boolean {
		const model = value ? (getModelAdm(value).proxy as Model) : value;
		return this.changeChildField(name, model, () => this.write(name, model));
	}

	private removeChildField(name: PropertyKey): boolean {
		this.assertUsable();
		const own = Object.getOwnPropertyDescriptor(this.source, name);
		if (!own) return true;
		if (!own.configurable) return false;
		const prototype = Object.getPrototypeOf(this.source);
		if (
			!("value" in own) ||
			(prototype && getPropertyDescriptor(prototype, name))
		) {
			throw new TypeError(
				`r-state-tree: cannot delete managed model field '${String(name)}' with an accessor or prototype definition`
			);
		}
		return this.changeChildField(name, undefined, () => this.remove(name));
	}

	private changeModels(
		name: PropertyKey,
		added: Model[],
		removed: Model[],
		commit: () => void | boolean
	): boolean {
		this.assertUsable();
		const removedSet = new Set(removed.map((model) => getModelAdm(model)));
		const addedSet = new Set(added.map((model) => getModelAdm(model)));
		for (const adm of addedSet) {
			adm.assertUsable();
			let ancestor: ModelAdministration | null = this;
			while (ancestor) {
				if (ancestor === adm)
					throw new Error("r-state-tree: cannot attach an ancestor as a child");
				ancestor = ancestor.parent;
			}
			if (
				adm.parent &&
				!(removedSet.has(adm) && adm.parent === this && adm.parentName === name)
			) {
				throw new Error(
					"r-state-tree: child model already attached to a parent. Did you mean to use modelRef?"
				);
			}
		}
		const detaching = [...removedSet].filter((adm) => !addedSet.has(adm));
		const attaching = [...addedSet].filter((adm) => !removedSet.has(adm));
		validateModelAttachments(
			this.proxy,
			attaching.map((adm) => adm.proxy),
			detaching.map((adm) => adm.proxy)
		);
		if (commit() === false) return false;
		for (const adm of detaching) adm.detach();
		for (const adm of attaching) adm.attach(this, name);
		return true;
	}

	private changeChildField(
		name: PropertyKey,
		value: Model | Model[] | null | undefined,
		commit: () => boolean
	): boolean {
		const current = this.proxy[name] as Model | Model[] | null | undefined;
		if (Array.isArray(current)) {
			(
				getAdministration(current) as ChildModelsAdministration<Model>
			).assertMutable();
		}
		// Ownership follows the indexed members, not a caller's custom iterator.
		const children = (field: typeof value) =>
			Array.isArray(field)
				? Array.from({ length: field.length }, (_, index) => field[index])
				: field
					? [field]
					: [];
		return batch(() => {
			if (!this.changeModels(name, children(value), children(current), commit))
				return false;
			this.modelsTraceUnsub.get(name)?.();
			this.modelsTraceUnsub.delete(name);
			if (value) this.activeModels.add(name);
			else this.activeModels.delete(name);
			if (Array.isArray(value)) {
				const adm = getAdministration(
					value
				) as ChildModelsAdministration<Model>;
				adm.change = (added, removed, commit) => {
					this.changeModels(name, added, removed, commit);
				};
				this.modelsTraceUnsub.set(name, () => {
					adm.change = undefined;
				});
			}
			return true;
		});
	}

	private setModels(name: PropertyKey, newModelsSource: Model[]): boolean {
		if (this.proxy[name] === newModelsSource) return true;
		const newModels = createObservableWithCustomAdministration(
			[] as Model[],
			ChildModelsAdministration
		);
		newModels.push(...newModelsSource);
		return this.changeChildField(name, newModels, () =>
			this.write(name, newModels)
		);
	}

	private getModelRef(name: PropertyKey): Model | undefined {
		const a = this.getReferencedAtom(name);

		a.reportObserved();
		const Type = this.getRequiredModelRefType(name);
		const root = this.root.proxy;
		return this.source[name] != null
			? getModelById(root, Type, this.source[name] as IdType)
			: undefined;
	}

	private getModelRefs(name: PropertyKey): Model[] {
		const a = this.getReferencedAtom(name);

		let c = this.referencedModels?.get(name);

		if (!c) {
			if (!this.referencedModels) this.referencedModels = new Map();
			c = createComputed(() => {
				a.reportObserved();
				const Type = this.getRequiredModelRefType(name);
				const root = this.root.proxy;
				const models = (this.source[name] || [])
					.map((id: IdType) => getModelById(root, Type, id))
					.filter((m: Model | undefined) => !!m);

				return models;
			});

			this.referencedModels.set(name, c);
		}

		return c.get();
	}

	private setModelRef(name: PropertyKey, modelValue: Model | undefined): void {
		let id = undefined;

		if (modelValue) {
			this.assertModelRefType(name, modelValue);
			id = getIdentifier(modelValue);
			if (id == null) {
				throw new Error(
					"r-state-tree: Only models with identifiers can be used as a ref"
				);
			}
		}

		this.writeReference(name, id);
	}

	private setModelRefs(name: PropertyKey, modelValue: Model[]): void {
		const ids = modelValue.map((model) => {
			this.assertModelRefType(name, model);
			const id = getIdentifier(model);
			if (id == null) {
				throw new Error(
					"r-state-tree: Only models with identifiers can be used as a ref"
				);
			}

			return id;
		});

		this.writeReference(name, ids);
	}

	private getRequiredModelRefType(name: PropertyKey): typeof Model {
		const Type = this.getCfgChildType(name) as typeof Model | undefined;
		if (!Type) {
			throw new Error(
				`r-state-tree: modelRef '${String(name)}' requires a model constructor`
			);
		}
		return Type;
	}

	private assertModelRefType(name: PropertyKey, model: Model): void {
		const Type = this.getRequiredModelRefType(name);
		if (!(model instanceof Type)) {
			throw new Error(
				`r-state-tree: modelRef '${String(name)}' must reference ${Type.name}`
			);
		}
	}

	private attach(
		parent: ModelAdministration | null = null,
		parentName: PropertyKey | null = null
	): void {
		this.assertUsable();
		if (this.parent) {
			throw new Error(
				"r-state-tree: child model already attached to a parent. Did you mean to use modelRef?"
			);
		}

		batch(() => {
			if (parent) {
				this.parent = parent;
				this.parentName = parentName;
			}
			try {
				onModelAttached(this.proxy);
			} catch (error) {
				this.parent = null;
				this.parentName = null;
				throw error;
			}
		});
	}

	get root(): ModelAdministration {
		const parent = this.parent;
		return parent ? parent.root : this;
	}

	private detach(): void {
		batch(() => {
			onModelDetached(this.proxy);
			this.parent = null;
			this.parentName = null;
		});
	}

	dispose(internal = false): void {
		if (this.disposed) return;
		if (!internal && this.parent) {
			throw new Error(
				"r-state-tree: cannot directly dispose an attached child model"
			);
		}
		batch(() => {
			this.activeModels.forEach((name) => {
				const child = this.proxy[name] as Model | Model[] | null | undefined;
				if (Array.isArray(child)) {
					child.forEach((model) => getModelAdm(model).dispose(true));
				} else if (child) {
					getModelAdm(child).dispose(true);
				}
			});
			if (this.parent) onModelDetached(this.proxy);
			this.parent = null;
			this.parentName = null;
		});
		this.disposed = true;
		this.modelsTraceUnsub.forEach((dispose) => dispose());
		this.modelsTraceUnsub.clear();
	}

	private toJSON(): Snapshot<Model> {
		const keys = new Set([
			...Object.keys(this.source),
			...Object.keys(this.configuration),
		]);
		return Array.from(keys).reduce((json: any, key) => {
			switch (getConfigType(this.configuration[key])) {
				case ModelCfgTypes.transient:
					break;
				case ModelCfgTypes.id:
					json[key] = clone(getSource(this.proxy[key]), key);
					break;
				case ModelCfgTypes.modelRef:
					this.getReferencedAtom(key).reportObserved();
					const Type = this.getRequiredModelRefType(key);
					const reference = this.source[key] as
						| IdType
						| IdType[]
						| null
						| undefined;
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
				case CommonCfgTypes.child:
					const child: Model | Model[] | undefined = this.proxy[key];
					if (Array.isArray(child)) {
						if (!this.snapshotMap.has(key)) {
							this.snapshotMap.set(
								key,
								createComputed(() => {
									return getSource(
										(this.proxy[key] ?? []).map((model: Model) =>
											getModelAdm(model).getSnapshot()
										)
									);
								})
							);
						}
						json[key] = this.snapshotMap.get(key)!.get();
						break;
					}
					json[key] = child ? getModelAdm(child).getSnapshot() : null;
					break;
				default:
					if (Object.prototype.hasOwnProperty.call(this.source, key)) {
						json[key] = clone(this.proxy[key], key);
					}
					break;
			}
			return json;
		}, {}) as Snapshot<any>;
	}

	validateSnapshotFields(): void {
		Object.keys(this.source).forEach((key) => {
			if (this.getCfgType(key) === undefined) {
				try {
					clone(this.proxy[key], key);
				} catch (error) {
					if (error instanceof Error) {
						throw new Error(
							`${error.message} Mark runtime-only Model fields with @transient.`,
							{ cause: error }
						);
					}
					throw error;
				}
			}
		});
	}

	recordSnapshotRollback(): void {
		snapshotRollbackVersion++;
	}

	onSnapshotChange(onChange: SnapshotChange<any>): () => void {
		let rollbackVersion = snapshotRollbackVersion;
		return reaction(
			() => this.getSnapshot(),
			(snapshot, previous) => {
				const rolledBack = rollbackVersion !== snapshotRollbackVersion;
				rollbackVersion = snapshotRollbackVersion;
				// A lasting change in the same outer batch must still be delivered.
				if (!rolledBack || !equalSnapshots(snapshot, previous))
					onChange(snapshot, this.proxy);
			}
		);
	}

	loadSnapshot(snapshot: Snapshot<any>): void {
		const ensureChildTypes = (key: string): true => {
			const childType = this.getCfgChildType(key);
			if (!childType) {
				throw new Error(
					"r-state-tree: child constructor must be specified to load snapshots with child/children. eg: `@child(ChildCtor) MyChild`"
				);
			}

			return true;
		};

		untracked(() => {
			batch(() => {
				let hasInPlaceStateChange = false;
				Object.keys(snapshot).forEach((key) => {
					const type = this.getCfgType(key);
					const childType = this.getCfgChildType(key);
					const value = snapshot[key];

					switch (type) {
						case undefined: {
							if (!Object.prototype.hasOwnProperty.call(this.source, key)) {
								console.warn(
									`r-state-tree: invalid key '${key}' found in snapshot, ignored.`
								);
								break;
							}
							const currentValue = this.proxy[key];
							const changeTracker = { changed: false };
							const hydratedValue = hydrateSnapshotValue(
								currentValue,
								value,
								changeTracker
							);
							this.proxy[key] = hydratedValue;
							if (
								changeTracker.changed &&
								Object.is(currentValue, hydratedValue)
							) {
								hasInPlaceStateChange = true;
							}
							break;
						}
						case ModelCfgTypes.transient:
							console.warn(
								`r-state-tree: transient Model key '${key}' found in snapshot, ignored.`
							);
							break;
						case ModelCfgTypes.modelRef:
							if (Array.isArray(value)) {
								if ((value as unknown[])?.[0] instanceof Model) {
									this.proxy[key] = value;
								} else {
									this.writeReference(
										key,
										value.map((snapshot: RefSnapshot) =>
											getSnapshotRefId(snapshot)
										)
									);
								}
								break;
							} else if (value instanceof Model) {
								this.proxy[key] = value;
							} else if (value == null) {
								this.writeReference(key, undefined);
							} else {
								this.writeReference(key, getSnapshotRefId(value));
							}
							break;
						case ModelCfgTypes.id:
							this.proxy[key] = value;
							break;
						case CommonCfgTypes.child:
							if (value == null) {
								this.proxy[key] = null;
								break;
							}

							let model: Model;

							if (Array.isArray(value)) {
								const Ctor = childType as typeof Model;
								const snapshotIds = new Set<IdType>();
								for (const childSnapshot of value as Snapshot[]) {
									if (childSnapshot instanceof Model) continue;
									const snapshotId = childType
										? getSnapshotId(childSnapshot ?? {}, Ctor)
										: null;
									if (snapshotId != null && snapshotIds.has(snapshotId)) {
										throw new Error(
											"r-state-tree duplicate ids detected after snapshot was loaded"
										);
									}
									if (snapshotId != null) snapshotIds.add(snapshotId);
								}
								this.proxy[key] = (value as Snapshot[])?.map(
									(snapshot, index) => {
										snapshot = snapshot ?? {};
										let model: Model;
										if (snapshot instanceof Model) {
											model = snapshot;
										} else {
											ensureChildTypes(key);

											const id = childType && getSnapshotId(snapshot, Ctor);
											const foundModel =
												id != null
													? getModelById(this.root.proxy, Ctor, id)
													: this.proxy[key]?.[index];
											const adm = foundModel && getModelAdm(foundModel);

											if (
												adm &&
												foundModel!.parent === this.proxy &&
												adm?.parentName === key
											) {
												adm.loadSnapshot(snapshot);
												model = foundModel!;
											} else {
												model = Ctor.create(snapshot);
											}
										}

										return model;
									}
								);
								break;
							} else if (value instanceof Model) {
								model = value;
							} else {
								ensureChildTypes(key);

								const id =
									childType &&
									getSnapshotId(value as Snapshot, childType as typeof Model);

								if (
									id != null &&
									this.proxy[key] &&
									this.proxy[key] instanceof (childType as typeof Model) &&
									id === getIdentifier(this.proxy[key])
								) {
									const adm = getModelAdm(this.proxy[key]);
									adm.loadSnapshot(value as Snapshot);
									model = this.proxy[key];
								} else {
									model = (childType as typeof Model).create(value as Snapshot);
								}
							}

							this.proxy[key] = model;
							break;
						default:
							console.warn(
								`r-state-tree: invalid key '${key}' found in snapshot, ignored.`
							);
					}
				});
				if (hasInPlaceStateChange) {
					this.atom.reportChanged();
				}
			});
		});
	}

	getSnapshot(): Snapshot<any> {
		if (!this.computedSnapshot) {
			this.computedSnapshot = createComputed(() => {
				const snapshot = this.toJSON();
				configMap.set(snapshot, this.configuration);
				return snapshot;
			});
		}

		return this.computedSnapshot.get() as Snapshot<any>;
	}

	getSnapshotForRollback(): Snapshot<any> {
		return this.toJSON();
	}
}
