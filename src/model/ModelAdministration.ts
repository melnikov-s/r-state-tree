import {
	Atom,
	atom,
	observable,
	Computed,
	computed,
	getAdministration,
	MutationEvent,
	trace,
} from "lobx";
import Model from "../model/Model";
import { ModelConfiguration, IdType } from "../types";
import {
	getIdentifier,
	getModelById,
	onModelAttached,
	onModelDetached,
	setIdentifier,
} from "./idMap";
import { mapConfigure } from "../utils";
import { graph, graphOptions } from "../lobx";

const administrationMap: WeakMap<Model, ModelAdministration> = new WeakMap();

export function getModelAdm(model: Model): ModelAdministration {
	return administrationMap.get(model)!;
}

export const modelPropertyType = {
	child: "child",
	children: "children",
	modelRef: "modelRef",
	modelRefs: "modelRefs",
	id: "id",
} as const;

export class ModelAdministration<T extends Model = Model> {
	proxy: T;
	source: T;
	configuration: ModelConfiguration<T>;
	parent: ModelAdministration | null = null;
	referencedAtoms!: Map<PropertyKey, Atom>;
	referencedModels!: Map<PropertyKey, Computed<Model[]>>;
	activeModels: Set<PropertyKey> = new Set();
	root: ModelAdministration = this;
	private modelsTraceUnsub: Map<PropertyKey, () => void> = new Map();
	private observableProxyGet: ProxyHandler<T>["get"];
	private observableProxySet: ProxyHandler<T>["set"];
	private writeInProgress: Set<PropertyKey> = new Set();

	constructor(source: T, configuration: ModelConfiguration<T>) {
		this.source = source;
		this.configuration = configuration;
		this.proxy = observable.configure(
			mapConfigure(configuration, modelPropertyType),
			source,
			graphOptions
		);
		const proxyTraps = getAdministration(this.proxy)!.proxyTraps;
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
		switch (this.configuration[name]) {
			case modelPropertyType.modelRef:
				return this.getModelRef(name);
			case modelPropertyType.modelRefs:
				return this.getModelRefs(name);
			default:
				return this.observableProxyGet!(this.source, name, this.proxy);
		}
	}

	private proxySet(name: PropertyKey, value: unknown): boolean {
		this.writeInProgress.add(name);
		try {
			switch (this.configuration[name]) {
				case modelPropertyType.modelRef: {
					this.setModelRef(name, value as Model | undefined);
					return true;
				}
				case modelPropertyType.modelRefs: {
					this.setModelRefs(name, value as Model[]);
					return true;
				}
				case modelPropertyType.children: {
					this.setModels(name, value as Model[]);
					return true;
				}
				case modelPropertyType.child: {
					this.setModel(name, value as Model | null);
					break;
				}
				case modelPropertyType.id: {
					this.setId(name as string, value as IdType);
					break;
				}
			}

			return this.observableProxySet!(this.source, name, value, this.proxy);
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
			switch (this.configuration[name]) {
				case modelPropertyType.modelRef:
				case modelPropertyType.modelRefs:
				case modelPropertyType.children:
				case modelPropertyType.child:
				case modelPropertyType.id: {
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

	getId(): IdType | undefined {
		return getIdentifier(this.proxy);
	}

	setId(name: string, v: IdType): void {
		const id = getIdentifier(this.proxy);

		if (id !== undefined) {
			throw new Error("r-state-tree identifier already set.");
		}

		if (v !== undefined) {
			setIdentifier(this.proxy, v, name);
		}
	}

	setModel(name: PropertyKey, newModel: Model | null): void {
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
			adm.attach(this);
		}
	}

	setModels(name: PropertyKey, newModels: Model[]): void {
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
		this.observableProxySet!(this.source, name, newModels, this.proxy);

		// sub to new model trace so that we mount/unmount models as they change
		// on the observable proxy.
		this.modelsTraceUnsub.set(
			name,
			trace(this.proxy[name], (event: MutationEvent<Model>) => {
				if (event.type === "updateArray") {
					getModelAdm(event.oldValue).detach();
					getModelAdm(event.newValue).attach(this);
				} else if (event.type === "spliceArray") {
					event.added.forEach((model) => getModelAdm(model).attach(this));
					event.removed.forEach((model) => getModelAdm(model).detach());
				}
			})
		);

		newModels.forEach((child) => {
			if (!oldModelSet.has(child)) {
				const internalModel = getModelAdm(child);
				internalModel.attach(this);
			}
		});
	}

	getModel(name: PropertyKey): Model | undefined {
		const model = this.proxy[name];

		return (model as Model) ?? null;
	}

	getModels(name: PropertyKey): Model[] {
		const model = this.proxy[name];

		return (model ?? []) as Model[];
	}

	getModelRef(name: PropertyKey): Model | undefined {
		const a = this.getReferencedAtom(name);

		a.reportObserved();
		return this.source[name] != null
			? getModelById(this.root.proxy, this.source[name] as IdType)
			: undefined;
	}

	getModelRefs(name: PropertyKey): Model[] {
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

	setModelRef(name: PropertyKey, modelValue: Model | undefined): void {
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

	setModelRefs(name: PropertyKey, modelValue: Model[]): void {
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

	attach(parent: ModelAdministration | null = null): void {
		if (this.parent) {
			throw new Error(
				"r-state-tree: child model already attached to a parent. Did you mean to use modelRef?"
			);
		}

		if (parent) {
			this.parent = parent;
			this.root = parent.root;
		}

		graph.runInAction(() => {
			onModelAttached(this.proxy);
			this.proxy.modelDidAttach();
		});
	}

	detach(): void {
		this.parent = null;
		graph.runInAction(() => {
			this.proxy.modelWillDetach();
			onModelDetached(this.proxy);
		});
	}
}
