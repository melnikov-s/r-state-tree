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
	peekModelById,
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

const ctorIdKeyMap: WeakMap<typeof Model, string | null> = new WeakMap();
const configMap: WeakMap<object, ModelConfiguration<unknown>> = new WeakMap();
let snapshotRollbackVersion = 0;

type SnapshotPlan = {
	releases: (() => void)[];
	writes: (() => void)[];
	undo?: (() => void)[];
};

type SnapshotIdUndo = { key: string; id: IdType };

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

function getIdKey(Ctor: typeof Model): string | null {
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

// Ownership follows the indexed members, not a caller's custom iterator.
function readChildField(field: Model | Model[] | null | undefined): Model[] {
	if (!field) return [];
	if (!Array.isArray(field)) return [field];
	const adm = getAdministration(field);
	if (adm instanceof ChildModelsAdministration) {
		return adm.peekItems();
	}
	return Array.from({ length: field.length }, (_, index) => field[index]);
}

export class ModelAdministration extends PreactObjectAdministration<any> {
	protected override readonly allowsDirectDataWrites = true;

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
						return adm.readProperty(prop, proxy);
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
				adm.beginWrite(name);
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

					return adm.writeProperty(name, value, receiver);
				} finally {
					adm.endWrite(name);
				}
			},

			defineProperty(target, name, desc) {
				const adm = getAdministration(target) as ModelAdministration;
				// Reflect.set reenters this trap while writing the backing field.
				// A later reentrant reaction is not an internal write.
				if (
					!(adm.isWriting && adm.hasWriteInProgress(name)) &&
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
	private _parent: ModelAdministration | null = null;
	private _parentAtom?: AtomNode;
	referencedAtoms!: Map<PropertyKey, AtomNode>;
	referencedModels!: Map<PropertyKey, ComputedNode<readonly Model[]>>;
	private activeModels?: Set<PropertyKey>;
	private childArrays?: Map<PropertyKey, ChildModelsAdministration<Model>>;
	private activeWriteKey?: PropertyKey;
	private _writeInProgress?: Set<PropertyKey>;
	private computedSnapshot: ComputedNode<Snapshot<Model>> | undefined;
	private snapshotMap?: Map<string, ComputedNode<unknown[]>>;
	private disposed = false;
	private snapshotIdUndos?: WeakMap<object, SnapshotIdUndo>;
	parentName: PropertyKey | null = null;

	private beginWrite(name: PropertyKey): void {
		if (this.activeWriteKey === undefined && !this._writeInProgress) {
			this.activeWriteKey = name;
			return;
		}
		const set = (this._writeInProgress ??= new Set());
		if (this.activeWriteKey !== undefined) {
			set.add(this.activeWriteKey);
			this.activeWriteKey = undefined;
		}
		set.add(name);
	}

	private endWrite(name: PropertyKey): void {
		if (this.activeWriteKey === name) {
			this.activeWriteKey = undefined;
			return;
		}
		this._writeInProgress?.delete(name);
	}

	private hasWriteInProgress(name: PropertyKey): boolean {
		return (
			this.activeWriteKey === name ||
			(this._writeInProgress?.has(name) ?? false)
		);
	}

	peekParent(): ModelAdministration | null {
		return this._parent;
	}

	peekRoot(): ModelAdministration {
		let node: ModelAdministration = this;
		while (node._parent) node = node._parent;
		return node;
	}

	private peekField(name: PropertyKey): unknown {
		if (
			name in Object.prototype &&
			!Object.prototype.hasOwnProperty.call(this.source, name)
		) {
			return Reflect.get(this.source, name, this.proxy);
		}
		return this.peek(name, this.proxy);
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

	setConfiguration(configurationGetter: () => ModelConfiguration<any>): void {
		this.configurationGetter = configurationGetter;
	}

	assertUsable(): void {
		if (this.disposed) {
			throw new Error("r-state-tree: cannot use a disposed model");
		}
	}

	private get configuration(): ModelConfiguration<any> {
		return this.configurationGetter
			? this.configurationGetter()
			: (getConfigurationForCtor(
					this.source.constructor as Function
				) as ModelConfiguration<any>);
	}

	/** Retained runtime metadata; snapshots intentionally have different semantics. */
	getInspectionMetadata() {
		const config = this.configuration;
		return {
			fields: Reflect.ownKeys(config).map((key) => ({
				key,
				type: getConfigType(config[key as string]),
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

	/** Only the original undo payload on the recorded Model can restore its unset ID. */
	recordSnapshotIdUndo(undo: object, next: object): void {
		const key = getIdKey(Object.getPrototypeOf(this.proxy).constructor);
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
		const current = this.peekField(name) as Model | Model[] | null | undefined;
		if (Array.isArray(current)) {
			(
				getAdministration(current) as ChildModelsAdministration<Model>
			).assertMutable();
		}
		return batch(() => {
			if (
				!this.changeModels(
					name,
					readChildField(value),
					readChildField(current),
					commit
				)
			)
				return false;
			const previousArray = this.childArrays?.get(name);
			if (previousArray) previousArray.change = undefined;
			this.childArrays?.delete(name);
			if (value) (this.activeModels ??= new Set()).add(name);
			else this.activeModels?.delete(name);
			if (Array.isArray(value)) {
				const adm = getAdministration(
					value
				) as ChildModelsAdministration<Model>;
				adm.change = (added, removed, commit) => {
					this.changeModels(name, added, removed, commit);
				};
				(this.childArrays ??= new Map()).set(name, adm);
			}
			return true;
		});
	}

	private setModels(name: PropertyKey, newModelsSource: Model[]): boolean {
		if (this.peekField(name) === newModelsSource) return true;
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

	private getModelRefs(name: PropertyKey): readonly Model[] {
		const a = this.getReferencedAtom(name);

		let c = this.referencedModels?.get(name);

		if (!c) {
			if (!this.referencedModels) this.referencedModels = new Map();
			c = createComputed(() => {
				a.reportObserved();
				const Type = this.getRequiredModelRefType(name);
				const root = this.root.proxy;
				const ids = this.source[name] as IdType | IdType[] | undefined;
				const models = (Array.isArray(ids) ? ids : [])
					.map((id) => getModelById(root, Type, id))
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

	private attach(
		parent: ModelAdministration | null = null,
		parentName: PropertyKey | null = null
	): void {
		this.assertUsable();
		if (this._parent) {
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
				if (this.activeModels) {
					for (const name of this.activeModels) {
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
				if (this._parent) this.detach();
			} finally {
				if (this.childArrays) {
					for (const array of this.childArrays.values()) array.dispose();
					this.childArrays.clear();
				}
				this.activeModels?.clear();
			}
		});
	}

	private toJSON(): Snapshot<Model> {
		// A field added after this read was not tracked as a value. Observe the
		// key set as well, including when there are no existing snapshot fields.
		this.keysAtom.reportObserved();
		const config = this.configuration;
		const keys = new Set([...Object.keys(this.source), ...Object.keys(config)]);
		return Array.from(keys).reduce((json: any, key) => {
			switch (getConfigType(config[key])) {
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
						const snapshotMap = (this.snapshotMap ??= new Map());
						if (!snapshotMap.has(key)) {
							snapshotMap.set(
								key,
								createComputed(() => {
									const value = this.proxy[key];
									if (!Array.isArray(value)) return [];
									const array = getAdministration(value);
									if (!(array instanceof ChildModelsAdministration)) {
										return getSource(
											value.map((model: Model) =>
												getModelAdm(model).getSnapshot()
											)
										);
									}
									// The child array reports every structural write to this
									// dependency; only the individual Model snapshots need
									// tracking, not each proxy index read.
									array.reportObserved();
									array.atom.reportObserved(); // also track explicit reportChanged()
									const items = array.source;
									const snapshots = new Array(items.length);
									for (let i = 0; i < items.length; i++) {
										snapshots[i] = getModelAdm(items[i]).getSnapshot();
									}
									return snapshots;
								})
							);
						}
						json[key] = snapshotMap.get(key)!.get();
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
		untracked(() => {
			const config = this.configuration;
			const keys = Object.keys(this.source);
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i];
				if (getConfigType(config[key]) === undefined) {
					try {
						clone(this.peekField(key), key);
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
		});
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

	applySnapshot(snapshot: Snapshot<any>): void {
		const undo: (() => void)[] = [];
		let rejection: { error: unknown } | undefined;
		try {
			batch(() => {
				try {
					this.loadSnapshot(snapshot, undo);
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
					snapshotRollbackVersion++;
					throw error;
				}
			});
		} catch (error) {
			// A failed load takes precedence over any error while flushing the
			// batch. A subscriber failure on success is not a load failure.
			throw rejection ? rejection.error : error;
		}
	}

	loadSnapshot(snapshot: Snapshot<any>, undo?: (() => void)[]): void {
		untracked(() => {
			batch(() => {
				const plan: SnapshotPlan = { releases: [], writes: [], undo };
				this.planSnapshot(snapshot, plan, this.snapshotIdUndos?.get(snapshot));
				// Release only edges absent from the final slots (at every depth)
				// before acquiring new ones. The ordinary setters still validate all
				// attachments against retained subtrees and other new children.
				for (const release of plan.releases) release();
				for (const write of plan.writes) write();
			});
		});
	}

	private assignSnapshotField(
		key: string,
		value: unknown,
		undo?: (() => void)[],
		previous = this.peekField(key)
	): void {
		const hadOwn = Object.hasOwn(this.source, key);
		this.proxy[key] = value;
		if (undo && !Object.is(previous, value)) {
			undo.push(() => {
				if (!hadOwn && this.getCfgType(key) === CommonCfgTypes.child)
					delete this.proxy[key];
				else this.proxy[key] = previous;
			});
		}
	}

	private planSnapshot(
		snapshot: Snapshot<any>,
		plan: SnapshotPlan,
		clearId?: SnapshotIdUndo
	): void {
		const config = this.configuration;
		for (const key of Object.keys(snapshot)) {
			const value = snapshot[key];
			const type = getConfigType(config[key]) as
				| ModelCfgTypes
				| CommonCfgTypes
				| undefined;
			if (type === CommonCfgTypes.child) {
				this.planSnapshotChild(key, value, plan);
			} else {
				plan.writes.push(() =>
					this.loadSnapshotField(key, value, type, plan.undo, clearId)
				);
			}
		}
	}

	private planSnapshotChild(key: string, value: any, plan: SnapshotPlan): void {
		const current = this.peekField(key) as Model | Model[] | null | undefined;
		const currentChildren = readChildField(current);
		const retained = new Set<Model>();
		const snapshotIds = new Set<IdType>();
		const Ctor = this.getCfgChildType(key) as typeof Model | undefined;
		const inArray = Array.isArray(value);

		const prepare = (
			snapshot: Snapshot | Model,
			index: number
		): (() => Model) => {
			if (snapshot instanceof Model) {
				const model = getModelAdm(snapshot).proxy as Model;
				retained.add(model);
				return () => model;
			}
			if (!Ctor) {
				throw new Error(
					"r-state-tree: child constructor must be specified to load snapshots with child/children. eg: `@child(ChildCtor) MyChild`"
				);
			}
			const idKey = getIdKey(Ctor);
			const hasId = idKey !== null && Object.hasOwn(snapshot, idKey);
			const id = hasId
				? (snapshot as Record<string, IdType | undefined>)[idKey]
				: undefined;
			let match: Model | undefined;
			if (id != null) {
				if (snapshotIds.has(id)) {
					throw new Error(
						"r-state-tree duplicate ids detected after snapshot was loaded"
					);
				}
				snapshotIds.add(id);
				match = peekModelById(this.peekRoot().proxy, Ctor, id);
				if (match) {
					const adm = getModelAdm(match);
					if (adm._parent !== this || adm.parentName !== key) match = undefined;
				}
			} else if (inArray && Array.isArray(current)) {
				const positional = currentChildren[index];
				// An omitted identifier can patch the positional child. An explicit
				// unset ID describes an unidentified child, not a request to clear an
				// established ID; recreate in that case instead of changing the ID.
				if (positional && (!hasId || getIdentifier(positional) == null))
					match = positional;
			}

			if (match) {
				retained.add(match);
				getModelAdm(match).planSnapshot(snapshot, plan);
				return () => match;
			}
			return () => {
				if (!plan.undo) return Ctor.create(snapshot);
				const model = Ctor.create();
				// Hydrate in the outer transaction as a new child can itself take
				// ownership of externally supplied Model instances.
				getModelAdm(model).loadSnapshot(snapshot, plan.undo);
				return model;
			};
		};

		const prepareValue = inArray
			? (value as Snapshot[]).map((item, index) => prepare(item ?? {}, index))
			: value == null
				? null
				: prepare(value, 0);

		const remaining = currentChildren.filter((model) => retained.has(model));
		if (remaining.length !== currentChildren.length) {
			plan.releases.push(() =>
				this.assignSnapshotField(
					key,
					Array.isArray(current) ? remaining : null,
					plan.undo
				)
			);
		}
		plan.writes.push(() =>
			this.assignSnapshotField(
				key,
				Array.isArray(prepareValue)
					? prepareValue.map((makeChild) => makeChild())
					: (prepareValue?.() ?? null),
				plan.undo
			)
		);
	}

	private loadSnapshotField(
		key: string,
		value: any,
		type: ModelCfgTypes | CommonCfgTypes | undefined,
		undo?: (() => void)[],
		clearId?: SnapshotIdUndo
	): void {
		switch (type) {
			case undefined: {
				if (!Object.prototype.hasOwnProperty.call(this.source, key)) {
					console.warn(
						`r-state-tree: invalid key '${key}' found in snapshot, ignored.`
					);
					break;
				}
				const currentValue = this.peekField(key);
				const changeTracker = { changed: false, undo, copyInput: true };
				const hydratedValue = hydrateSnapshotValue(
					currentValue,
					value,
					changeTracker
				);
				this.assignSnapshotField(key, hydratedValue, undo, currentValue);
				if (changeTracker.changed && Object.is(currentValue, hydratedValue)) {
					this.atom.reportChanged();
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
					const previous = this.source[key];
					undo.push(() => this.writeReference(key, previous));
				}
				if (Array.isArray(value)) {
					if ((value as unknown[])?.[0] instanceof Model) {
						this.proxy[key] = value;
					} else {
						this.writeReference(
							key,
							value.map((snapshot: RefSnapshot) => getSnapshotRefId(snapshot))
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
				if (undo) {
					const previous = this.peekField(key);
					const previousId = getIdentifier(this.proxy);
					undo.push(() => {
						// Public writes still cannot clear an established ID.
						setIdentifier(this.proxy, previousId);
						this.write(key, previous);
					});
				}
				if (
					clearId &&
					value === undefined &&
					clearId.key === key &&
					Object.is(clearId.id, getIdentifier(this.proxy))
				) {
					this.assertUsable();
					if (!this.canWriteManagedField(key))
						throw new TypeError(`r-state-tree: cannot write id field '${key}'`);
					setIdentifier(this.proxy, undefined);
					this.write(key, undefined);
				} else {
					this.proxy[key] = value;
				}
				break;
		}
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
}
