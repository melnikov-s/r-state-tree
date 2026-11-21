import { batch, createAtom, createComputed, untracked } from "./preact.js";
import type { AtomNode, ComputedNode } from "./preact.js";
import {
	getSource,
	getAction,
	getAdministration,
	isObservable,
} from "./internal/lookup.js";
import {
	isPropertyKey,
	getPropertyDescriptor,
	getPropertyType,
	resolveNode,
} from "./internal/utils.js";
import type { PropertyType } from "./internal/utils.js";
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
	isWriting: boolean = false;

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

	static proxyTraps: ProxyHandler<object> = {
		has(target, name) {
			return getAdministration(target).has(name);
		},

		get(target, name, receiver) {
			return getAdministration(target).readProperty(name, receiver);
		},

		set(target, name, value, receiver) {
			return getAdministration(target).writeProperty(name, value, receiver);
		},

		deleteProperty(target, name) {
			if (!isPropertyKey(name)) return false;
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
				batch(() => {
					adm._types?.delete(name);
					adm.flushChange();
					adm._keysAtom?.reportChanged();
					if (!hadOwn) adm._hasMap?.reportChanged(name);

					if ("value" in descriptor) {
						if (isObservable(descriptor.value)) {
							(adm.explicitObservables ??= new Set()).add(name);
						} else {
							adm.explicitObservables?.delete(name);
						}
						adm._valuesMap?.reportChanged(name, descriptor.value);
					} else {
						// Re-read accessors only in the observer, not while defining them.
						const valueNode = adm._valuesMap?.get(name);
						valueNode?.reportChanged(undefined);
						valueNode?.invalidate();
					}
				});
			}
			return result;
		},
	};

	constructor(source: T = {} as T) {
		super(source);
	}

	protected readProperty(name: PropertyKey, receiver: unknown): unknown {
		// Inherited Object methods are transparent; own overrides are reactive.
		if (
			(!(name in Object.prototype) || Object.hasOwn(this.source, name)) &&
			(typeof this.source !== "function" || name !== "prototype")
		) {
			return this.read(name as keyof T, receiver);
		}
		return Reflect.get(this.source, name, receiver);
	}

	protected writeProperty(
		name: PropertyKey,
		value: T[keyof T],
		receiver: unknown
	): boolean {
		if (receiver === this.proxy) return this.write(name as keyof T, value);
		// A prototype-chain write must target the actual receiver.
		return Reflect.set(this.source, name, value, receiver);
	}

	private get(key: PropertyKey): T[keyof T] {
		return Reflect.get(this.source, key, this.proxy);
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

		const descriptor = getPropertyDescriptor(this.source, key);
		const type = getPropertyType(key, this.source, descriptor);
		// A miss still tracks in the bounded node maps, but needs no type entry.
		if (descriptor) (this._types ??= new Map()).set(key, type);
		return type;
	}

	reportChanged(): void {
		this._types?.clear();
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

		if (this.atom.observing) {
			// has map might be an arbitrary key and reportObserved creates an atom for each one
			// we don't need to do this if we're not in a reaction
			this.hasMap.reportObserved(key);
		}

		const value = Reflect.get(this.source, key, receiver);
		this.valuesMap.reportObserved(key, value);

		return this.wrapReadValue(key, type, value);
	}

	/** Read a property with the same wrapping/accessor semantics as `read`, without creating dependency nodes. */
	peek(key: keyof T, receiver: any = this.proxy): unknown {
		const type = this.getType(key);

		if (type === "computed") {
			if (receiver === this.proxy) {
				return untracked(() => this.callComputed(key));
			}
			return Reflect.get(this.source, key, receiver);
		}

		if (type === null) {
			return Reflect.get(this.source, key, receiver);
		}

		const value = Reflect.get(this.source, key, receiver);
		return this.wrapReadValue(key, type, value);
	}

	private wrapReadValue(
		key: keyof T,
		type: "action" | "observable",
		value: unknown
	): unknown {
		if (type === "observable") {
			// Strict Shallow: Only re-wrap if explicitly tracked or if source contains a proxy
			if (
				value &&
				typeof value === "object" &&
				(this.explicitObservables?.has(key) || isObservable(value)) &&
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
			return value;
		}

		// Otherwise it's an action
		return getAction(value as unknown as Function);
	}

	private explicitObservables?: Set<PropertyKey>;

	write(key: keyof T, newValue: T[keyof T]): boolean {
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
		const oldValue: T[keyof T] = this.get(key);
		const targetValue = getSource(newValue);

		const oldExplicit = this.explicitObservables?.has(key) ?? false;
		const newExplicit = isObservable(newValue);

		// Update strict shallow tracking
		if (newExplicit) {
			(this.explicitObservables ??= new Set()).add(key);
		} else {
			this.explicitObservables?.delete(key);
		}

		if (
			(type === "action" && typeof newValue !== "function") ||
			(type === "observable" && typeof newValue === "function")
		) {
			this._types?.delete(key);
		}

		const changed =
			!hadOwn ||
			(!isObservable(oldValue) && oldExplicit !== newExplicit) ||
			(isObservable(oldValue)
				? oldValue !== newValue
				: oldValue !== targetValue);

		if (changed) {
			this.isWriting = true;
			try {
				const result = this.set(key, targetValue as T[keyof T]);
				if (!result) return false;
			} finally {
				this.isWriting = false;
			}

			const added = !hadOwn && Object.hasOwn(this.source, key);
			if (debugEnabled)
				debugWrite(this.source, key, added ? "add" : "set", oldValue, newValue);
			batch(() => {
				this.flushChange();
				if (added) {
					this._keysAtom?.reportChanged();
					this._hasMap?.reportChanged(key);
				}
				this._valuesMap?.reportChanged(key, newValue);
			});
			return true;
		}

		return true;
	}

	has(key: keyof T): boolean {
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
			this.explicitObservables?.delete(key);
			if (debugEnabled)
				debugWrite(this.source, key, "delete", previous, undefined);
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
		return result;
	}
}
