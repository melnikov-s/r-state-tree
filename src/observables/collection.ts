import { createAtom, batch, reportObserved } from "./preact";
import type { AtomNode } from "./preact";
import { getSource, getAdministration, isObservable } from "./internal/lookup";
import { Administration } from "./internal/Administration";
import { AtomMap, SignalMap } from "./internal/NodeMap";
import { resolveNode, isNonPrimitive } from "./internal/utils";

type Collection<K, V> = Set<K> | Map<K, V>;

export class CollectionAdministration<K, V = K> extends Administration<
	Collection<K, V>
> {
	isMap: boolean;
	hasMap: AtomMap<K>;
	valuesMap: SignalMap<K>;
	keysAtom: AtomNode;
	private isWeak: boolean;
	private strongTracking: Set<K> | null = null;
	private weakTracking: WeakSet<object> | null = null;

	static proxyTraps: ProxyHandler<Set<unknown> | Map<unknown, unknown>> = {
		get(target, name) {
			const adm = getAdministration(target);
			if (name === "size" && !adm.isWeak && "size" in adm.source) {
				return adm.size;
			}

			const val = adm.source[name as keyof typeof adm.source];
			const collectionMethods = (
				adm.constructor as typeof CollectionAdministration
			).methods;

			if (collectionMethods.hasOwnProperty(name)) {
				// Weak collections only have a subset of methods
				if (adm.isWeak && !isValidWeakMethod(name)) {
					return val;
				}
				return collectionMethods[name];
			}

			if (typeof val === "function") {
				return val;
			}

			return val;
		},
	};

	static methods: Record<PropertyKey, Function> = {
		clear: createMethod("clear"),
		forEach: createMethod("forEach"),
		has: createMethod("has"),
		add: createMethod("add"),
		set: createMethod("set"),
		get: createMethod("get"),
		delete: createMethod("delete"),
		entries: createMethod("entries"),
		keys: createMethod("keys"),
		values: createMethod("values"),
		[Symbol.iterator]: createMethod(Symbol.iterator),

		// New ES methods
		union: createGenericMethod("union"),
		intersection: createGenericMethod("intersection"),
		difference: createGenericMethod("difference"),
		symmetricDifference: createGenericMethod("symmetricDifference"),
		isSubsetOf: createGenericMethod("isSubsetOf"),
		isSupersetOf: createGenericMethod("isSupersetOf"),
		isDisjointFrom: createGenericMethod("isDisjointFrom"),
	};

	constructor(source: Collection<K, V>) {
		super(source);
		this.hasMap = new AtomMap(this.atom);
		this.valuesMap = new SignalMap(this.atom);
		this.keysAtom = createAtom();
		this.isMap =
			typeof (source as Map<K, V>).set === "function" &&
			typeof (source as Map<K, V>).get === "function";
		this.isWeak = source instanceof WeakMap || source instanceof WeakSet;

		if (this.isWeak) {
			this.weakTracking = new WeakSet<object>();
		} else {
			this.strongTracking = new Set<K>();
		}
	}

	private trackExplicitObservable(key: K): void {
		if (this.isWeak) {
			if (isNonPrimitive(key)) {
				this.weakTracking!.add(key as any);
			}
		} else {
			this.strongTracking!.add(key);
		}
	}

	private untrackExplicitObservable(key: K): void {
		if (this.isWeak) {
			if (isNonPrimitive(key)) {
				this.weakTracking!.delete(key as any);
			}
		} else {
			this.strongTracking!.delete(key);
		}
	}

	private hasExplicitObservable(key: K): boolean {
		if (this.isWeak) {
			return isNonPrimitive(key) && this.weakTracking!.has(key as any);
		}
		return this.strongTracking!.has(key);
	}

	private getProxyVariant(key: K): K | undefined {
		if (!isNonPrimitive(key)) return undefined;
		const adm = getAdministration(key as any) as any;
		if (adm && adm.proxy && adm.proxy !== key) {
			return adm.proxy as K;
		}
		return undefined;
	}

	private getExistingKey(key: K): K | undefined {
		const target = getSource(key) as K;
		if (this.source.has(target)) return target;
		if (this.source.has(key)) return key;

		const proxy = this.getProxyVariant(key);
		if (proxy !== undefined && this.source.has(proxy)) return proxy;

		return undefined;
	}

	private hasEntry(key: K): boolean {
		return this.getExistingKey(key) !== undefined;
	}

	private onCollectionChange(key: K): void {
		batch(() => {
			this.keysAtom.reportChanged();
			this.hasMap.reportChanged(key);
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
		batch(() => {
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
		if (isObservable(value)) {
			this.trackExplicitObservable(target);
		}

		if (!this.hasEntry(value)) {
			(this.source as Set<K>).add(target);
			this.onCollectionChange(target);
		}

		return this;
	}

	delete(value: K): boolean {
		const existingKey = this.getExistingKey(value);
		if (existingKey === undefined) return false;

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

		this.onCollectionChange(target as K);
		return true;
	}

	private wrapSetValue(value: K): K {
		if (this.hasExplicitObservable(value)) {
			if (value && typeof value === "object" && !Object.isFrozen(value)) {
				const existingAdm = getAdministration(value as unknown as object);
				if (existingAdm) return existingAdm.proxy as unknown as K;
			}
		}
		return value;
	}

	has(value: K): boolean {
		this.atom.reportObserved();
		// Always do per-key tracking. We need this for computed signals that read from
		// collections outside of effects - they still track dependencies for caching,
		// even though `atom.observing` is false. Memory is managed by AtomMap's cleanup
		// mechanism which clears per-key atoms when the collection becomes unobserved.
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
		const targetKey = getSource(key);
		const sourceMap = this.source as Map<K, V>;

		// Important: `get()` must react to key presence changes (add/delete) even when
		// the key is currently missing. We do this by depending on `has(...)` which
		// reports per-key observations via `hasMap`.
		const has = this.has(key);
		if (!has) return undefined;

		const existingKey = this.getExistingKey(key)!;
		const value = sourceMap.get(existingKey as K);

		this.valuesMap!.reportObserved(targetKey, value);
		if (key !== targetKey) {
			this.valuesMap!.reportObserved(key, value);
		}
		const proxyKey = this.getProxyVariant(key);
		if (
			proxyKey !== undefined &&
			proxyKey !== (key as any) &&
			proxyKey !== (targetKey as any)
		) {
			this.valuesMap!.reportObserved(proxyKey, value);
		}
		// Only return proxy if this key was explicitly assigned an observable
		if (
			this.hasExplicitObservable(targetKey) ||
			this.hasExplicitObservable(key) ||
			(proxyKey !== undefined && this.hasExplicitObservable(proxyKey))
		) {
			if (value && typeof value === "object" && !Object.isFrozen(value)) {
				const existingAdm = getAdministration(value);
				if (existingAdm) return existingAdm.proxy as V;
			}
		}
		return value;
	}

	set(key: K, value: V): this {
		const targetKey = getSource(key);
		const targetValue = getSource(value);
		const sourceMap = this.source as Map<K, V>;

		// Track if an observable was explicitly assigned to this key
		if (isObservable(value)) {
			this.trackExplicitObservable(targetKey);
		} else {
			this.untrackExplicitObservable(targetKey);
			this.untrackExplicitObservable(key);
		}

		const existingKey = this.getExistingKey(key);
		const hasKey = existingKey !== undefined;
		const oldValue: V | undefined = hasKey
			? sourceMap.get(existingKey as K)
			: undefined;

		if (
			!hasKey ||
			(isObservable(oldValue) ? oldValue !== value : oldValue !== targetValue)
		) {
			batch(() => {
				this.flushChange();
				// Preserve existing identity if present (raw vs proxy), otherwise store raw.
				if (existingKey !== undefined) {
					sourceMap.set(existingKey as K, targetValue);
				} else {
					sourceMap.set(targetKey as K, targetValue);
				}
				this.valuesMap!.reportChanged(targetKey, value);
				if (key !== targetKey) {
					this.valuesMap!.reportChanged(key, value);
				}
				const proxyKey = this.getProxyVariant(key);
				if (
					proxyKey !== undefined &&
					proxyKey !== (key as any) &&
					proxyKey !== (targetKey as any)
				) {
					this.valuesMap!.reportChanged(proxyKey, value);
				}
				if (!hasKey) {
					this.hasMap.reportChanged(targetKey);
					this.keysAtom.reportChanged();
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

		// For Map, we use the values iterator but need to wrap them
		// Wait, if we use the native values iterator, we don't have the keys easily
		// for self.get(key). But Map.prototype.values() returns the values.
		// Native Map entries() gives [key, value].
		// Let's use entries iterator to be safe and consistent with self.get(key)
		// which handles reactivity for the value.
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

function createMethod(method: PropertyKey) {
	return function (this: any): unknown {
		const adm = getAdministration(this) as any;
		const result = adm[method].apply(adm, arguments);
		if (method === "add" || method === "set") {
			return this;
		}
		return result;
	};
}
