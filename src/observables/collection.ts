import { createAtom, batch } from "./preact";
import type { AtomNode } from "./preact";
import {
	getObservable,
	getSource,
	getAdministration,
	isObservable,
} from "./internal/lookup";
import { Administration } from "./internal/Administration";
import { AtomMap, SignalMap } from "./internal/NodeMap";
import { resolveNode } from "./internal/utils";

type Collection<K, V> = Set<K> | Map<K, V>;

export class CollectionAdministration<K, V = K> extends Administration<
	Collection<K, V>
> {
	isMap: boolean;
	hasMap: AtomMap<K>;
	valuesMap: SignalMap<K>;
	keysAtom: AtomNode;

	static proxyTraps: ProxyHandler<Set<unknown> | Map<unknown, unknown>> = {
		get(target, name) {
			const adm = getAdministration(target);
			if (name === "size" && "size" in adm.source) {
				return adm.size;
			}

			const val = adm.source[name as keyof typeof adm.source];
			const collectionMethods = (
				adm.constructor as typeof CollectionAdministration
			).methods;

			if (collectionMethods.hasOwnProperty(name) && typeof val === "function") {
				return collectionMethods[name as keyof typeof collectionMethods];
			}

			return val;
		},
	};

	static methods = {
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
	};

	constructor(source: Collection<K, V>) {
		super(source);
		this.hasMap = new AtomMap(this.atom);
		this.valuesMap = new SignalMap();
		this.keysAtom = createAtom();
		this.isMap =
			typeof (source as Map<K, V>).set === "function" &&
			typeof (source as Map<K, V>).get === "function";
	}

	private hasEntry(key: K): boolean {
		return this.source.has(getSource(key)) || this.source.has(key);
	}

	private onCollectionChange(key: K): void {
		batch(() => {
			this.keysAtom.reportChanged();
			this.hasMap.reportChanged(key);
			this.flushChange();
		});
	}

	protected reportObserveDeep(): void {
		this.source.forEach?.((value) => {
			if (value && typeof value === "object") {
				getAdministration(getObservable(value))?.reportObserved();
			}
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
			const observed = getObservable(this.isMap ? key : value);
			callbackFn.call(
				thisArg,
				(this.isMap ? this.get(key) : observed) as V,
				observed as K,
				this.proxy
			);
		});
	}

	get size(): number {
		this.keysAtom.reportObserved();
		this.atom.reportObserved();
		return this.source.size;
	}

	add(value: K): this {
		if (!this.hasEntry(value)) {
			const target = getSource(value);
			(this.source as Set<K>).add(target);
			this.onCollectionChange(target);
		}

		return this;
	}

	delete(value: K): boolean {
		if (this.hasEntry(value)) {
			const target = getSource(value);
			this.source.delete(target);
			this.source.delete(value);
			this.onCollectionChange(target);

			return true;
		}
		return false;
	}

	has(value: K): boolean {
		this.atom.reportObserved();
		// TODO: remove the true and fix the test
		if (this.atom.observing || true) {
			const target = getSource(value);
			this.hasMap.reportObserved(target);
		}

		return this.hasEntry(value);
	}

	entries(): IterableIterator<[K, V]> {
		const self = this;
		const keys = this.keys();
		return {
			[Symbol.iterator]: function (): IterableIterator<[K, V]> {
				return this;
			},
			next(): IteratorResult<[K, V]> {
				const { done, value } = keys.next();
				return {
					done,
					value: done
						? (undefined as any)
						: ([value, self.isMap ? self.get(value)! : value] as [K, V]),
				};
			},
		};
	}

	keys(): IterableIterator<K> {
		this.keysAtom.reportObserved();
		this.atom.reportObserved();

		let nextIndex = 0;
		const observableKeys = Array.from(this.source.keys()).map((o) =>
			getObservable(o)
		);
		return {
			[Symbol.iterator]: function (): IterableIterator<K> {
				return this;
			},
			next(): IteratorResult<K> {
				return nextIndex < observableKeys.length
					? {
							value: observableKeys[nextIndex++],
							done: false,
					  }
					: { done: true, value: undefined };
			},
		};
	}

	get(key: K): V | undefined {
		const targetKey = getSource(key);
		const sourceMap = this.source as Map<K, V>;

		const has = this.has(key);
		const value = sourceMap.get(targetKey) ?? sourceMap.get(key);

		if (has) {
			this.valuesMap!.reportObserved(key, value);
			return getObservable(value);
		}

		return undefined;
	}

	set(key: K, value: V): this {
		const targetKey = getSource(key);
		const targetValue = getSource(value);
		const sourceMap = this.source as Map<K, V>;

		const hasKey = this.hasEntry(key);
		const oldValue: V | undefined =
			sourceMap.get(targetKey) ?? sourceMap.get(key);

		if (
			!hasKey || isObservable(oldValue)
				? oldValue !== value
				: oldValue !== targetValue
		) {
			batch(() => {
				this.flushChange();
				if (sourceMap.has(key)) {
					sourceMap.set(key, targetValue);
				} else {
					sourceMap.set(targetKey, targetValue);
				}
				this.valuesMap!.reportChanged(key, value);
				if (!hasKey) {
					this.hasMap.reportChanged(targetKey);
					this.keysAtom.reportChanged();
				}
			});
		}

		return this;
	}

	values(): IterableIterator<V> {
		const self = this;
		const keys = this.keys();

		if (!this.isMap) {
			return keys as unknown as IterableIterator<V>;
		}

		return {
			[Symbol.iterator]: function (): IterableIterator<V> {
				return this;
			},
			next(): IteratorResult<V> {
				const { done, value } = keys.next();
				return {
					done,
					value: done ? (undefined as any) : self.get(value),
				};
			},
		};
	}

	[Symbol.iterator](): IterableIterator<[K, V] | V> {
		return this.isMap ? this.entries() : this.values();
	}

	[Symbol.toStringTag]: string = "Set";
}

function createMethod(method: PropertyKey) {
	return function (this: any): unknown {
		const adm = getAdministration(this) as any;
		return adm[method].apply(adm, arguments);
	};
}
