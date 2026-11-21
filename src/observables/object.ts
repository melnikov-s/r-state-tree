import { batch, createAtom, createComputed } from "./preact.js";
import type { AtomNode, ComputedNode } from "./preact.js";
import {
	getSource,
	getAction,
	getAdministration,
	isObservable,
} from "./internal/lookup.js";
import {
	getPropertyDescriptor,
	getPropertyType,
	isPlainObject,
	resolveNode,
} from "./internal/utils.js";
import type { PropertyType } from "./internal/utils.js";
import { ObservableCfgTypes } from "../types.js";
import { getConfigType } from "../configuration.js";
import { Administration } from "./internal/Administration.js";
import { AtomMap, SignalMap } from "./internal/NodeMap.js";
import { debugWrite, debugEnabled } from "./internal/debug.js";
import { retainedChildRead } from "./internal/retainedRead.js";

export class ObjectAdministration<T extends object> extends Administration<T> {
	private _keysAtom?: AtomNode;
	private _hasMap?: AtomMap<PropertyKey>;
	private _valuesMap?: SignalMap<PropertyKey>;
	computedMap!: Map<PropertyKey, ComputedNode<T[keyof T]>>;
	private _types?: Map<PropertyKey, PropertyType | null>;
	private _plainAccessors?: Set<PropertyKey>;
	private _explicitObservables?: Set<PropertyKey>;
	isWriting: boolean = false;
	/** @internal True during Model/Store class field initialization before the instance escapes. */
	_constructing: boolean = false;
	/** @internal Set if an own non-writable or accessor descriptor was defined on this object. */
	_hasCustomOwnDescriptor: boolean = false;
	/** @internal True on runtime-owned Model/Store instances until an own custom descriptor is defined. */
	protected _cleanOwnDescriptors: boolean = false;

	get keysAtom(): AtomNode {
		return (this._keysAtom ??= createAtom());
	}

	get hasMap(): AtomMap<PropertyKey> {
		return (this._hasMap ??= new AtomMap());
	}

	get valuesMap(): SignalMap<PropertyKey> {
		return (this._valuesMap ??= new SignalMap());
	}

	get types(): Map<PropertyKey, PropertyType | null> {
		return (this._types ??= new Map());
	}

	/** @internal */
	hasExplicitObservable(key: PropertyKey): boolean {
		return this._explicitObservables?.has(key) ?? false;
	}

	/** @internal */
	markExplicitObservable(key: PropertyKey): void {
		(this._explicitObservables ??= new Set()).add(key);
	}

	/** @internal */
	protected hasAnyObservers(): boolean {
		return !!(
			this._valuesMap ||
			this._keysAtom ||
			this._hasMap ||
			this.hasForceObserved()
		);
	}

	/** @internal Subclasses with cached class config override this to avoid getConfigurationForCtor. */
	protected getInstanceConfig(): Record<PropertyKey, any> | undefined {
		return undefined;
	}

	/** @internal Shared proxy get trap body avoiding a second getAdministration() lookup in subclasses. */
	static trapGet(
		adm: ObjectAdministration<any>,
		name: PropertyKey,
		receiver: any
	): unknown {
		if (
			(!(name in Object.prototype) ||
				Object.prototype.hasOwnProperty.call(adm.source, name)) &&
			(typeof adm.source !== "function" || name !== "prototype")
		) {
			return adm.read(name, receiver);
		}
		return Reflect.get(adm.source, name, receiver);
	}

	/** @internal Shared proxy set trap body avoiding a second getAdministration() lookup in subclasses. */
	static trapSet(
		adm: ObjectAdministration<any>,
		name: PropertyKey,
		value: any,
		receiver: any
	): boolean {
		if (receiver === adm.proxy) {
			return adm.write(name, value);
		}
		return Reflect.set(adm.source, name, value, receiver);
	}

	static proxyTraps: ProxyHandler<object> = {
		has(target, name) {
			return getAdministration(target).has(name);
		},

		get(target, name, receiver) {
			return ObjectAdministration.trapGet(
				getAdministration(target),
				name,
				receiver
			);
		},

		set(target, name, value, receiver) {
			return ObjectAdministration.trapSet(
				getAdministration(target) as ObjectAdministration<any>,
				name,
				value,
				receiver
			);
		},

		deleteProperty(target, name) {
			const adm = getAdministration(target) as ObjectAdministration<any>;
			return adm.remove(name);
		},

		ownKeys(target) {
			const adm = getAdministration(target);
			batch(() => {
				adm.keysAtom.reportObserved();
				adm.atom.reportObserved();
			});

			return Reflect.ownKeys(adm.source);
		},

		defineProperty(target, name, descriptor) {
			const adm = getAdministration(target) as ObjectAdministration<any>;

			if (adm.isWriting) {
				return Reflect.defineProperty(adm.source, name, descriptor);
			}

			const hadOwn = Object.hasOwn(adm.source, name);
			const previous = debugEnabled
				? Object.getOwnPropertyDescriptor(adm.source, name)?.value
				: undefined;
			const result = Reflect.defineProperty(adm.source, name, descriptor);
			if (result && debugEnabled)
				debugWrite(
					adm.source,
					name,
					"define",
					previous,
					"value" in descriptor ? descriptor.value : undefined
				);

			if (result) {
				if (!("value" in descriptor) || descriptor.writable === false) {
					adm._hasCustomOwnDescriptor = true;
					adm._cleanOwnDescriptors = false;
				}
				adm._types?.delete(name);
				adm._plainAccessors?.delete(name);

				const hasValue = "value" in descriptor;
				if (hasValue) {
					const val = descriptor.value;
					if (typeof val === "object" && val !== null && isObservable(val)) {
						(adm._explicitObservables ??= new Set()).add(name);
					} else {
						adm._explicitObservables?.delete(name);
					}
				}

				if (
					adm._keysAtom ||
					adm._hasMap ||
					adm._valuesMap ||
					adm.hasForceObserved()
				) {
					batch(() => {
						adm.flushChange();
						adm._keysAtom?.reportChanged();
						if (!hadOwn) adm._hasMap?.reportChanged(name);

						if (hasValue) {
							adm._valuesMap?.reportChanged(name, descriptor.value);
						} else {
							// Re-read accessors only in the observer, not while defining them.
							const valueNode = adm._valuesMap?.get(name);
							valueNode?.reportChanged(undefined);
							valueNode?.invalidate();
						}
					});
				}
			}
			return result;
		},
	};

	constructor(source: T = {} as T) {
		super(source);
	}

	private set(key: PropertyKey, value: T[keyof T]): boolean {
		return batch(() => Reflect.set(this.source, key, value, this.proxy));
	}

	private getComputed(key: keyof T): ComputedNode<T[keyof T]> {
		if (!this.computedMap) this.computedMap = new Map();
		let computedNode = this.computedMap.get(key);
		if (!computedNode) {
			const descriptor = getPropertyDescriptor(this.source, key)!;
			if (typeof descriptor?.get !== "function") {
				throw new Error("computed values are only supported on getters");
			}
			computedNode = createComputed(descriptor.get, this.proxy);

			this.computedMap.set(key, computedNode);
		}

		return computedNode;
	}

	private callComputed(key: keyof T): T[keyof T] {
		// A restricted read must not cache an error/value under different application semantics.
		if (retainedChildRead)
			return getPropertyDescriptor(this.source, key)!.get!.call(this.proxy);
		const computedNode = this.getComputed(key);

		return computedNode.get();
	}

	/** @internal Shared classification for proxy reads and field signals. */
	getType(key: keyof T): PropertyType | null {
		const cached = this._types?.get(key);
		if (cached !== undefined) return cached;

		if (
			this._cleanOwnDescriptors &&
			Object.prototype.hasOwnProperty.call(this.source, key)
		) {
			const val = (this.source as any)[key];
			let type: PropertyType | null;
			if (typeof val === "function") {
				type = "action";
			} else {
				const config = this.getInstanceConfig();
				type =
					config && getConfigType(config[key]) === ObservableCfgTypes.computed
						? "computed"
						: "observable";
			}
			(this._types ??= new Map()).set(key, type);
			return type;
		}

		// Fast path for own data properties (avoids prototype walk and getConfigurationForCtor).
		const ownDesc = Object.getOwnPropertyDescriptor(this.source, key);
		if (ownDesc) {
			let type: PropertyType | null;
			if ("value" in ownDesc) {
				if (typeof ownDesc.value === "function") {
					type = "action";
				} else {
					const config = this.getInstanceConfig();
					if (config) {
						type =
							getConfigType(config[key]) === ObservableCfgTypes.computed
								? "computed"
								: "observable";
					} else if (isPlainObject(this.source)) {
						type = "observable";
					} else {
						type = getPropertyType(key, this.source, ownDesc);
					}
				}
			} else {
				const plain = isPlainObject(this.source);
				if (plain) {
					type = "observable";
					(this._plainAccessors ??= new Set()).add(key);
				} else {
					const config = this.getInstanceConfig();
					if (config) {
						const cfgType = getConfigType(config[key]);
						type =
							cfgType === ObservableCfgTypes.computed
								? "computed"
								: cfgType !== undefined
									? "observable"
									: null;
					} else {
						type = getPropertyType(key, this.source, ownDesc);
					}
				}
			}
			(this._types ??= new Map()).set(key, type);
			return type;
		}

		// Fast path when property doesn't exist anywhere on source or its prototype chain.
		if (!(key in this.source)) {
			const config = this.getInstanceConfig();
			if (config) {
				return getConfigType(config[key]) === ObservableCfgTypes.computed
					? "computed"
					: "observable";
			}
			if (isPlainObject(this.source)) return "observable";
			return getPropertyType(key, this.source, undefined);
		}

		const descriptor = getPropertyDescriptor(this.source, key);
		const type = getPropertyType(key, this.source, descriptor);
		// A miss still tracks in the bounded node maps, but needs no type entry.
		if (descriptor) {
			(this._types ??= new Map()).set(key, type);
			if (
				type === "observable" &&
				(typeof descriptor.get === "function" ||
					typeof descriptor.set === "function") &&
				isPlainObject(this.source)
			) {
				(this._plainAccessors ??= new Set()).add(key);
			}
		}
		return type;
	}

	reportChanged(): void {
		this._types?.clear();
		this._plainAccessors?.clear();
		super.reportChanged();
	}

	getNode(key?: keyof T): unknown {
		if (!key) {
			return this.atom;
		}

		const type = this.getType(key);

		if (type === "computed") {
			return resolveNode(this.getComputed(key));
		}

		if (type === null) {
			return undefined;
		}

		return resolveNode(this.valuesMap.getOrCreate(key, this.source[key]));
	}

	read(key: keyof T, receiver: any = this.proxy): unknown {
		const type = this.getType(key);

		if (type === "computed") {
			if (receiver === this.proxy) {
				return this.callComputed(key);
			}
			this.atom.reportObserved();
			return Reflect.get(this.source, key, receiver);
		}

		if (type === null) {
			// Transparent passthrough for non-reactive properties/accessors.
			return Reflect.get(this.source, key, receiver);
		}

		// Report that the property was accessed
		this.atom.reportObserved();

		const hadOwn = Object.prototype.hasOwnProperty.call(this.source, key);
		const value =
			this._cleanOwnDescriptors && hadOwn && receiver === this.proxy
				? (this.source as any)[key]
				: Reflect.get(this.source, key, receiver);

		if ((!hadOwn || value === undefined) && this.atomObserving) {
			// Track presence when absent or undefined so adding/deleting an undefined
			// property still notifies readers.
			this.hasMap.reportObserved(key);
		}
		this.valuesMap.reportObserved(key, value);

		if (type === "observable") {
			if (typeof value === "object" && value !== null) {
				// Strict Shallow: Only re-wrap if explicitly tracked or if source contains a proxy
				if (
					(this._explicitObservables?.has(key) || isObservable(value)) &&
					!Object.isFrozen(value)
				) {
					// Check Proxy Invariants:
					// If the property is non-configurable and non-writable, we MUST return the original value.
					// We cannot return a proxy wrapper.
					const desc = getPropertyDescriptor(this.source, key);
					if (desc && !desc.configurable && !desc.writable) {
						return value;
					}

					const existingAdm = getAdministration(value);
					if (existingAdm) {
						return existingAdm.proxy;
					}
				}
			}
			return value;
		}

		// Otherwise it's an action
		return getAction(value as unknown as Function);
	}

	private writeConstructing(key: keyof T, newValue: T[keyof T]): boolean {
		if (
			!debugEnabled &&
			!this.atomObserving &&
			!this.hasAnyObservers() &&
			!(key in this.source)
		) {
			const isNewObj = typeof newValue === "object" && newValue !== null;
			if (!isNewObj) {
				if (typeof newValue !== "function") {
					const config = this.getInstanceConfig();
					if (
						!config ||
						getConfigType(config[key]) !== ObservableCfgTypes.computed
					) {
						return Reflect.set(this.source, key, newValue);
					}
				}
			} else {
				const config = this.getInstanceConfig();
				if (
					!config ||
					getConfigType(config[key]) !== ObservableCfgTypes.computed
				) {
					const newExplicit = isObservable(newValue);
					if (newExplicit) {
						(this._explicitObservables ??= new Set()).add(key);
					}
					return Reflect.set(
						this.source,
						key,
						newExplicit ? getSource(newValue) : newValue
					);
				}
			}
		}
		return this.writeNormal(key, newValue);
	}

	write(key: keyof T, newValue: T[keyof T]): boolean {
		if (this._constructing) return this.writeConstructing(key, newValue);
		return this.writeNormal(key, newValue);
	}

	private writeNormal(key: keyof T, newValue: T[keyof T]): boolean {
		const type = this.getType(key);

		if (type === null) {
			const result = Reflect.set(this.source, key, newValue, this.proxy);
			if (result && debugEnabled)
				debugWrite(this.source, key, "setter", undefined, newValue);
			return result;
		}

		// if this property is a setter
		if (type === "computed") {
			return batch(() => {
				const result = this.set(key, newValue);
				if (result && debugEnabled)
					debugWrite(this.source, key, "setter", undefined, newValue);
				return result;
			});
		}

		const hadOwn = Object.hasOwn(this.source, key);
		// Public observable() can wrap a user Proxy. Do not substitute its receiver.
		const isOwnData = hadOwn && this._cleanOwnDescriptors;
		const oldValue: T[keyof T] = isOwnData
			? (this.source as any)[key]
			: Reflect.get(this.source, key, this.proxy);
		const isNewObj = typeof newValue === "object" && newValue !== null;
		const newExplicit = isNewObj && isObservable(newValue);
		const targetValue = isNewObj ? getSource(newValue) : newValue;

		const oldExplicit = this._explicitObservables?.has(key) ?? false;

		// Update strict shallow tracking
		if (newExplicit) {
			(this._explicitObservables ??= new Set()).add(key);
		} else if (oldExplicit) {
			this._explicitObservables!.delete(key);
		}

		if (
			(type === "action" && typeof newValue !== "function") ||
			(type === "observable" && typeof newValue === "function")
		) {
			this._types?.delete(key);
		}

		const isOldObs =
			typeof oldValue === "object" &&
			oldValue !== null &&
			isObservable(oldValue);

		const changed =
			!hadOwn ||
			(!isOldObs && oldExplicit !== newExplicit) ||
			(isOldObs ? oldValue !== newValue : oldValue !== targetValue);

		if (changed) {
			if (isOwnData) {
				// Own data property: write directly on source to avoid reentering Proxy defineProperty.
				if (!Reflect.set(this.source, key, targetValue)) return false;
			} else {
				this.isWriting = true;
				try {
					const result = this._plainAccessors?.has(key)
						? this.set(key, targetValue as T[keyof T])
						: Reflect.set(this.source, key, targetValue, this.proxy);
					if (!result) return false;
				} finally {
					this.isWriting = false;
				}
			}

			const added = !hadOwn && Object.hasOwn(this.source, key);
			if (debugEnabled)
				debugWrite(this.source, key, added ? "add" : "set", oldValue, newValue);

			if (added || this.hasForceObserved()) {
				if (
					this.hasForceObserved() ||
					this._keysAtom ||
					this._hasMap ||
					this._valuesMap
				) {
					batch(() => {
						this.flushChange();
						if (added) {
							this._keysAtom?.reportChanged();
							this._hasMap?.reportChanged(key);
						}
						this._valuesMap?.reportChanged(key, newValue);
					});
				}
			} else {
				this._valuesMap?.reportChanged(key, newValue);
			}
			return true;
		}

		return true;
	}

	has(key: keyof T): boolean {
		if (this._constructing && !this.atomObserving) {
			return Reflect.has(this.source, key);
		}
		this.atom.reportObserved();
		// Lazy computeds need a dependency even before they have subscribers.
		this.hasMap.reportObserved(key);
		return Reflect.has(this.source, key);
	}

	remove(key: keyof T): boolean {
		const hadOwn = Object.hasOwn(this.source, key);
		const previous = debugEnabled
			? Object.getOwnPropertyDescriptor(this.source, key)?.value
			: undefined;
		const result = Reflect.deleteProperty(this.source, key);
		if (result && hadOwn) {
			this._types?.delete(key);
			this._plainAccessors?.delete(key);
			this._explicitObservables?.delete(key);
			if (debugEnabled)
				debugWrite(this.source, key, "delete", previous, undefined);
			if (
				this.hasForceObserved() ||
				this._valuesMap ||
				this._keysAtom ||
				this._hasMap
			) {
				batch(() => {
					this.flushChange();
					const valueNode = this._valuesMap?.get(key);
					valueNode?.reportChanged(undefined);
					// Even an undefined key can reveal an inherited value. Keep live nodes attached.
					valueNode?.invalidate();
					this._keysAtom?.reportChanged();
					this._hasMap?.reportChanged(key);
				});
			}
		}
		return result;
	}
}
