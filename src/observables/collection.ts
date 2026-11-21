import { createAtom, batch, reportObserved } from "./preact.js";
import type { AtomNode } from "./preact.js";
import {
	getSource,
	getAdministration,
	isObservable,
} from "./internal/lookup.js";
import { Administration } from "./internal/Administration.js";
import { AtomMap, SignalMap } from "./internal/NodeMap.js";
import { resolveNode, isNonPrimitive } from "./internal/utils.js";
import {
	debugWrite,
	debugEnabled,
	batch as mutationBatch,
} from "./internal/debug.js";

type Collection<K, V> = Set<K> | Map<K, V>;

const KEY_NOT_FOUND = Symbol("key not found");

export class CollectionAdministration<K, V = K> extends Administration<
	Collection<K, V>
> {
	isMap: boolean;
	private _hasMap?: AtomMap<K>;
	private _valuesMap?: SignalMap<K>;
	private _keysAtom?: AtomNode;
	private isWeak: boolean;
	private strongTracking: Set<K> | null = null;
	private weakTracking: WeakSet<object> | null = null;

	get hasMap(): AtomMap<K> {
		return (this._hasMap ??= new AtomMap());
	}

	get valuesMap(): SignalMap<K> {
		return (this._valuesMap ??= new SignalMap());
	}

	get keysAtom(): AtomNode {
		return (this._keysAtom ??= createAtom());
	}

	static proxyTraps: ProxyHandler<Set<unknown> | Map<unknown, unknown>> = {
		get(target, name) {
			if (name === "size") {
				return getAdministration(target).size;
			}

			const method = CollectionAdministration.methods[name];
			if (method !== undefined) {
				return method;
			}

			return (target as any)[name];
		},
	};

	static methods: Record<PropertyKey, Function> = Object.assign(
		Object.create(null),
		{
			clear(this: any): void {
				(getAdministration(this) as CollectionAdministration<any, any>).clear();
			},
			forEach(this: any, callbackFn: any, thisArg?: unknown): void {
				(getAdministration(this) as CollectionAdministration<any, any>).forEach(
					callbackFn,
					thisArg
				);
			},
			has(this: any, value: any): boolean {
				return (
					getAdministration(this) as CollectionAdministration<any, any>
				).has(value);
			},
			add(this: any, value: any): any {
				(getAdministration(this) as CollectionAdministration<any, any>).add(
					value
				);
				return this;
			},
			set(this: any, key: any, value: any): any {
				(getAdministration(this) as CollectionAdministration<any, any>).set(
					key,
					value
				);
				return this;
			},
			get(this: any, key: any): any {
				return (
					getAdministration(this) as CollectionAdministration<any, any>
				).get(key);
			},
			delete(this: any, value: any): boolean {
				return (
					getAdministration(this) as CollectionAdministration<any, any>
				).delete(value);
			},
			entries(this: any) {
				return (
					getAdministration(this) as CollectionAdministration<any, any>
				).entries();
			},
			keys(this: any) {
				return (
					getAdministration(this) as CollectionAdministration<any, any>
				).keys();
			},
			values(this: any) {
				return (
					getAdministration(this) as CollectionAdministration<any, any>
				).values();
			},
			[Symbol.iterator](this: any) {
				return (getAdministration(this) as CollectionAdministration<any, any>)[
					Symbol.iterator
				]();
			},

			// New ES methods
			union: createGenericMethod("union"),
			intersection: createGenericMethod("intersection"),
			difference: createGenericMethod("difference"),
			symmetricDifference: createGenericMethod("symmetricDifference"),
			isSubsetOf: createGenericMethod("isSubsetOf"),
			isSupersetOf: createGenericMethod("isSupersetOf"),
			isDisjointFrom: createGenericMethod("isDisjointFrom"),
		}
	);

	constructor(source: Collection<K, V>) {
		super(source);
		this.isMap =
			typeof (source as Map<K, V>).set === "function" &&
			typeof (source as Map<K, V>).get === "function";
		this.isWeak = source instanceof WeakMap || source instanceof WeakSet;
	}

	private trackExplicitObservable(key: K): void {
		if (this.isWeak) {
			if (isNonPrimitive(key)) {
				(this.weakTracking ??= new WeakSet()).add(key as any);
			}
		} else {
			(this.strongTracking ??= new Set()).add(key);
		}
	}

	private untrackExplicitObservable(key: K): void {
		if (this.isWeak) {
			if (this.weakTracking && isNonPrimitive(key)) {
				this.weakTracking.delete(key as any);
			}
		} else {
			this.strongTracking?.delete(key);
		}
	}

	private hasExplicitObservable(key: K): boolean {
		if (this.isWeak) {
			return (
				this.weakTracking !== null &&
				isNonPrimitive(key) &&
				this.weakTracking.has(key as any)
			);
		}
		return this.strongTracking !== null && this.strongTracking.has(key);
	}

	private getProxyVariant(key: K): K | undefined {
		if (!isNonPrimitive(key)) return undefined;
		const adm = getAdministration(key as any) as any;
		if (adm && adm.proxy && adm.proxy !== key) {
			return adm.proxy as K;
		}
		return undefined;
	}

	private getExistingKey(key: K): K | typeof KEY_NOT_FOUND {
		if (
			key === null ||
			(typeof key !== "object" && typeof key !== "function")
		) {
			return this.source.has(key) ? key : KEY_NOT_FOUND;
		}
		const target = getSource(key) as K;
		if (this.source.has(target)) return target;
		if (target !== key && this.source.has(key)) return key;

		const proxy = this.getProxyVariant(key);
		if (proxy !== undefined && this.source.has(proxy)) return proxy;

		return KEY_NOT_FOUND;
	}

	private hasEntry(key: K): boolean {
		return this.getExistingKey(key) !== KEY_NOT_FOUND;
	}

	private onCollectionChange(key: K): void {
		if (!this._keysAtom && !this._hasMap && !this.hasForceObserved()) return;
		batch(() => {
			this._keysAtom?.reportChanged();
			this._hasMap?.reportChanged(key);
			this.flushChange();
		});
	}

	getNode(key?: K): unknown {
		if (key == null) {
			return resolveNode(this.atom);
		}

		return resolveNode(
			this.valuesMap.getOrCreate(
				key,
				this.isMap ? (this.source as Map<K, V>).get(key) : key
			)
		);
	}

	clear(): void {
		mutationBatch(() => {
			this.source.forEach((_, key) => this.delete(key));
		});
	}

	forEach(
		callbackFn: (value: V, key: K, collection: Collection<K, V>) => void,
		thisArg?: unknown
	): void {
		this.keysAtom.reportObserved();
		this.atom.reportObserved();
		this.source.forEach((value, key) => {
			if (this.isMap) {
				callbackFn.call(thisArg, this.get(key) as V, key, this.proxy);
				return;
			}

			const wrapped = this.wrapSetValue(key) as unknown as V;
			callbackFn.call(thisArg, wrapped, wrapped as unknown as K, this.proxy);
		});
	}

	get size(): number {
		this.keysAtom.reportObserved();
		this.atom.reportObserved();
		return this.source.size;
	}

	add(value: K): this {
		const target = getSource(value);
		// Only promote to observable, never downgrade ("observable wins" semantic)
		if (typeof value === "object" && value !== null && isObservable(value)) {
			this.trackExplicitObservable(target);
		}

		if (!this.hasEntry(value)) {
			(this.source as Set<K>).add(target);
			if (debugEnabled)
				debugWrite(this.source, target, "add", undefined, value);
			this.onCollectionChange(target);
		}

		return this;
	}

	delete(value: K): boolean {
		const existingKey = this.getExistingKey(value);
		if (existingKey === KEY_NOT_FOUND) return false;

		const before = debugEnabled
			? this.isMap
				? (this.source as Map<K, V>).get(existingKey)
				: existingKey
			: undefined;
		if (
			value === null ||
			(typeof value !== "object" && typeof value !== "function")
		) {
			this.untrackExplicitObservable(value);
			this.source.delete(value);
			if (debugEnabled)
				debugWrite(this.source, value, "delete", before, undefined);
			this.onCollectionChange(value);
			return true;
		}

		const target = getSource(value);
		this.untrackExplicitObservable(target);
		this.untrackExplicitObservable(value);
		const proxy = this.getProxyVariant(value);
		if (proxy !== undefined) this.untrackExplicitObservable(proxy);

		// Delete the actually-stored identity. Also attempt best-effort cleanup of
		// alternate identities to avoid stale duplicates if they exist.
		this.source.delete(existingKey);
		this.source.delete(target);
		this.source.delete(value);
		if (proxy !== undefined) this.source.delete(proxy);

		if (debugEnabled)
			debugWrite(this.source, target, "delete", before, undefined);
		this.onCollectionChange(target as K);
		return true;
	}

	private wrapSetValue(value: K): K {
		if (
			typeof value === "object" &&
			value !== null &&
			this.hasExplicitObservable(value) &&
			!Object.isFrozen(value)
		) {
			const existingAdm = getAdministration(value as unknown as object);
			if (existingAdm) return existingAdm.proxy as unknown as K;
		}
		return value;
	}

	has(value: K): boolean {
		this.atom.reportObserved();
		// Lazy computeds track dependencies even without live subscribers. NodeMap
		// bounds inactive entries and invalidates their dependencies before eviction.
		if (
			value === null ||
			(typeof value !== "object" && typeof value !== "function")
		) {
			this.hasMap.reportObserved(value);
			return this.source.has(value);
		}
		const target = getSource(value);
		this.hasMap.reportObserved(target);

		return this.hasEntry(value);
	}

	entries(): IterableIterator<[K, V]> {
		this.keysAtom.reportObserved();
		this.atom.reportObserved();

		const self = this;
		const iterator = this.source.entries();
		return {
			[Symbol.iterator]: function (): IterableIterator<[K, V]> {
				return this;
			},
			next(): IteratorResult<[K, V]> {
				const { done, value } = iterator.next();
				if (done) return { done: true, value: undefined };

				const [key, val] = value;
				return {
					done: false,
					value: [
						self.isMap ? key : self.wrapSetValue(key),
						self.isMap ? self.get(key) : self.wrapSetValue(val as unknown as K),
					] as [K, V],
				};
			},
		};
	}

	keys(): IterableIterator<K> {
		this.keysAtom.reportObserved();
		this.atom.reportObserved();

		const self = this;
		const iterator = this.source.keys();
		return {
			[Symbol.iterator]: function (): IterableIterator<K> {
				return this;
			},
			next(): IteratorResult<K> {
				const { done, value } = iterator.next();
				if (done) return { done: true, value: undefined };

				return {
					done: false,
					value: self.isMap ? value : self.wrapSetValue(value),
				};
			},
		};
	}

	get(key: K): V | undefined {
		const sourceMap = this.source as Map<K, V>;

		if (
			key === null ||
			(typeof key !== "object" && typeof key !== "function")
		) {
			this.atom.reportObserved();
			this.hasMap.reportObserved(key);
			const value = sourceMap.get(key);
			if (value === undefined && !sourceMap.has(key)) return undefined;
			this.valuesMap.reportObserved(key, value);
			if (
				typeof value === "object" &&
				value !== null &&
				this.hasExplicitObservable(key) &&
				!Object.isFrozen(value)
			) {
				const existingAdm = getAdministration(value);
				if (existingAdm) return existingAdm.proxy as V;
			}
			return value;
		}

		const targetKey = getSource(key);
		// Important: `get()` must react to key presence changes (add/delete) even when
		// the key is currently missing. We do this by depending on `has(...)` which
		// reports per-key observations via `hasMap`.
		const existingKey = this.getExistingKey(key);
		this.atom.reportObserved();
		this.hasMap.reportObserved(targetKey);
		if (existingKey === KEY_NOT_FOUND) return undefined;

		const value = sourceMap.get(existingKey as K);

		this.valuesMap.reportObserved(targetKey, value);
		if (key !== targetKey) {
			this.valuesMap.reportObserved(key, value);
		}
		const proxyKey = this.getProxyVariant(key);
		if (
			proxyKey !== undefined &&
			proxyKey !== (key as any) &&
			proxyKey !== (targetKey as any)
		) {
			this.valuesMap.reportObserved(proxyKey, value);
		}
		// Only return proxy if this key was explicitly assigned an observable
		if (
			typeof value === "object" &&
			value !== null &&
			(this.hasExplicitObservable(targetKey) ||
				this.hasExplicitObservable(key) ||
				(proxyKey !== undefined && this.hasExplicitObservable(proxyKey))) &&
			!Object.isFrozen(value)
		) {
			const existingAdm = getAdministration(value);
			if (existingAdm) return existingAdm.proxy as V;
		}
		return value;
	}

	set(key: K, value: V): this {
		const sourceMap = this.source as Map<K, V>;

		if (
			key === null ||
			(typeof key !== "object" && typeof key !== "function")
		) {
			const isObjVal = typeof value === "object" && value !== null;
			const targetValue = isObjVal ? getSource(value) : value;

			if (isObjVal && isObservable(value)) {
				this.trackExplicitObservable(key);
			} else if (this.strongTracking) {
				this.strongTracking.delete(key);
			}

			const oldValue = sourceMap.get(key);
			const hasKey = oldValue !== undefined || sourceMap.has(key);
			const changed =
				!hasKey ||
				(typeof oldValue === "object" &&
				oldValue !== null &&
				isObservable(oldValue)
					? oldValue !== value
					: oldValue !== targetValue);

			if (changed) {
				sourceMap.set(key, targetValue);
				if (debugEnabled) debugWrite(this.source, key, "set", oldValue, value);
				if (!hasKey || this.hasForceObserved()) {
					if (
						this.hasForceObserved() ||
						this._valuesMap ||
						this._hasMap ||
						this._keysAtom
					) {
						batch(() => {
							this.flushChange();
							this._valuesMap?.reportChanged(key, value);
							if (!hasKey) {
								this._hasMap?.reportChanged(key);
								this._keysAtom?.reportChanged();
							}
						});
					}
				} else {
					this._valuesMap?.reportChanged(key, value);
				}
			}

			return this;
		}

		const targetKey = getSource(key);
		const targetValue = getSource(value);

		// Track if an observable was explicitly assigned to this key
		if (typeof value === "object" && value !== null && isObservable(value)) {
			this.trackExplicitObservable(targetKey);
		} else {
			this.untrackExplicitObservable(targetKey);
			this.untrackExplicitObservable(key);
		}

		const existingKey = this.getExistingKey(key);
		const hasKey = existingKey !== KEY_NOT_FOUND;
		const oldValue: V | undefined = hasKey
			? sourceMap.get(existingKey as K)
			: undefined;

		if (
			!hasKey ||
			(typeof oldValue === "object" &&
			oldValue !== null &&
			isObservable(oldValue)
				? oldValue !== value
				: oldValue !== targetValue)
		) {
			batch(() => {
				this.flushChange();
				// Preserve existing identity if present (raw vs proxy), otherwise store raw.
				if (existingKey !== KEY_NOT_FOUND) {
					sourceMap.set(existingKey as K, targetValue);
				} else {
					sourceMap.set(targetKey as K, targetValue);
				}
				if (debugEnabled)
					debugWrite(this.source, targetKey, "set", oldValue, value);
				this._valuesMap?.reportChanged(targetKey, value);
				if (key !== targetKey) {
					this._valuesMap?.reportChanged(key, value);
				}
				const proxyKey = this.getProxyVariant(key);
				if (
					proxyKey !== undefined &&
					proxyKey !== (key as any) &&
					proxyKey !== (targetKey as any)
				) {
					this._valuesMap?.reportChanged(proxyKey, value);
				}
				if (!hasKey) {
					this._hasMap?.reportChanged(targetKey);
					this._keysAtom?.reportChanged();
				}
			});
		}

		return this;
	}

	values(): IterableIterator<V> {
		this.keysAtom.reportObserved();
		this.atom.reportObserved();

		if (!this.isMap) {
			return this.keys() as unknown as IterableIterator<V>;
		}

		const entries = this.entries();
		return {
			[Symbol.iterator]: function (): IterableIterator<V> {
				return this;
			},
			next(): IteratorResult<V> {
				const { done, value } = entries.next();
				if (done) return { done: true, value: undefined };
				return {
					done: false,
					value: value[1] as V,
				};
			},
		};
	}

	[Symbol.iterator](): IterableIterator<[K, V] | V> {
		return this.isMap ? this.entries() : this.values();
	}

	[Symbol.toStringTag]: string = "Set";
}

export class WeakCollectionAdministration<
	K extends object,
	V = K,
> extends CollectionAdministration<K, V> {
	static proxyTraps: ProxyHandler<WeakSet<any> | WeakMap<any, any>> = {
		get(target, name) {
			const method = CollectionAdministration.methods[name];
			if (method !== undefined && isValidWeakMethod(name)) {
				return method;
			}
			return (target as any)[name];
		},
	};
}

function isValidWeakMethod(name: PropertyKey) {
	const n = name as string;
	return (
		n === "get" || n === "set" || n === "add" || n === "has" || n === "delete"
	);
}

function createGenericMethod(name: PropertyKey) {
	return function (this: any): unknown {
		const adm = getAdministration(this) as any;
		const method = adm.source[name];
		if (typeof method !== "function") return method;

		if (
			["union", "intersection", "difference", "symmetricDifference"].includes(
				name as string
			)
		) {
			const other = arguments[0];

			// Return a plain Set whose iterations yield observed values
			const result = new Set();

			if (name === "union") {
				for (const item of this) result.add(item);
				for (const item of other) result.add(item);
			} else if (name === "intersection") {
				for (const item of this) {
					if (other.has(item)) result.add(item);
				}
			} else if (name === "difference") {
				for (const item of this) {
					if (!other.has(item)) result.add(item);
				}
			} else if (name === "symmetricDifference") {
				for (const item of this) {
					if (!other.has(item)) result.add(item);
				}
				for (const item of other) {
					if (!this.has(item)) result.add(item);
				}
			}

			return result;
		}

		// Generic instrumentation for other methods (isSubsetOf, etc).
		adm.keysAtom.reportObserved();
		adm.atom.reportObserved();

		// Branding safety: call on source.
		const args = new Array(arguments.length);
		for (let i = 0; i < arguments.length; i++) {
			const arg = arguments[i];
			args[i] = getSource(arg);
			if (isObservable(arg)) {
				reportObserved(arg);
			}
		}

		const result = method.apply(adm.source, args);

		if (result === adm.source) return adm.proxy;

		return result;
	};
}
