import {
	getAdministration,
	createObservableWithCustomAdministration,
	PreactObjectAdministration,
	getSource,
	batch,
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
	onSnapshotLoad,
} from "./idMap";
import { clone } from "../utils";
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
		const key =
			Object.keys(Ctor.types).find(
				(prop) =>
					(Ctor.types[prop as keyof typeof Ctor.types] as any).type ===
					ModelCfgTypes.id
			) ?? null;

		ctorIdKeyMap.set(Ctor, key);
	}

	return ctorIdKeyMap.get(Ctor) ?? null;
}

function getModelRefSnapshot<T extends Model>(modelRef: T): RefSnapshot | null {
	const Ctor = Object.getPrototypeOf(modelRef).constructor as typeof Model;
	const idKey = getIdKey(Ctor);

	return idKey ? { [idKey]: getIdentifier(modelRef)! } : null;
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
	static proxyTraps: ProxyHandler<object> = Object.assign(
		{},
		PreactObjectAdministration.proxyTraps,
		{
			get(target, prop, proxy) {
				const adm = getAdministration(target) as ModelAdministration;
				if (prop === "parent") {
					return (target as Model).parent;
				}
				switch (adm.configuration[prop as string]?.type) {
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
				adm.writeInProgress.add(name);
				try {
					switch (adm.configuration[name as string]?.type) {
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
						case ModelCfgTypes.state: {
							adm.setState(name as string, value);
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
					switch (adm.configuration[name as string]?.type) {
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
	private contextCache = new Map<symbol, ComputedNode<unknown>>();
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

	private setState(name: string, value: unknown): void {
		const oldValue = this.source[name];
		if (value !== oldValue) {
			batch(() => {
				PreactObjectAdministration.proxyTraps.set!(
					this.source,
					name,
					value,
					this.proxy
				);
			});
		}
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
			this.source[name] = v;
			setIdentifier(this.proxy, v);
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

		// sub to new model trace so that we mount/unmount models as they change
		// on the observable proxy.
		this.modelsTraceUnsub.set(
			name,
			observe(this.proxy[name], (event: MutationEvent<Model>) => {
				if (event.type === "updateArray") {
					getModelAdm(event.oldValue).detach();
					getModelAdm(event.newValue).attach(this, name);
				} else if (event.type === "spliceArray") {
					event.removed.forEach((model) => getModelAdm(model).detach());
					event.added.forEach((model) => getModelAdm(model).attach(this, name));
				}
			})
		);

		newModels.forEach((child) => {
			// Use getSource to normalize comparison - currentValue may contain proxies
			const oldModelSet = Array.isArray(currentValue)
				? new Set((currentValue as Model[]).map((m) => getSource(m)))
				: new Set();
			if (!oldModelSet.has(getSource(child))) {
				const internalModel = getModelAdm(child);
				internalModel.attach(this, name);
			}
		});
	}

	private getModelRef(name: PropertyKey): Model | undefined {
		const a = this.getReferencedAtom(name);

		a.reportObserved();
		return this.source[name] != null
			? getModelById(this.root.proxy, this.source[name] as IdType)
			: undefined;
	}

	private getModelRefs(name: PropertyKey): Model[] {
		const a = this.getReferencedAtom(name);

		let c = this.referencedModels?.get(name);

		if (!c) {
			if (!this.referencedModels) this.referencedModels = new Map();
			c = createComputed(() => {
				a.reportObserved();
				const models = (this.source[name] || [])
					.map((id: IdType) => getModelById(this.root.proxy, id))
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

	private attach(
		parent: ModelAdministration | null = null,
		parentName: PropertyKey | null = null
	): void {
		if (this.parent) {
			throw new Error(
				"r-state-tree: child model already attached to a parent. Did you mean to use modelRef?"
			);
		}

		if (parent) {
			this.parent = parent;
			this.root = parent.root;
			this.parentName = parentName;
		}

		batch(() => {
			onModelAttached(this.proxy);
			this.proxy.modelDidAttach();
		});
	}

	private detach(): void {
		batch(() => {
			this.proxy.modelWillDetach();
			onModelDetached(this.proxy);
		});

		this.contextCache.forEach((computed) => computed.clear());
		this.contextCache.clear();
		this.parent = null;
		this.root = this;
	}

	getContextValue<T>(
		contextId: symbol,
		provideSymbol: symbol,
		defaultValue: T | undefined,
		hasDefault: boolean
	): T {
		let computed = this.contextCache.get(contextId);

		if (!computed) {
			computed = createComputed(() => {
				return this.lookupContextValue(
					contextId,
					provideSymbol,
					defaultValue,
					hasDefault
				);
			});
			this.contextCache.set(contextId, computed);
		}

		return computed.get() as T;
	}

	private lookupContextValue<T>(
		contextId: symbol,
		provideSymbol: symbol,
		defaultValue: T | undefined,
		hasDefault: boolean
	): T {
		const provideMethod = (this.source as any)[provideSymbol];
		if (typeof provideMethod === "function") {
			return provideMethod.call(this.proxy);
		}

		// Access this.parent reactively so context updates when parent changes
		const parent = this.parent;
		if (parent) {
			return parent.getContextValue(
				contextId,
				provideSymbol,
				defaultValue,
				hasDefault
			);
		}

		if (hasDefault) {
			return defaultValue as T;
		}

		return undefined as T;
	}

	private toJSON(): Snapshot<Model> {
		return Object.keys(this.configuration).reduce((json: any, key) => {
			switch (this.configuration[key].type) {
				case ModelCfgTypes.state: {
					json[key] = clone(this.proxy[key], key);
					break;
				}
				case ModelCfgTypes.id:
					json[key] = clone(getSource(this.proxy[key]), key);
					break;
				case ModelCfgTypes.modelRef:
					const model: Model[] | Model | undefined = this.proxy[key];
					if (Array.isArray(model)) {
						if (!this.snapshotMap.has(key)) {
							this.snapshotMap.set(
								key,
								createComputed(() => {
									const models: Model[] = this.proxy[key] ?? [];
									return models.map((m) => getModelRefSnapshot(m)) as unknown[];
								})
							);
						}

						json[key] = this.snapshotMap.get(key)!.get();
						break;
					}
					json[key] = model && getModelRefSnapshot(model);
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
					json[key] = getModelAdm(child!)?.getSnapshot();
					break;
			}
			return json;
		}, {}) as Snapshot<any>;
	}

	onSnapshotChange(onChange: SnapshotChange<any>): () => void {
		return reaction(
			() => this.getSnapshot(),
			(snapshot) => onChange(snapshot, this.proxy)
		);
	}

	loadSnapshot(snapshot: Snapshot<any>): void {
		const ensureChildTypes = (key: string): true => {
			if (!this.configuration[key].childType) {
				throw new Error(
					"r-state-tree: child constructor must be specified to load snapshots with child/children. eg: `@child(ChildCtor) MyChild`"
				);
			}

			return true;
		};

		onSnapshotLoad(() => {
			Object.keys(snapshot).forEach((key) => {
				const { type, childType } = this.configuration[key] ?? {};
				const value = snapshot[key];

				switch (type) {
					case ModelCfgTypes.state:
						this.proxy[key] = value;
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
						} else {
							this.source[key] = getSnapshotRefId(value);
							this.referencedAtoms?.get(key)?.reportChanged();
						}
						break;
					case ModelCfgTypes.id:
						this.setId(key, value as IdType);
						break;
					case CommonCfgTypes.child:
						let model: Model;

						if (Array.isArray(value)) {
							const Ctor = childType as typeof Model;
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
												? getModelById(this.root.proxy, id)
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
}
