import { batch, createAtom, createComputed } from "./preact.js";
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
	keysAtom: AtomNode;
	hasMap: AtomMap<PropertyKey>;
	valuesMap: SignalMap<PropertyKey>;
	computedMap!: Map<PropertyKey, ComputedNode<T[keyof T]>>;
	types: Map<PropertyKey, PropertyType | null>;
	isWriting: boolean = false;

	static proxyTraps: ProxyHandler<object> = {
		has(target, name) {
			return getAdministration(target).has(name);
		},

		get(target, name) {
			const adm = getAdministration(target);
			// Check if the property is physically present on the source.
			// Ideally we want to let `Reflect.has` decide, but we need to intercept
			// standard object methods if they are NOT own properties (to hide administration).
			// If they ARE own properties (e.g. user defined toString), we should track them.
			if (
				isPropertyKey(name) &&
				(!(name in Object.prototype) ||
					Object.prototype.hasOwnProperty.call(adm.source, name)) &&
				(typeof adm.source !== "function" || name !== "prototype")
			) {
				return adm.read(name, arguments[2]);
			}

			return Reflect.get(adm.source, name, arguments[2]);
		},

		set(target, name, value) {
			if (!isPropertyKey(name)) return false;

			const adm = getAdministration(target) as ObjectAdministration<any>;
			const receiver = arguments[3];

			// If receiver is the proxy itself, use the administration write path (reactive)
			if (receiver === adm.proxy) {
				return adm.write(name, value);
			}

			// Otherwise (prototype chain access), perform a standard Reflect.set on the receiver.
			// This ensures the property is set on the child object (receiver), not the prototype (validating tests).
			return Reflect.set(adm.source, name, value, receiver);
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
					adm.types.delete(name);
					adm.flushChange();
					adm.keysAtom.reportChanged();
					if (!hadOwn) adm.hasMap.reportChanged(name);

					if ("value" in descriptor) {
						if (isObservable(descriptor.value)) {
							adm.explicitObservables.add(name);
						} else {
							adm.explicitObservables.delete(name);
						}
						adm.valuesMap.reportChanged(name, descriptor.value);
					} else {
						// Re-read accessors only in the observer, not while defining them.
						const valueNode = adm.valuesMap.get(name);
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
		this.keysAtom = createAtom();
		this.hasMap = new AtomMap();
		this.valuesMap = new SignalMap();
		this.types = new Map();
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

	private getType(key: keyof T): PropertyType | null {
		const cached = this.types.get(key);
		if (cached !== undefined) return cached;

		const descriptor = getPropertyDescriptor(this.source, key);
		const type = getPropertyType(key, this.source, descriptor);
		// A miss still tracks in the bounded node maps, but needs no type entry.
		if (descriptor) this.types.set(key, type);
		return type;
	}

	reportChanged(): void {
		this.types.clear();
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

		if (type === "observable") {
			// Strict Shallow: Only re-wrap if explicitly tracked or if source contains a proxy
			const shouldWrap =
				this.explicitObservables.has(key) || isObservable(value);

			if (
				shouldWrap &&
				value &&
				typeof value === "object" &&
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

	private explicitObservables = new Set<PropertyKey>();

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

		const oldExplicit = this.explicitObservables.has(key);
		const newExplicit = isObservable(newValue);

		// Update strict shallow tracking
		if (newExplicit) {
			this.explicitObservables.add(key);
		} else {
			this.explicitObservables.delete(key);
		}

		if (
			(type === "action" && typeof newValue !== "function") ||
			(type === "observable" && typeof newValue === "function")
		) {
			this.types.delete(key);
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
					this.keysAtom.reportChanged();
					this.hasMap.reportChanged(key);
				}
				this.valuesMap.reportChanged(key, newValue);
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
			this.types.delete(key);
			this.explicitObservables.delete(key);
			if (debugEnabled)
				debugWrite(this.source, key, "delete", previous, undefined);
			batch(() => {
				this.flushChange();
				const valueNode = this.valuesMap.get(key);
				valueNode?.reportChanged(undefined);
				// Even an undefined key can reveal an inherited value. Keep live nodes attached.
				valueNode?.invalidate();
				this.keysAtom.reportChanged();
				this.hasMap.reportChanged(key);
			});
		}
		return result;
	}
}
