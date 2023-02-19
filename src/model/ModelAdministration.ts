import {
	getAdministration,
	createObservableWithCustomAdministration,
	ObjectAdministration,
	getSource,
} from "nu-observables";
import Model from "../model/Model";
import {
	ModelConfiguration,
	IdType,
	ModelCfgTypes,
	CommonCfgTypes,
	Snapshot,
	SnapshotChange,
	RefSnapshot,
} from "../types";
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
	MutationEvent,
	observe,
} from "./ChildModelsAdministration";
import {
	AtomNode,
	createComputed,
	ComputedNode,
	reaction,
	runInAction,
	graph,
} from "../graph";

const ctorIdKeyMap: WeakMap<typeof Model, IdType | null> = new WeakMap();
const configMap: WeakMap<object, ModelConfiguration<unknown>> = new WeakMap();

export function getConfigurationFromSnapshot(
	snapshot: object
): ModelConfiguration<unknown> | undefined {
	return configMap.get(snapshot);
}

export function getModelAdm<T extends Model>(model: T): ModelAdministration<T> {
	return getAdministration(model)! as unknown as ModelAdministration<T>;
}

function getIdKey(Ctor: typeof Model): string | number | null {
	if (!ctorIdKeyMap.has(Ctor)) {
		const key =
			Object.keys(Ctor.types).find(
				(prop) => Ctor.types[prop].type === ModelCfgTypes.id
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

	return idKey ? (snapshot[idKey] as IdType) : null;
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

export class ModelAdministration<
	ModelType extends Model = Model
> extends ObjectAdministration<ModelType> {
	static proxyTraps: ProxyHandler<object> = Object.assign(
		{},
		ObjectAdministration.proxyTraps,
		{
			get(target, prop, proxy) {
				const adm = getAdministration(target) as ModelAdministration;
				if (prop === "parent") {
					return (target as Model).parent;
				}
				switch (adm.configuration[prop as string]?.type) {
					case ModelCfgTypes.modelRef:
						return adm.getModelRef(prop);
					case ModelCfgTypes.modelRefs:
						return adm.getModelRefs(prop);
					default:
						return ObjectAdministration.proxyTraps.get?.apply(
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
							adm.setModelRef(name, value as Model | undefined);
							return true;
						}
						case ModelCfgTypes.modelRefs: {
							adm.setModelRefs(name, value as Model[]);
							return true;
						}
						case CommonCfgTypes.children: {
							adm.setModels(name, value as Model[]);
							return true;
						}
						case CommonCfgTypes.child: {
							adm.setModel(name, value as Model | null);
							break;
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

					return ObjectAdministration.proxyTraps.set?.apply(
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
						case ModelCfgTypes.modelRefs:
						case CommonCfgTypes.children:
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

	configuration!: ModelConfiguration<ModelType>;
	parent: ModelAdministration<Model> | null = null;
	referencedAtoms!: Map<PropertyKey, AtomNode>;
	referencedModels!: Map<PropertyKey, ComputedNode<Model[]>>;
	activeModels: Set<PropertyKey> = new Set();
	root: ModelAdministration<any> = this;
	private modelsTraceUnsub: Map<PropertyKey, () => void> = new Map();
	private writeInProgress: Set<PropertyKey> = new Set();
	private computedSnapshot: ComputedNode<Snapshot<Model>> | undefined;
	private snapshotMap: Map<string, ComputedNode<unknown[]>> = new Map();
	parentName: PropertyKey | null = null;

	setConfiguration(configuration: ModelConfiguration<ModelType>): void {
		this.configuration = configuration;
	}

	private getReferencedAtom(name: PropertyKey): AtomNode {
		let a = this.referencedAtoms?.get(name);
		if (!a) {
			if (!this.referencedAtoms) this.referencedAtoms = new Map();
			a = new AtomNode();
			this.referencedAtoms.set(name, a);
		}

		return a;
	}

	private setState(name: string, value: unknown): void {
		const oldValue = this.source[name];
		if (value !== oldValue) {
			ObjectAdministration.proxyTraps.set!(
				this.source,
				name,
				value,
				this.proxy
			);
		}
	}

	private setId(name: string, v: IdType): void {
		const id = getIdentifier(this.proxy);

		if (id === v) {
			return;
		}

		if (id != null && v == null) {
			throw new Error(
				"r-state-tree can't clear an identifier once it has already been set."
			);
		}

		if (v !== undefined) {
			this.source[name] = v;
			setIdentifier(this.proxy, v);
		}
	}

	private setModel(name: PropertyKey, newModel: Model | null): void {
		const oldModel = this.getModel(name) as Model | null;

		if (oldModel === newModel) {
			return;
		}

		this.activeModels.add(name);
		if (oldModel) {
			getModelAdm(oldModel).detach();
		}

		if (newModel) {
			const adm = getModelAdm(newModel);
			adm.attach(this, name);
		}
	}

	private setModels(name: PropertyKey, newModelsSource: Model[]): void {
		const newModels = createObservableWithCustomAdministration(
			[] as Model[],
			graph,
			ChildModelsAdministration
		);

		newModels.push(...newModelsSource);

		const oldModels = this.getModels(name) ?? [];

		if (oldModels === newModels) {
			return;
		}

		const oldModelSet = new Set(oldModels);
		const newModelSet = new Set(newModels);

		this.activeModels.add(name);

		oldModels.forEach(
			(child) => newModelSet.has(child) || getModelAdm(child).detach()
		);

		// unsub from old model trace
		this.modelsTraceUnsub.get(name)?.();

		// set the model on the observable proxy
		ObjectAdministration.proxyTraps.set!(
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
			if (!oldModelSet.has(child)) {
				const internalModel = getModelAdm(child);
				internalModel.attach(this, name);
			}
		});
	}

	private getModel(name: PropertyKey): Model | undefined {
		const model = this.proxy[name];

		return (model as Model) ?? null;
	}

	private getModels(name: PropertyKey): Model[] {
		const model = this.proxy[name];

		return (model ?? []) as Model[];
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
			c = createComputed(
				() => {
					a.reportObserved();
					return (this.source[name] || [])
						.map((id: IdType) => getModelById(this.root.proxy, id))
						.filter((m: Model | undefined) => !!m);
				},
				null,
				true
			);

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
		parent: ModelAdministration<any> | null = null,
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

		runInAction(() => {
			onModelAttached(this.proxy);
			this.proxy.modelDidAttach();
		});
	}

	private detach(): void {
		runInAction(() => {
			this.proxy.modelWillDetach();
			onModelDetached(this.proxy);
		});

		this.parent = null;
		this.root = this;
	}

	private toJSON(): Snapshot<Model> {
		return Object.keys(this.configuration).reduce((json, key) => {
			switch (this.configuration[key].type) {
				case ModelCfgTypes.state:
				case ModelCfgTypes.id:
					json[key] = clone(getSource(this.proxy[key]));
					break;
				case ModelCfgTypes.modelRef:
					const model: Model | undefined = this.proxy[key];
					json[key] = model && getModelRefSnapshot(model);
					break;
				case ModelCfgTypes.modelRefs:
					if (!this.snapshotMap.has(key)) {
						this.snapshotMap.set(
							key,
							createComputed(
								() => {
									const models: Model[] = this.proxy[key] ?? [];
									return models.map((m) => getModelRefSnapshot(m)) as unknown[];
								},
								null,
								true
							)
						);
					}

					json[key] = this.snapshotMap.get(key)!.get();
					break;
				case CommonCfgTypes.child:
					json[key] = getModelAdm(this.proxy[key])?.getSnapshot();
					break;
				case CommonCfgTypes.children:
					if (!this.snapshotMap.has(key)) {
						this.snapshotMap.set(
							key,
							createComputed(
								() => {
									return getSource(
										(this.proxy[key] ?? []).map((model: Model) =>
											getModelAdm(model).getSnapshot()
										)
									);
								},
								null,
								true
							)
						);
					}
					json[key] = this.snapshotMap.get(key)!.get();
					break;
			}
			return json;
		}, {}) as Snapshot<ModelType>;
	}

	onSnapshotChange(onChange: SnapshotChange<ModelType>): () => void {
		return reaction(
			() => this.getSnapshot(),
			(snapshot) => onChange(snapshot, this.proxy)
		);
	}

	loadSnapshot(snapshot: Snapshot<ModelType>): void {
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
						if (value instanceof Model) {
							this.proxy[key] = value;
						} else {
							this.source[key] = getSnapshotRefId(value);
							this.referencedAtoms?.get(key)?.reportChanged();
						}
						break;
					case ModelCfgTypes.modelRefs:
						if ((value as unknown[])?.[0] instanceof Model) {
							this.proxy[key] = value;
						} else {
							this.source[key] = value.map((snapshot: RefSnapshot) =>
								getSnapshotRefId(snapshot)
							);
							this.referencedAtoms?.get(key)?.reportChanged();
						}
						break;
					case ModelCfgTypes.id:
						this.setId(key, value as IdType);
						break;
					case CommonCfgTypes.child:
						let model: Model;

						if (value instanceof Model) {
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
					case CommonCfgTypes.children:
						const Ctor = childType as typeof Model;
						this.proxy[key] = (value as Snapshot[])?.map((snapshot, index) => {
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
						});
						break;
					default:
						console.warn(
							`r-state-tree: invalid key '${key}' found in snapshot, ignored.`
						);
				}
			});
		});
	}

	getSnapshot(): Snapshot<ModelType> {
		if (!this.computedSnapshot) {
			this.computedSnapshot = createComputed(
				() => {
					const json = this.toJSON();
					configMap.set(json, this.configuration);

					return json;
				},
				null,
				true
			);
		}

		return this.computedSnapshot.get() as Snapshot<ModelType>;
	}
}
