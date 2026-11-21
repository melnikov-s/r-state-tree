import {
	getAdministration,
	registerAdministration,
	PreactObjectAdministration,
	getSource,
	isObservable,
	batch,
	untracked,
	createComputed,
	createAtom,
	reaction,
} from "../observables/index.js";
import type { ComputedNode, AtomNode } from "../observables/index.js";
import { debugWrite, debugEnabled } from "../observables/internal/debug.js";
import { getPropertyDescriptor } from "../observables/internal/utils.js";
import Model from "./Model.js";
import type {
	ModelConfiguration,
	IdType,
	Snapshot,
	SnapshotChange,
} from "../types.js";
import { ModelCfgTypes, CommonCfgTypes } from "../types.js";
import {
	getIdentifier,
	getModelIdKey,
	getModelByIdAdm,
	onModelsAttachedValidated,
	onModelDetachedAdm,
	validateModelAttachmentsAdm,
	setIdentifierAdm,
	type IdBucket,
	type ModelConstructor,
	type TypeMap,
} from "./idMap.js";
import { clone } from "../utils.js";
import {
	getConfigChildType,
	getConfigType,
	getConfigurationForCtor,
} from "../configuration.js";
import { ChildModelsAdministration } from "./ChildModelsAdministration.js";
import {
	serializeModelSnapshot,
	type SnapshotReads,
} from "./serializeModelSnapshot.js";

import {
	SnapshotApplication,
	type SnapshotIdUndo,
	type SnapshotUndo,
} from "./SnapshotApplication.js";

const configMap: WeakMap<object, ModelConfiguration<unknown>> = new WeakMap();
const configHasModelRefMap: WeakMap<object, boolean> = new WeakMap();
const EMPTY_MODELS: Model[] = [];
const EMPTY_MODEL_ADMS: ModelAdministration[] = [];
const EMPTY_MODEL_CONFIG: ModelConfiguration<any> = Object.create(null);

function configHasModelRefs(config: ModelConfiguration<any>): boolean {
	let has = configHasModelRefMap.get(config);
	if (has === undefined) {
		has = false;
		for (const key of Reflect.ownKeys(config)) {
			if (getConfigType(config[key as string]) === ModelCfgTypes.modelRef) {
				has = true;
				break;
			}
		}
		configHasModelRefMap.set(config, has);
	}
	return has;
}

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
				if (
					(adm._hasModelRefs || adm.configurationGetter) &&
					adm.getCfgType(prop) === ModelCfgTypes.modelRef
				) {
					if (Array.isArray(adm.source[prop])) {
						return adm.getModelRefs(prop);
					}
					return adm.getModelRef(prop);
				}
				return PreactObjectAdministration.trapGet(adm, prop, proxy);
			},
			set(target, name, value, receiver) {
				const adm = getAdministration(target) as ModelAdministration;
				adm.assertUsable();
				const type = adm.getCfgType(name);
				if (
					adm._constructing &&
					!debugEnabled &&
					receiver === adm.proxy &&
					(type === undefined || type === ModelCfgTypes.id) &&
					(value == null ||
						typeof value === "string" ||
						typeof value === "number" ||
						typeof value === "boolean") &&
					!adm.hasAnyObservers() &&
					!(name in target) &&
					(type !== ModelCfgTypes.id ||
						(!adm._parent &&
							adm._modelId === undefined &&
							(value === undefined ||
								typeof value === "string" ||
								typeof value === "number")))
				) {
					if (!Reflect.set(target, name, value)) return false;
					if (type === ModelCfgTypes.id) adm._modelId = value as IdType;
					return true;
				}
				if (isManagedField(type)) {
					if (receiver !== adm.proxy) {
						throw new TypeError(
							`r-state-tree: cannot write managed model field '${String(name)}' on a different receiver`
						);
					}
					if (!adm.canWriteManagedField(name)) return false;
					const prevKey = adm._writingManagedKey;
					let overflowed = false;
					if (prevKey === undefined) {
						adm._writingManagedKey = name;
					} else {
						(adm._writeInProgress ??= new Set()).add(name);
						overflowed = true;
					}
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
					} finally {
						if (overflowed) {
							adm._writeInProgress!.delete(name);
						} else {
							adm._writingManagedKey = undefined;
						}
					}
				}

				return PreactObjectAdministration.trapSet(adm, name, value, receiver);
			},

			defineProperty(target, name, desc) {
				const adm = getAdministration(target) as ModelAdministration;
				// Reflect.set reenters this trap while writing the backing field.
				// A later reentrant reaction is not an internal write.
				const cfgType = adm.getCfgType(name);
				if (
					!(
						adm.isWriting &&
						(adm._writingManagedKey === name || adm._writeInProgress?.has(name))
					) &&
					isManagedField(cfgType)
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
					// Fast path for class field initializer of @id on a fresh unattached, unobserved Model.
					if (
						cfgType === ModelCfgTypes.id &&
						desc.configurable &&
						desc.writable &&
						desc.enumerable &&
						!adm.disposed &&
						!adm._parent &&
						!adm.hasAnyObservers() &&
						!debugEnabled &&
						!(name in adm.source)
					) {
						const v = desc.value as IdType;
						if (adm._modelId != null && v == null) {
							throw new Error(
								"r-state-tree can't clear an id once it has already been set."
							);
						}
						if (!Reflect.defineProperty(adm.source, name, desc)) return false;
						if (v !== undefined) adm._modelId = v;
						return true;
					}
					return Reflect.set(adm.proxy, name, desc.value);
				}

				// The shared trap invalidates fields and key enumeration for explicit
				// definitions, but leaves reentrant assignment notification to write().
				return PreactObjectAdministration.proxyTraps.defineProperty!(
					target,
					name,
					desc
				);
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
	private _config: ModelConfiguration<any> = EMPTY_MODEL_CONFIG;
	private _hasModelRefs = false;
	protected override _cleanOwnDescriptors = true;
	/** @internal */
	_modelCtor?: ModelConstructor;
	/** @internal */
	_idIndex?: TypeMap;
	/** @internal */
	_lastIdType?: ModelConstructor;
	/** @internal */
	_lastIdBucket?: IdBucket;
	/** @internal */
	_modelId?: IdType;
	private _parent: ModelAdministration | null = null;
	private _parentAtom?: AtomNode;
	referencedAtoms!: Map<PropertyKey, AtomNode>;
	referencedModels!: Map<PropertyKey, ComputedNode<readonly Model[]>>;
	private _activeModels?: Set<PropertyKey>;
	private _childArrays?: Map<PropertyKey, ChildModelsAdministration<Model>>;
	private _writingManagedKey: PropertyKey | undefined = undefined;
	private _writeInProgress?: Set<PropertyKey>;
	private computedSnapshot: ComputedNode<Snapshot<Model>> | undefined;
	private _snapshotMap?: Map<string, ComputedNode<unknown[]>>;
	private disposed = false;
	private snapshotIdUndos?: WeakMap<object, SnapshotIdUndo>;
	parentName: PropertyKey | null = null;

	protected override getInstanceConfig(): Record<PropertyKey, any> {
		return this.configuration;
	}

	/** @internal Non-reactive parent access for internal structural operations. */
	get rawParent(): ModelAdministration | null {
		return this._parent;
	}

	/** @internal Non-reactive root access for internal structural operations. */
	get rawRoot(): ModelAdministration {
		let node: ModelAdministration = this;
		while (node._parent) {
			node = node._parent;
		}
		return node;
	}

	get parent(): ModelAdministration | null {
		(this._parentAtom ??= createAtom()).reportObserved();
		return this._parent;
	}

	set parent(value: ModelAdministration | null) {
		if (this._parent !== value) {
			this._parent = value;
			this._parentAtom?.reportChanged();
		}
	}

	setCtor(ctor: Function): void {
		this._modelCtor = ctor as ModelConstructor;
		const config = getConfigurationForCtor(ctor) as ModelConfiguration<any>;
		this._config = config;
		this._hasModelRefs = configHasModelRefs(config);
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
		return this.configurationGetter ? this.configurationGetter() : this._config;
	}

	private peekField(key: PropertyKey): any {
		const value =
			this._cleanOwnDescriptors &&
			Object.prototype.hasOwnProperty.call(this.source, key)
				? (this.source as any)[key]
				: Reflect.get(this.source, key, this.proxy);
		if (
			typeof value === "object" &&
			value !== null &&
			(this.hasExplicitObservable(key) || isObservable(value)) &&
			!Object.isFrozen(value)
		) {
			const existingAdm = getAdministration(value);
			if (existingAdm) return existingAdm.proxy;
		}
		return value;
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
		const id = this._modelId;

		// Undefined IDs still need the backing field initialized.
		if (id !== undefined && id === v) {
			return true;
		}

		if (id != null && v == null) {
			throw new Error(
				"r-state-tree can't clear an id once it has already been set."
			);
		}

		if (!this._parent && !this.hasAnyObservers()) {
			if (v !== undefined) {
				this._modelId = v;
			}
			return this.write(name, v);
		}

		return batch(() => {
			if (v !== undefined) {
				setIdentifierAdm(this, v);
			}
			// Publish the field through the observable write path, in the same
			// batch as the index update so observers only see a consistent identity.
			return this.write(name, v);
		});
	}

	/** Only the original undo payload on the recorded Model can restore its unset ID. */
	recordSnapshotIdUndo(undo: object, next: object): void {
		const key = getModelIdKey(Object.getPrototypeOf(this.proxy).constructor);
		if (
			key !== null &&
			Object.hasOwn(undo, key) &&
			(undo as Record<string, unknown>)[key] === undefined
		) {
			const id = (next as Record<string, unknown>)[key];
			if (typeof id === "number" || typeof id === "string") {
				(this.snapshotIdUndos ??= new WeakMap()).set(undo, { key, id });
			}
		}
	}

	private canWriteManagedField(name: PropertyKey): boolean {
		if (!(name in this.source)) return Object.isExtensible(this.source);
		const own = Object.getOwnPropertyDescriptor(this.source, name);
		if (own) return own.writable === true;
		throw new TypeError(
			`r-state-tree: managed model field '${String(name)}' cannot be inherited from a prototype`
		);
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

		// Fast path: pure detachment (e.g. setting child field to null)
		if (added.length === 0) {
			if (commit() === false) return false;
			if (removed.length === 1) {
				getModelAdm(removed[0]).detachInner();
			} else if (removed.length > 1) {
				const seen = new Set<ModelAdministration>();
				for (let i = 0; i < removed.length; i++) {
					const adm = getModelAdm(removed[i]);
					if (!seen.has(adm)) {
						seen.add(adm);
						adm.detachInner();
					}
				}
			}
			return true;
		}

		// Fast path: pure attachment (no removals, e.g. Model.create or attaching to empty slot)
		if (removed.length === 0) {
			const attaching: ModelAdministration[] = [];
			const seen =
				added.length > 1 ? new Set<ModelAdministration>() : undefined;
			for (let i = 0; i < added.length; i++) {
				const adm = getModelAdm(added[i]);
				if (seen) {
					if (seen.has(adm)) continue;
					seen.add(adm);
				}
				adm.assertUsable();
				let ancestor: ModelAdministration | null = this;
				while (ancestor) {
					if (ancestor === adm)
						throw new Error(
							"r-state-tree: cannot attach an ancestor as a child"
						);
					ancestor = ancestor._parent;
				}
				if (adm._parent) {
					throw new Error(
						"r-state-tree: child model already attached to a parent. Did you mean to use modelRef?"
					);
				}
				attaching.push(adm);
			}
			validateModelAttachmentsAdm(this, attaching, EMPTY_MODEL_ADMS);
			if (commit() === false) return false;
			for (let i = 0; i < attaching.length; i++) {
				const adm = attaching[i];
				adm.assertUsable();
				adm.parent = this;
				adm.parentName = name;
			}
			onModelsAttachedValidated(this, attaching);
			return true;
		}

		const removedSet = new Set<ModelAdministration>();
		for (let i = 0; i < removed.length; i++) {
			removedSet.add(getModelAdm(removed[i]));
		}
		const addedSet = new Set<ModelAdministration>();
		for (let i = 0; i < added.length; i++) {
			const adm = getModelAdm(added[i]);
			if (addedSet.has(adm)) continue;
			addedSet.add(adm);
			adm.assertUsable();
			let ancestor: ModelAdministration | null = this;
			while (ancestor) {
				if (ancestor === adm)
					throw new Error("r-state-tree: cannot attach an ancestor as a child");
				ancestor = ancestor._parent;
			}
			if (
				adm._parent &&
				!(
					removedSet.has(adm) &&
					adm._parent === this &&
					adm.parentName === name
				)
			) {
				throw new Error(
					"r-state-tree: child model already attached to a parent. Did you mean to use modelRef?"
				);
			}
		}
		const detaching: ModelAdministration[] = [];
		for (const adm of removedSet) {
			if (!addedSet.has(adm)) {
				detaching.push(adm);
			}
		}
		const attaching: ModelAdministration[] = [];
		for (const adm of addedSet) {
			if (!removedSet.has(adm)) {
				attaching.push(adm);
			}
		}
		validateModelAttachmentsAdm(this, attaching, detaching);
		if (commit() === false) return false;
		for (let i = 0; i < detaching.length; i++) detaching[i].detachInner();
		for (let i = 0; i < attaching.length; i++) {
			const adm = attaching[i];
			adm.assertUsable();
			adm.parent = this;
			adm.parentName = name;
		}
		onModelsAttachedValidated(this, attaching);
		return true;
	}

	private extractChildModels(
		field: Model | Model[] | null | undefined
	): Model[] {
		if (!field) return EMPTY_MODELS;
		if (!Array.isArray(field)) return [field];
		const adm = getAdministration(field);
		if (adm instanceof ChildModelsAdministration) {
			const adms = adm.getMemberAdms();
			const len = adms.length;
			if (len === 0) return EMPTY_MODELS;
			const result = new Array<Model>(len);
			for (let i = 0; i < len; i++) {
				result[i] = adms[i].proxy;
			}
			return result;
		}
		return Array.from({ length: field.length }, (_, index) => field[index]);
	}

	private changeChildField(
		name: PropertyKey,
		value: Model | Model[] | null | undefined,
		commit: () => boolean,
		addedModels?: Model[]
	): boolean {
		const current = this.peekField(name) as Model | Model[] | null | undefined;
		if (Array.isArray(current)) {
			(
				getAdministration(current) as ChildModelsAdministration<Model>
			).assertMutable();
		}
		const added = addedModels ?? this.extractChildModels(value);
		const removed = this.extractChildModels(current);
		return batch(() => {
			if (!this.changeModels(name, added, removed, commit)) return false;
			this.updateChildSlot(name, value);
			return true;
		});
	}

	private updateChildSlot(
		name: PropertyKey,
		value: Model | Model[] | null | undefined
	): void {
		const previousArray = this._childArrays?.get(name);
		if (previousArray) {
			previousArray.change = undefined;
			this._childArrays!.delete(name);
		}
		if (value) (this._activeModels ??= new Set()).add(name);
		else this._activeModels?.delete(name);
		if (Array.isArray(value)) {
			const adm = getAdministration(value) as ChildModelsAdministration<Model>;
			adm.change = (a, r, c) => {
				this.changeModels(name, a, r, c);
			};
			(this._childArrays ??= new Map()).set(name, adm);
		}
	}

	private setModels(name: PropertyKey, newModelsSource: Model[]): boolean {
		if (this.peekField(name) === newModelsSource) return true;
		const childAdm = registerAdministration(
			new ChildModelsAdministration<Model>([])
		);
		const newModels = childAdm.proxy;
		let addedProxies: Model[] | undefined;
		if (debugEnabled) newModels.push(...newModelsSource);
		else addedProxies = childAdm.initMembers(newModelsSource);
		return this.changeChildField(
			name,
			newModels,
			() => this.write(name, newModels),
			addedProxies
		);
	}

	private getModelRef(name: PropertyKey): Model | undefined {
		const a = this.getReferencedAtom(name);

		a.reportObserved();
		const Type = this.getRequiredModelRefType(name);
		const rootAdm = this.root;
		return this.source[name] != null
			? getModelByIdAdm(rootAdm, Type, this.source[name] as IdType)
			: undefined;
	}

	private getModelRefs(name: PropertyKey): readonly Model[] {
		const a = this.getReferencedAtom(name);

		let c = this.referencedModels?.get(name);

		if (!c) {
			if (!this.referencedModels) this.referencedModels = new Map();
			c = createComputed(() => {
				a.reportObserved();
				const Type = this.getRequiredModelRefType(name);
				const rootAdm = this.root;
				const ids = this.source[name] as IdType | IdType[] | undefined;
				const models = (Array.isArray(ids) ? ids : [])
					.map((id) => getModelByIdAdm(rootAdm, Type, id))
					.filter((model) => model !== undefined);

				// Membership comes from the stored IDs. Freeze only the resolved list.
				return Object.freeze(models);
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
		// The identifier index resolves references by exact class, not inheritance.
		if (
			!(model instanceof Type) ||
			Object.getPrototypeOf(model).constructor !== Type
		) {
			throw new Error(
				`r-state-tree: modelRef '${String(name)}' must reference ${Type.name} (exact model class)`
			);
		}
	}

	get root(): ModelAdministration {
		let node: ModelAdministration = this;
		while (true) {
			const parent = node.parent;
			if (!parent) return node;
			node = parent;
		}
	}

	private detachInner(): void {
		onModelDetachedAdm(this);
		this.parent = null;
		this.parentName = null;
	}

	dispose(internal = false): void {
		if (this.disposed) return;
		if (!internal && this._parent) {
			throw new Error(
				"r-state-tree: cannot directly dispose an attached child model"
			);
		}
		// Detachment observers can reenter or throw when the batch flushes.
		// Commit terminal state and release ownership hooks before that happens.
		this.disposed = true;
		batch(() => {
			try {
				if (this._activeModels) {
					for (const name of this._activeModels) {
						const child = this.source[name] as Model | Model[] | undefined;
						if (Array.isArray(child)) {
							for (let i = 0; i < child.length; i++) {
								getModelAdm(child[i]).dispose(true);
							}
						} else if (child) {
							getModelAdm(child).dispose(true);
						}
					}
				}
				if (this._parent) this.detachInner();
			} finally {
				if (this._childArrays) {
					for (const array of this._childArrays.values()) array.dispose();
					this._childArrays.clear();
				}
				this._activeModels?.clear();
			}
		});
	}

	private static readonly snapshotReads: SnapshotReads = {
		observeReference(model, key) {
			model.getReferencedAtom(key).reportObserved();
			return model.getRequiredModelRefType(key);
		},
		childArraySnapshot(model, key) {
			return model.getChildArraySnapshot(key);
		},
	};

	private getChildArraySnapshot(key: string): unknown[] {
		const snapshotMap = (this._snapshotMap ??= new Map());
		let childComputed = snapshotMap.get(key);
		if (!childComputed) {
			let chunkSource: ModelAdministration[] | undefined;
			let chunkComputeds: ComputedNode<unknown[]>[] | undefined;
			const CHUNK_SIZE = 16;
			const CHUNK_THRESHOLD = 64;
			childComputed = createComputed(() => {
				const value = this.read(key);
				if (!Array.isArray(value)) return [];
				const array = getAdministration(value);
				if (!(array instanceof ChildModelsAdministration)) {
					return getSource(
						value.map((model: Model) => getModelAdm(model).getSnapshot())
					);
				}
				// The child array reports every structural write to this
				// dependency; only the individual Model snapshots need
				// tracking, not each proxy index read.
				array.reportObserved();
				array.atom.reportObserved(); // also track explicit reportChanged()
				const adms = array.getMemberAdms();
				const len = adms.length;
				if (len < CHUNK_THRESHOLD) {
					chunkSource = undefined;
					chunkComputeds = undefined;
					const snapshots = new Array(len);
					for (let i = 0; i < len; i++) {
						snapshots[i] = adms[i].getSnapshot();
					}
					return snapshots;
				}
				// O(sqrt(N)) incremental snapshot updates for large child arrays:
				// a single leaf edit only re-evaluates its 16-item chunk.
				if (chunkSource !== adms || !chunkComputeds) {
					chunkSource = adms;
					const chunkCount = Math.ceil(len / CHUNK_SIZE);
					chunkComputeds = new Array(chunkCount);
					for (let c = 0; c < chunkCount; c++) {
						const start = c * CHUNK_SIZE;
						const end = Math.min(start + CHUNK_SIZE, len);
						const sliceAdms = adms;
						chunkComputeds[c] = createComputed(() => {
							const out = new Array(end - start);
							for (let i = start; i < end; i++) {
								out[i - start] = sliceAdms[i].getSnapshot();
							}
							return out;
						});
					}
				}
				const snapshots = new Array(len);
				let offset = 0;
				for (let c = 0; c < chunkComputeds.length; c++) {
					const chunk = chunkComputeds[c].get();
					for (let j = 0; j < chunk.length; j++) {
						snapshots[offset++] = chunk[j];
					}
				}
				return snapshots;
			});
			snapshotMap.set(key, childComputed);
		}
		return childComputed.get();
	}

	validateSnapshotFields(): void {
		const config = this.configuration;
		const source = this.source;
		for (const key of Object.keys(source)) {
			if (
				config[key] === undefined ||
				getConfigType(config[key]) === undefined
			) {
				try {
					if (this._cleanOwnDescriptors) {
						const val = source[key];
						if (
							val == null ||
							typeof val === "string" ||
							typeof val === "number" ||
							typeof val === "boolean"
						)
							continue;
					}
					untracked(() => clone(this.peekField(key), key));
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
		}
	}

	onSnapshotChange(onChange: SnapshotChange<any>): () => void {
		const application = ModelAdministration.snapshotApplication;
		let rollbackVersion = application.rollbackVersion;
		return reaction(
			() => this.getSnapshot(),
			(snapshot, previous) => {
				const currentVersion = application.rollbackVersion;
				const rolledBack = rollbackVersion !== currentVersion;
				rollbackVersion = currentVersion;
				// A lasting change in the same outer batch must still be delivered.
				if (!rolledBack || !equalSnapshots(snapshot, previous))
					onChange(snapshot, this.proxy);
			}
		);
	}

	private static readonly snapshotApplication = new SnapshotApplication({
		configuration: (model) => model.configuration,
		snapshotIdUndo: (model, snapshot) => model.snapshotIdUndos?.get(snapshot),
		peekField: (model, key) => model.peekField(key),
		extractChildModels: (model, field) => model.extractChildModels(field),
		tryReplaceRetainedChildArray: (model, key, previous, members) =>
			model.tryReplaceRetainedChildArray(key, previous, members),
		tryWriteScalar: (model, key, current, value) =>
			model.tryWriteSnapshotScalar(key, current, value),
		writeReference: (model, key, value) => model.writeReference(key, value),
		writeId: (model, key, value, undo, clearId) =>
			model.writeSnapshotId(key, value, undo, clearId),
	});

	applySnapshot(snapshot: Snapshot<any>): void {
		ModelAdministration.snapshotApplication.apply(this, snapshot);
	}

	loadSnapshot(snapshot: Snapshot<any>, undo?: SnapshotUndo): void {
		ModelAdministration.snapshotApplication.load(this, snapshot, undo);
	}

	/** @internal Assumes caller is already inside untracked() + batch(). */
	loadSnapshotInBatch(snapshot: Snapshot<any>, undo?: SnapshotUndo): void {
		ModelAdministration.snapshotApplication.loadInBatch(this, snapshot, undo);
	}

	/** Replace the array wrapper while preserving every existing ownership edge. */
	private tryReplaceRetainedChildArray(
		key: string,
		previous: ChildModelsAdministration<Model>,
		members: ModelAdministration[]
	): boolean {
		if (
			debugEnabled ||
			!this._cleanOwnDescriptors ||
			this._childArrays?.get(key) !== previous ||
			previous.getMemberAdms() !== members ||
			this.getCfgType(key) !== CommonCfgTypes.child
		)
			return false;
		this.assertUsable();
		previous.assertMutable();
		for (const adm of members) adm.assertUsable();
		if (!this.canWriteManagedField(key))
			throw new TypeError(`r-state-tree: cannot write child field '${key}'`);
		const next = registerAdministration(
			new ChildModelsAdministration<Model>([])
		);
		next.copyMembersFrom(members);
		if (!this.write(key, next.proxy))
			throw new TypeError(`r-state-tree: cannot write child field '${key}'`);
		this.updateChildSlot(key, next.proxy);
		return true;
	}

	/** Skip the observable write path for unobserved ordinary scalar fields. */
	private tryWriteSnapshotScalar(
		key: string,
		currentValue: unknown,
		value: unknown
	): boolean {
		if (
			!debugEnabled &&
			!this.disposed &&
			!this.hasAnyObservers() &&
			!this.hasExplicitObservable(key) &&
			typeof currentValue !== "function" &&
			typeof value !== "function" &&
			(this._cleanOwnDescriptors ||
				Object.getOwnPropertyDescriptor(this.source, key)?.writable)
		) {
			if (currentValue !== value) this.source[key] = value;
			return true;
		}
		return false;
	}

	private writeSnapshotId(
		key: string,
		value: IdType | undefined,
		undo?: SnapshotUndo,
		clearId?: SnapshotIdUndo
	): void {
		if (
			!undo &&
			!clearId &&
			!debugEnabled &&
			!this.disposed &&
			!this._parent &&
			!this.hasAnyObservers() &&
			(typeof value === "string" || typeof value === "number")
		) {
			if (this._modelId !== value) {
				if (
					!this._hasCustomOwnDescriptor &&
					Object.prototype.hasOwnProperty.call(this.source, key)
				) {
					this._modelId = value;
					this.source[key] = value;
					return;
				}
				const own = Object.getOwnPropertyDescriptor(this.source, key);
				if (own && "value" in own && own.writable) {
					this._modelId = value;
					this.source[key] = value;
					return;
				}
			} else {
				return;
			}
		}
		if (undo) {
			const previous = this.peekField(key);
			const previousId = this._modelId;
			if (
				Object.is(previous, value) &&
				Object.is(previousId, value) &&
				!debugEnabled &&
				!this.disposed &&
				!this._hasCustomOwnDescriptor &&
				(typeof value === "string" || typeof value === "number")
			) {
				return;
			}
			if (!Object.is(previous, value) || !Object.is(previousId, value)) {
				undo.push(() => {
					// Public writes still cannot clear an established ID.
					setIdentifierAdm(this, previousId);
					this.write(key, previous);
				});
			}
		}
		if (
			clearId &&
			value === undefined &&
			clearId.key === key &&
			Object.is(clearId.id, this._modelId)
		) {
			this.assertUsable();
			if (!this.canWriteManagedField(key))
				throw new TypeError(`r-state-tree: cannot write id field '${key}'`);
			setIdentifierAdm(this, undefined);
			this.write(key, undefined);
		} else {
			this.proxy[key] = value;
		}
	}

	getSnapshot(): Snapshot<any> {
		if (this._constructing) this._constructing = false;
		if (!this.computedSnapshot) {
			this.computedSnapshot = createComputed(() => {
				// Changes to the key set matter even when there are no existing fields.
				this.keysAtom.reportObserved();
				const snapshot = serializeModelSnapshot(
					this,
					this.configuration,
					ModelAdministration.snapshotReads
				);
				configMap.set(snapshot, this.configuration);
				return snapshot;
			});
		}

		return this.computedSnapshot.get() as Snapshot<any>;
	}
}
