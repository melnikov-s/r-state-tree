import { batch, createAtom, createComputed } from "./preact";
import type { AtomNode, ComputedNode } from "./preact";
import {
	getSource,
	getAction,
	getAdministration,
	isObservable,
} from "./internal/lookup";
import {
	isPropertyKey,
	getPropertyDescriptor,
	getPropertyType,
	resolveNode,
} from "./internal/utils";
import type { PropertyType } from "./internal/utils";
import { Administration } from "./internal/Administration";
import { AtomMap, SignalMap } from "./internal/NodeMap";

export class ObjectAdministration<T extends object> extends Administration<T> {
	keysAtom: AtomNode;
	hasMap: AtomMap<PropertyKey>;
	valuesMap: SignalMap<PropertyKey>;
	computedMap!: Map<PropertyKey, ComputedNode<T[keyof T]>>;
	types: Map<PropertyKey, PropertyType | null>;
	isWriting: boolean = false;

	static proxyTraps: ProxyHandler<object> = {
		has(target, name) {
			const adm = getAdministration(target);

			if (
				isPropertyKey(name) &&
				(!(name in Object.prototype) ||
					Object.prototype.hasOwnProperty.call(adm.source, name))
			)
				return adm.has(name);
			return Reflect.has(adm.source, name);
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

			const result = Reflect.defineProperty(adm.source, name, descriptor);

			if (result) {
				// We must trigger reactivity for the property update.
				// Since we don't know exactly what changed (value vs config), we:
				// 1. Invalidate tracking for this property (type cache) so it is re-evaluated
				// 2. Report a value change to any listeners
				// 3. Report keys/has change if it was a new property

				batch(() => {
					adm.types.delete(name);

					// If it was a new property or status changed, notify map/keys
					// We can't cheaply know if it was new without checking before, but generic "flushChange" and key updates are safe.
					adm.flushChange();
					adm.keysAtom.reportChanged();
					adm.hasMap.reportChanged(name);

					// If it's a value change, we should notify the value listeners.
					// We read the new value from source to report it.
					// If it's a value change, we should notify the value listeners.
					// We read the new value from source to report it.
					if ("value" in descriptor) {
						if (isObservable(descriptor.value)) {
							adm.explicitObservables.add(name);
						} else {
							adm.explicitObservables.delete(name);
						}
						adm.valuesMap.reportChanged(name, descriptor.value);
					} else {
						// For accessor changes or meta-only changes, also report generic change
						adm.valuesMap.reportChanged(name, undefined); // Signal a potential change
					}
				});
			}
			return result;
		},
	};

	constructor(source: T = {} as T) {
		super(source);
		this.keysAtom = createAtom();
		this.hasMap = new AtomMap(this.atom);
		this.valuesMap = new SignalMap(this.atom);
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
		const computedNode = this.getComputed(key);

		return computedNode.get();
	}

	private getType(key: keyof T): PropertyType | null {
		let type = this.types.get(key);

		if (type === undefined) {
			type = getPropertyType(key, this.source);
			this.types.set(key, type);
		}

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

		return resolveNode(this.valuesMap.getOrCreate(key, this.source[key]));
	}

	read(key: keyof T, receiver: any = this.proxy): unknown {
		const type = this.getType(key);

		// Non-reactive property - just return the raw value
		if (type === null) {
			return Reflect.get(this.source, key, receiver);
		}

		switch (type) {
			case "observable":
			case "action": {
				if (key in this.source) {
					this.valuesMap.reportObserved(key, this.source[key]);
				}

				this.atom.reportObserved();

				if (this.atom.observing) {
					//has map might be an arbitrary key and reportObserved creates an atom for each one
					// we don't need to do this if we're not in a reaction
					this.hasMap.reportObserved(key);
				}

				if (type === "observable") {
					const value = Reflect.get(this.source, key, receiver);

					// Strict Shallow: Only re-wrap if explicitly tracked or if source contains a proxy
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

				return getAction(
					Reflect.get(this.source, key, receiver) as unknown as Function
				);
			}
			case "computed": {
				if (receiver === this.proxy) {
					return this.callComputed(key);
				}
				this.atom.reportObserved();
				return Reflect.get(this.source, key, receiver);
			}
			default:
				throw new Error(`unknown type passed to configure`);
		}
	}

	private explicitObservables = new Set<PropertyKey>();

	write(key: keyof T, newValue: T[keyof T]): boolean {
		const type = this.getType(key);

		// Non-reactive property - just set the value directly
		if (type === null) {
			return this.set(key, newValue);
		}

		// if this property is a setter
		if (type === "computed") {
			return batch(() => this.set(key, newValue));
		}

		const had = key in this.source;
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
			!had ||
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

			batch(() => {
				this.flushChange();
				if (!had) {
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

		if (this.atom.observing) {
			this.hasMap.reportObserved(key);
		}

		return key in this.source;
	}

	remove(key: keyof T): boolean {
		if (!(key in this.source)) return true;

		const result = Reflect.deleteProperty(this.source, key);
		if (result) {
			batch(() => {
				this.flushChange();
				this.valuesMap.reportChanged(key, undefined);
				this.keysAtom.reportChanged();
				this.hasMap.reportChanged(key);

				this.valuesMap.delete(key);
			});
		}
		return result;
	}
}
