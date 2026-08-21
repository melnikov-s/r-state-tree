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
} from "../observables";
import type { ComputedNode, AtomNode } from "../observables";
import Model from "../model/Model";
import type {
	ModelConfiguration,
	IdType,
	Snapshot,
	SnapshotChange,
	RefSnapshot,
} from "../types";
import { ModelCfgTypes, CommonCfgTypes } from "../types";
import {
	getIdentifier,
	getModelById,
	onModelAttached,
	onModelDetached,
	setIdentifier,
} from "./idMap";
import { clone, hydrateSnapshotValue } from "../utils";
import {
	getConfigChildType,
	getConfigType,
	getConfigurationForCtor,
} from "../configuration";
import {
	ChildModelsAdministration,
	observe,
} from "./ChildModelsAdministration";
import type { MutationEvent } from "./ChildModelsAdministration";

const ctorIdKeyMap: WeakMap<typeof Model, IdType | null> = new WeakMap();
const configMap: WeakMap<object, ModelConfiguration<unknown>> = new WeakMap();

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
			set(target, name, value) {
				const adm = getAdministration(target) as ModelAdministration;
				adm.assertUsable();
				adm.writeInProgress.add(name);
				try {
					switch (adm.getCfgType(name)) {
						case ModelCfgTypes.modelRef: {
							Array.isArray(value)
								? adm.setModelRefs(name, value)
								: adm.setModelRef(name, value as Model | undefined);
							return true;
						}
						case CommonCfgTypes.child: {
							validateModelChildValue(value, name);
							if (Array.isArray(value)) {
								adm.setModels(name, value);
								return true;
							} else {
								adm.setModel(name, value ?? (null as Model | null));
								break;
							}
						}
						case ModelCfgTypes.id: {
							adm.setId(name as string, value as IdType);
							break;
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
				// if we don't check for writeInProgress we will blow the stack
				// as Reflect.set will eventually trigger defineProperty proxy handler
				if (desc && "value" in desc && !adm.writeInProgress.has(name)) {
					switch (adm.getCfgType(name)) {
						case ModelCfgTypes.modelRef:
						case CommonCfgTypes.child:
						case ModelCfgTypes.id: {
							adm.proxy[name] = desc.value;
							return true;
						}
					}
				}

				return Reflect.defineProperty(target, name, desc);
			},
		} as ProxyHandler<object>
	);

	private configurationGetter?: () => ModelConfiguration<any>;
	private _parent: ModelAdministration | null = null;
	private parentAtom: AtomNode = createAtom();
	referencedAtoms!: Map<PropertyKey, AtomNode>;
	referencedModels!: Map<PropertyKey, ComputedNode<Model[]>>;
	activeModels: Set<PropertyKey> = new Set();
	root: ModelAdministration = this;
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

	private getReferencedAtom(name: PropertyKey): AtomNode {
		let a = this.referencedAtoms?.get(name);
		if (!a) {
			if (!this.referencedAtoms) this.referencedAtoms = new Map();
			a = createAtom();
			this.referencedAtoms.set(name, a!);
		}

		return a!;
	}

	private setId(name: string, v: IdType): void {
		const id = getIdentifier(this.proxy);

		if (id === v) {
			return;
		}

		if (id != null && v == null) {
			throw new Error(
				"r-state-tree can't clear an id once it has already been set."
			);
		}

		if (v !== undefined) {
			setIdentifier(this.proxy, v);
			this.source[name] = v;
		}
	}

	private setModel(name: PropertyKey, newModel: Model | null): void {
		validateModelChildValue(newModel, name);
		const currentValue = this.proxy[name];

		if (currentValue === newModel) {
			return;
		}

		this.activeModels.add(name);

		// Handle switching from array to single: clean up the array first
		if (Array.isArray(currentValue)) {
			const oldModels = currentValue as Model[];
			oldModels.forEach((child) => getModelAdm(child).detach());
			// Unsub from model trace if it exists
			this.modelsTraceUnsub.get(name)?.();
			this.modelsTraceUnsub.delete(name);
		} else if (currentValue) {
			// Handle normal single model replacement
			getModelAdm(currentValue).detach();
		}

		if (newModel) {
			const adm = getModelAdm(newModel);
			adm.attach(this, name);
		}
	}

	private setModels(name: PropertyKey, newModelsSource: Model[]): void {
		validateModelChildValue(newModelsSource, name);
		const newModels = createObservableWithCustomAdministration(
			[] as Model[],
			ChildModelsAdministration
		);

		newModels.push(...newModelsSource);

		const currentValue = this.proxy[name];

		if (currentValue === newModels) {
			return;
		}

		this.activeModels.add(name);

		// Handle switching from single to array: clean up the single model first
		if (currentValue && !Array.isArray(currentValue)) {
			getModelAdm(currentValue).detach();
		} else if (Array.isArray(currentValue)) {
			// Handle normal array replacement
			const oldModels = currentValue as Model[];
			// Use getSource to normalize comparison - currentValue may contain proxies
			const newModelSet = new Set(newModels.map((m) => getSource(m)));

			oldModels.forEach(
				(child) =>
					newModelSet.has(getSource(child)) || getModelAdm(child).detach()
			);

			// unsub from old model trace
			this.modelsTraceUnsub.get(name)?.();
		}

		// set the model on the observable proxy
		PreactObjectAdministration.proxyTraps.set!(
			this.source,
			name as string,
			newModels,
			this.proxy
		);

		// Observe ownership changes so models attach and detach with the collection.
		// on the observable proxy.
		this.modelsTraceUnsub.set(
			name,
			observe(this.proxy[name], (event: MutationEvent<Model>) => {
				if (event.type === "updateArray") {
					const oldAdm = getModelAdm(event.oldValue);
					const newAdm = getModelAdm(event.newValue);
					oldAdm.detach();
					try {
						newAdm.attach(this, name);
					} catch (error) {
						oldAdm.attach(this, name);
						throw error;
					}
				} else if (event.type === "spliceArray") {
					const attached: Model[] = [];
					event.removed.forEach((model) => getModelAdm(model).detach());
					try {
						event.added.forEach((model) => {
							getModelAdm(model).attach(this, name);
							attached.push(model);
						});
					} catch (error) {
						attached.forEach((model) => getModelAdm(model).detach());
						event.removed.forEach((model) =>
							getModelAdm(model).attach(this, name)
						);
						throw error;
					}
				}
			})
		);

		const oldModelSet = Array.isArray(currentValue)
			? new Set((currentValue as Model[]).map((m) => getSource(m)))
			: new Set();

		newModels.forEach((child) => {
			if (!oldModelSet.has(getSource(child))) {
				const internalModel = getModelAdm(child);
				internalModel.attach(this, name);
			}
		});
	}

	private getModelRef(name: PropertyKey): Model | undefined {
		const a = this.getReferencedAtom(name);

		a.reportObserved();
		const Type = this.getRequiredModelRefType(name);
		const root = this.getReactiveRoot().proxy;
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
				const root = this.getReactiveRoot().proxy;
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

		this.source[name] = id;

		this.referencedAtoms?.get(name)?.reportChanged();
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

		this.source[name] = ids;

		this.referencedAtoms?.get(name)?.reportChanged();
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
				this.root = parent.root;
				this.parentName = parentName;
			}
			try {
				onModelAttached(this.proxy);
			} catch (error) {
				this.parent = null;
				this.root = this;
				this.parentName = null;
				throw error;
			}
		});
	}

	private getReactiveRoot(): ModelAdministration {
		const parent = this.parent;
		return parent ? parent.getReactiveRoot() : this;
	}

	private detach(): void {
		batch(() => {
			onModelDetached(this.proxy);
			this.parent = null;
			this.parentName = null;
			this.root = this;
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
			this.root = this;
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

	onSnapshotChange(onChange: SnapshotChange<any>): () => void {
		return reaction(
			() => this.getSnapshot(),
			(snapshot) => onChange(snapshot, this.proxy)
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
									this.source[key] = value.map((snapshot: RefSnapshot) =>
										getSnapshotRefId(snapshot)
									);
									this.referencedAtoms?.get(key)?.reportChanged();
								}
								break;
							} else if (value instanceof Model) {
								this.proxy[key] = value;
							} else if (value == null) {
								this.source[key] = undefined;
								this.referencedAtoms?.get(key)?.reportChanged();
							} else {
								this.source[key] = getSnapshotRefId(value);
								this.referencedAtoms?.get(key)?.reportChanged();
							}
							break;
						case ModelCfgTypes.id:
							this.setId(key, value as IdType);
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
													: this.proxy[key][index];
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
				const json = this.toJSON();
				configMap.set(json, this.configuration);

				return json;
			});
		}

		return this.computedSnapshot.get() as Snapshot<any>;
	}

	getSnapshotForRollback(): Snapshot<any> {
		return this.toJSON();
	}
}
