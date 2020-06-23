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
	onModelMounted,
	onModelUnmounted,
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
	mounted: boolean = false;
	referencedAtoms!: Map<PropertyKey, Atom>;
	referencedModels!: Map<PropertyKey, Computed<Model[]>>;
	activeModels: Set<PropertyKey> = new Set();
	root!: ModelAdministration;
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
					this.setModelRef(name, value as Model | null);
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
		if (this.isMounted && oldModel) {
			getModelAdm(oldModel).unmount();
		}

		if (newModel) {
			const adm = getModelAdm(newModel);
			if (this.mounted) {
				adm.mount(this);
			}
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

		if (this.isMounted) {
			oldModels.forEach(
				(child) => newModelSet.has(child) || getModelAdm(child).unmount()
			);
		}

		// unsub from old model trace
		this.modelsTraceUnsub.get(name)?.();

		// set the model on the observable proxy
		this.observableProxySet!(this.source, name, newModels, this.proxy);

		// sub to new model trace so that we mount/unmount models as they change
		// on the observable proxy.
		this.modelsTraceUnsub.set(
			name,
			trace(this.proxy[name], (event: MutationEvent<Model>) => {
				if (this.isMounted) {
					if (event.type === "updateArray") {
						getModelAdm(event.oldValue).unmount();
						getModelAdm(event.newValue).mount(this);
					} else if (event.type === "spliceArray") {
						event.added.forEach((model) => getModelAdm(model).mount(this));
						event.removed.forEach((model) => getModelAdm(model).unmount());
					}
				}
			})
		);

		newModels.forEach((child) => {
			if (!oldModelSet.has(child)) {
				const internalModel = getModelAdm(child);
				if (this.mounted) {
					internalModel.mount(this);
				}
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
		if (!this.mounted) {
			return undefined;
		}

		const a = this.getReferencedAtom(name);

		a.reportObserved();
		return this.source[name] != null
			? getModelById(this.root.proxy, this.source[name] as IdType)
			: undefined;
	}

	getModelRefs(name: PropertyKey): Model[] {
		if (!this.mounted) {
			return [];
		}

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

	setModelRef(name: PropertyKey, modelValue: Model | null): void {
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

	get isMounted(): boolean {
		return this.mounted;
	}

	mount(parent: ModelAdministration | null = null): void {
		if (this.mounted) {
			throw new Error("r-state-tree child model already mounted to a parent");
		}

		if (parent) {
			this.parent = parent;
			this.root = parent.root;
		} else {
			this.root = this;
		}

		this.activeModels.forEach((name) => {
			const model = this.getModel(name);
			if (Array.isArray(model)) {
				model.forEach((m) => getModelAdm(m).mount(this));
			} else if (model) {
				getModelAdm(model).mount(this);
			}
		});

		graph.runInAction(() => {
			this.mounted = true;
			onModelMounted(this.proxy);
			this.proxy.modelDidMount();
		});
	}

	unmount(): void {
		graph.runInAction(() => {
			this.proxy.modelWillUnmount();
			this.mounted = false;
			onModelUnmounted(this.proxy);
		});

		this.activeModels.forEach((name) => {
			const model = this.getModel(name);
			if (Array.isArray(model)) {
				model.forEach((m) => getModelAdm(m).unmount());
			} else if (model) {
				getModelAdm(model).unmount();
			}
		});
	}
}
