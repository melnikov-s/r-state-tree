import {
	Atom,
	atom,
	Computed,
	computed,
	observable,
	getAdministration,
	MutationEvent,
	observe,
	Configuration as LobxConfiguration,
	getObservableSource,
	reaction,
} from "lobx";
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
import { graph, graphOptions } from "../lobx";
import { Configuration } from "..";
import { clone } from "../utils";

const administrationMap: WeakMap<
	Model,
	ModelAdministration<Model>
> = new WeakMap();
const ctorIdKeyMap: WeakMap<typeof Model, IdType | null> = new WeakMap();
const configMap: WeakMap<object, ModelConfiguration<unknown>> = new WeakMap();

export function getConfigurationFromSnapshot(
	snapshot: object
): ModelConfiguration<unknown> | undefined {
	return configMap.get(snapshot);
}

export function getModelAdm<T extends Model>(model: T): ModelAdministration<T> {
	return administrationMap.get(model)! as ModelAdministration<T>;
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

function mapConfigure(
	config: Configuration<unknown>
): LobxConfiguration<unknown> {
	const mappedConfigure = {};
	Object.keys(config).forEach((key) => {
		if (ModelCfgTypes[config[key].type] || CommonCfgTypes[config[key].type]) {
			mappedConfigure[key] = observable;
		} else {
			mappedConfigure[key] = config[key];
		}
	});

	return mappedConfigure;
}

export class ModelAdministration<ModelType extends Model = Model> {
	proxy: ModelType;
	source: ModelType;
	configuration: ModelConfiguration<ModelType>;
	parent: ModelAdministration<Model> | null = null;
	referencedAtoms!: Map<PropertyKey, Atom>;
	referencedModels!: Map<PropertyKey, Computed<Model[]>>;
	activeModels: Set<PropertyKey> = new Set();
	root: ModelAdministration<Model> = this;
	private modelsTraceUnsub: Map<PropertyKey, () => void> = new Map();
	private observableProxyGet: ProxyHandler<ModelType>["get"];
	private observableProxySet: ProxyHandler<ModelType>["set"];
	private writeInProgress: Set<PropertyKey> = new Set();
	private computedSnapshot: Computed<Snapshot<Model>> | undefined;
	private snapshotMap: Map<string, Computed<unknown[]>> = new Map();
	private parentName: PropertyKey | null = null;

	constructor(model: ModelType, configuration: ModelConfiguration<ModelType>) {
		this.source = getObservableSource(model);
		this.configuration = configuration;
		this.proxy = model;
		const adm = getAdministration(this.source)!;
		const proxyTraps = adm.proxyTraps;
		Object.assign((adm.config = mapConfigure(configuration)));
		this.observableProxyGet = proxyTraps.get;
		this.observableProxySet = proxyTraps.set;
		proxyTraps.get = (_, name) => this.proxyGet(name);
		proxyTraps.set = (_, name, value) => this.proxySet(name, value);
		proxyTraps.defineProperty = (_, name, desc) =>
			this.proxyDefineProperty(name, desc);
		administrationMap.set(this.proxy, this);
		administrationMap.set(this.source, this);
	}

	private proxyGet(name: PropertyKey): unknown {
		switch (this.configuration[name as string]?.type) {
			case ModelCfgTypes.modelRef:
				return this.getModelRef(name);
			case ModelCfgTypes.modelRefs:
				return this.getModelRefs(name);
			default:
				return this.observableProxyGet!(
					this.source,
					name as string,
					this.proxy
				);
		}
	}

	private proxySet(name: PropertyKey, value: unknown): boolean {
		this.writeInProgress.add(name);
		try {
			switch (this.configuration[name as string]?.type) {
				case ModelCfgTypes.modelRef: {
					this.setModelRef(name, value as Model | undefined);
					return true;
				}
				case ModelCfgTypes.modelRefs: {
					this.setModelRefs(name, value as Model[]);
					return true;
				}
				case CommonCfgTypes.children: {
					this.setModels(name, value as Model[]);
					return true;
				}
				case CommonCfgTypes.child: {
					this.setModel(name, value as Model | null);
					break;
				}
				case ModelCfgTypes.id: {
					this.setId(name as string, value as IdType);
					break;
				}
				case ModelCfgTypes.state: {
					this.setState(name as string, value);
					break;
				}
			}

			return this.observableProxySet!(
				this.source,
				name as string,
				value,
				this.proxy
			);
		} finally {
			this.writeInProgress.delete(name);
		}
	}

	private proxyDefineProperty(
		name: PropertyKey,
		desc: PropertyDescriptor
	): boolean {
		// if we don't check for writeInProgress we will blow the stack
		// as Reflect.set will eventually trigger defineProperty proxy handler
		if (desc && "value" in desc && !this.writeInProgress.has(name)) {
			switch (this.configuration[name as string]?.type) {
				case ModelCfgTypes.modelRef:
				case ModelCfgTypes.modelRefs:
				case CommonCfgTypes.children:
				case CommonCfgTypes.child:
				case ModelCfgTypes.id: {
					this.proxySet(name, desc.value);
				}
			}
		}

		return Reflect.defineProperty(this.source, name, desc);
	}

	private getReferencedAtom(name: PropertyKey): Atom {
		let a = this.referencedAtoms?.get(name);
		if (!a) {
			if (!this.referencedAtoms) this.referencedAtoms = new Map();
			a = atom(graphOptions);
			this.referencedAtoms.set(name, a);
		}

		return a;
	}

	private setState(name: string, value: unknown): void {
		const oldValue = this.source[name];
		if (value !== oldValue) {
			this.observableProxySet!(this.source, name, value, this.proxy);
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

	private setModels(name: PropertyKey, newModels: Model[]): void {
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
		this.observableProxySet!(
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
			c = computed(
				() => {
					a.reportObserved();
					return (this.source[name] || [])
						.map((id: IdType) => getModelById(this.root.proxy, id))
						.filter((m: Model | undefined) => !!m);
				},
				{ keepAlive: true, graph }
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
		parent: ModelAdministration<Model> | null = null,
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

		graph.runInAction(() => {
			onModelAttached(this.proxy);
			this.proxy.modelDidAttach();
		});
	}

	private detach(): void {
		graph.runInAction(() => {
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
					json[key] = clone(getObservableSource(this.proxy[key]));
					break;
				case ModelCfgTypes.modelRef:
					const model: Model | undefined = this.proxy[key];
					json[key] = model && getModelRefSnapshot(model);
					break;
				case ModelCfgTypes.modelRefs:
					if (!this.snapshotMap.has(key)) {
						this.snapshotMap.set(
							key,
							computed(
								() => {
									const models: Model[] = this.proxy[key] ?? [];
									return models.map((m) => getModelRefSnapshot(m)) as unknown[];
								},
								{ graph, keepAlive: true }
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
							computed(
								() => {
									return getObservableSource(
										(this.proxy[key] ?? []).map((model: Model) =>
											getModelAdm(model).getSnapshot()
										)
									);
								},
								{ graph, keepAlive: true }
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
			(snapshot) => onChange(snapshot, this.proxy),
			graphOptions
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
			this.computedSnapshot = computed(
				() => {
					const json = this.toJSON();
					configMap.set(json, this.configuration);

					return json;
				},
				{
					graph,
					keepAlive: true,
				}
			);
		}

		return this.computedSnapshot.get() as Snapshot<ModelType>;
	}
}
