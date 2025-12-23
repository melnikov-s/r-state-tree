import { createAtom, batch } from "./preact";
import type { AtomNode } from "./preact";
import { getAdministration, getSource, isObservable } from "./internal/lookup";
import { Administration } from "./internal/Administration";
import { SignalMap } from "./internal/NodeMap";
import { resolveNode } from "./internal/utils";

/**
 * Check if a property key is a valid array index per ECMAScript spec.
 * An array index is a String-valued property key that is a canonical numeric string
 * and whose numeric value i satisfies 0 ≤ i < 2^32 - 1.
 */
function isArrayIndexKey(key: PropertyKey): boolean {
	if (typeof key === "symbol") return false;

	const keyStr = String(key);
	const num = Number(keyStr);

	// Must be a non-negative integer in range [0, 2^32 - 2]
	// AND the string must be the canonical form (String(num) === keyStr)
	return (
		Number.isInteger(num) &&
		num >= 0 &&
		num < 4294967295 && // 2^32 - 1
		String(num) === keyStr
	);
}

/**
 * Report a conflict when the same source is assigned as both observable and raw.
 * Throws in dev mode; silently proceeds in production.
 */
function reportConflict(): void {
	if (process.env.NODE_ENV !== "production") {
		throw new Error(
			"r-state-tree: Cannot assign the same object as both observable and raw source " +
				"in the same array. The value will be treated as observable."
		);
	}
}

export class ArrayAdministration<T> extends Administration<T[]> {
	valuesMap: SignalMap<number>;
	keysAtom: AtomNode;
	/**
	 * Parent-based ownership tracking: sources assigned as observable.
	 * Unlike index-based tracking, this doesn't require updates on reorder ops.
	 */
	private observableSources = new WeakSet<object>();
	private rawSources = new WeakSet<object>();

	/**
	 * Track a value being assigned to this array.
	 * Detects conflicts if same source is assigned as both observable and raw.
	 */
	private trackValue(value: unknown): void {
		if (value && typeof value === "object") {
			const source = getSource(value);
			if (isObservable(value)) {
				if (this.rawSources.has(source)) {
					reportConflict();
				}
				this.observableSources.add(source);
			} else {
				if (this.observableSources.has(source)) {
					reportConflict();
				} else {
					this.rawSources.add(source);
				}
			}
		}
	}

	static proxyTraps: ProxyHandler<Array<unknown>> = {
		get(target, name, receiver) {
			const adm = getAdministration(target);
			if (name === "length") {
				return adm.getArrayLength();
			}

			if (isArrayIndexKey(name)) {
				return adm.get(Number(name));
			}

			const arrayMethods = (adm.constructor as typeof ArrayAdministration)
				.methods;

			if (arrayMethods.hasOwnProperty(name)) {
				return arrayMethods[name as keyof typeof arrayMethods];
			}

			// Use Reflect.get with receiver to preserve prototype chain semantics
			return Reflect.get(adm.source, name, receiver);
		},

		set(target, name, value) {
			const adm = getAdministration(target) as ArrayAdministration<any>;

			if (name === "length") {
				return adm.setArrayLength(value);
			} else if (isArrayIndexKey(name)) {
				return adm.set(Number(name), value);
			} else {
				return Reflect.set(adm.source, name, value, arguments[3]);
			}
		},

		defineProperty(target, name, descriptor) {
			const adm = getAdministration(target) as ArrayAdministration<any>;
			const result = Reflect.defineProperty(adm.source, name, descriptor);

			if (result) {
				// Arrays are complex because modifying length or indices affects many things.
				// We opt for a coarse notification strategy similar to array mutation methods for safety.
				batch(() => {
					adm.flushChange();

					if (name === "length") {
						adm.keysAtom.reportChanged();
						adm.atom.reportChanged();
					} else if (isArrayIndexKey(name)) {
						const index = Number(name);
						adm.keysAtom.reportChanged();
						adm.onArrayChanged(false, index, 1);
					} else {
						// Other properties
						adm.atom.reportChanged();
					}
				});
			}
			return result;
		},

		deleteProperty(target, name) {
			const adm = getAdministration(target) as ArrayAdministration<any>;
			const isIndex = isArrayIndexKey(name);

			const had = name in adm.source;
			const result = Reflect.deleteProperty(adm.source, name);
			if (result && had && isIndex) {
				const index = Number(name);
				// Pass true for lengthChanged to trigger keysAtom (a hole was created)
				adm.onArrayChanged(true, index, 1);
			}
			return result;
		},

		ownKeys(target) {
			const adm = getAdministration(target);
			batch(() => {
				adm.keysAtom.reportObserved();
				adm.atom.reportObserved();
			});
			return Reflect.ownKeys(adm.source);
		},

		has(target, name) {
			const adm = getAdministration(target) as ArrayAdministration<any>;
			if (isArrayIndexKey(name)) {
				const index = Number(name);
				adm.atom.reportObserved();
				adm.valuesMap.reportObserved(index, adm.source[index]);
				return index in adm.source;
			}
			return Reflect.has(adm.source, name);
		},
	};

	static methods: Partial<{
		[K in keyof typeof Array.prototype as (typeof Array.prototype)[K] extends Function
			? K
			: never]: (typeof Array.prototype)[K];
	}> = {
		fill<T>(
			this: T[],
			value: T,
			start?: number | undefined,
			end?: number | undefined
		): T[] {
			const adm = getAdministration(this);

			// Track the value being assigned (parent-based ownership)
			adm.trackValue(value);
			const targetValue = getSource(value);

			adm.source.fill(targetValue, start, end);

			const length = adm.source.length;
			const from =
				start == null ? 0 : start < 0 ? Math.max(length + start, 0) : start;
			const to =
				end == null
					? length
					: end < 0
					? Math.max(length + end, 0)
					: Math.min(end, length);

			if (from < to) {
				adm.onArrayChanged(false, from, to - from);
			}

			return this;
		},

		splice<T>(
			this: T[],
			index: number,
			deleteCount?: number,
			...newItems: T[]
		): T[] {
			const adm = getAdministration(this);
			switch (arguments.length) {
				case 0:
					return [];
				case 1:
					return adm.spliceWithArray(index);
				case 2:
					return adm.spliceWithArray(index, deleteCount);
			}
			return adm.spliceWithArray(index, deleteCount, newItems);
		},

		push<T>(this: T[], ...items: T[]): number {
			const adm = getAdministration(this);
			adm.spliceWithArray(adm.source.length, 0, items);
			return adm.source.length;
		},

		pop<T>(this: T[]): T {
			return this.splice(
				Math.max(getAdministration(this).source.length - 1, 0),
				1
			)[0];
		},

		shift<T>(this: T[]): T {
			return this.splice(0, 1)[0];
		},

		unshift<T>(this: T[], ...items: T[]): number {
			const adm = getAdministration(this);
			adm.spliceWithArray(0, 0, items);
			return adm.source.length;
		},

		reverse<T>(this: T[]): T[] {
			const adm = getAdministration(this);
			// Parent-based ownership: no index tracking needed on reorder
			adm.source.reverse();
			adm.onArrayChanged(false, 0, adm.source.length);
			return this;
		},

		sort<T>(this: T[], compareFn?: ((a: T, b: T) => number) | undefined): T[] {
			const adm = getAdministration(this);
			// Parent-based ownership: no index tracking needed on reorder
			// Sort using proxy values for correct comparison behavior
			const pairs = adm.source.map((stored, i) => ({
				value: (this as any)[i] as T,
				stored,
			}));

			const comparator =
				compareFn ??
				((a: T, b: T) => {
					const as = String(a);
					const bs = String(b);
					return as < bs ? -1 : as > bs ? 1 : 0;
				});

			pairs.sort((a, b) => comparator(a.value, b.value));

			for (let i = 0; i < pairs.length; i++) {
				adm.source[i] = pairs[i].stored;
			}

			adm.onArrayChanged(false, 0, adm.source.length);
			return this;
		},
		join: createStringMethod("join"),
		toString: createStringMethod("toString"),
		toLocaleString: createStringMethod("toLocaleString"),
		indexOf: createSearchMethod("indexOf"),
		lastIndexOf: createSearchMethod("lastIndexOf"),
		includes: createSearchMethod("includes"),
		slice: createCopyMethod("slice"),
		concat: createCopyMethod("concat"),
		flat: createCopyMethod("flat"),
		copyWithin<T>(
			this: T[],
			target: number,
			start: number,
			end?: number | undefined
		): T[] {
			const adm = getAdministration(this);
			// Parent-based ownership: no index tracking needed on reorder
			adm.source.copyWithin(target, start, end);
			adm.onArrayChanged(false, 0, adm.source.length);
			return this;
		},
		every: createMapMethod("every"),
		forEach: createMapMethod("forEach"),
		map: createMapMethod("map"),
		flatMap: createMapMethod("flatMap"),
		findIndex: createMapMethod("findIndex"),
		some: createMapMethod("some"),
		filter: createFilterMethod("filter"),
		find: createFilterMethod("find"),
		reduce: createReduceMethod("reduce"),
		reduceRight: createReduceMethod("reduceRight"),
	};

	constructor(source: T[] = []) {
		super(source);
		this.valuesMap = new SignalMap(this.atom);
		this.keysAtom = createAtom();
	}

	getNode(key?: number): unknown {
		if (key == null) {
			return this.atom;
		}

		return resolveNode(this.valuesMap.getOrCreate(key, this.source[key]));
	}

	get(index: number): T | undefined {
		this.atom.reportObserved();
		this.valuesMap.reportObserved(index, this.source[index]);

		return this._getEffectiveValue(index);
	}

	private _getEffectiveValue(index: number): T | undefined {
		const value = this.source[index];
		if (value && typeof value === "object" && !Object.isFrozen(value)) {
			// Parent-based ownership: return proxy if this source was assigned as observable
			if (this.observableSources.has(value)) {
				const adm = getAdministration(value)!; // Known to exist if in observableSources
				// Check proxy invariants
				if (adm.proxy !== value) {
					const desc = Object.getOwnPropertyDescriptor(this.source, index);
					if (desc && !desc.configurable && !desc.writable) {
						if (process.env.NODE_ENV !== "production") {
							console.warn(
								`r-state-tree: cannot return an observable proxy for arr[${index}] because it is a non-configurable, non-writable data property; returning the raw value to uphold Proxy invariants.`
							);
						}
						return value;
					}
				}
				return adm.proxy as T;
			}
		}
		return value;
	}

	set(index: number, newValue: T): boolean {
		const values = this.source;
		const targetValue = getSource(newValue);
		const oldLength = values.length;

		// Always track the value for observability (even if source is same)
		// This ensures that assigning an observable version of the same source is tracked
		this.trackValue(newValue);

		// Check if value changed
		let changed = true;
		if (index < oldLength) {
			const oldValue = values[index];
			changed = targetValue !== oldValue;
		}

		if (!changed) return true;

		const result = Reflect.set(values, index, targetValue);
		if (!result) return false;

		const newLength = values.length;
		const lengthChanged = newLength !== oldLength;

		this.onArrayChanged(lengthChanged, index, 1);

		return true;
	}

	getArrayLength(): number {
		this.atom.reportObserved();
		this.keysAtom.reportObserved();
		return this.source.length;
	}

	setArrayLength(input: unknown): boolean {
		const num = Number(input);
		const coerced = num >>> 0;

		if (coerced !== num) {
			throw new RangeError("Invalid array length");
		}

		const newLength = coerced;
		const currentLength = this.source.length;
		if (newLength === currentLength) return true;

		const result = Reflect.set(this.source, "length", newLength);
		if (!result) return false;

		// Parent-based ownership: no index cleanup needed on truncation
		if (newLength < currentLength) {
			this.onArrayChanged(true, newLength, currentLength - newLength);
		} else {
			this.onArrayChanged(true, currentLength, newLength - currentLength);
		}

		return true;
	}

	spliceWithArray(index: number, deleteCount?: number, newItems?: T[]): T[] {
		const length = this.source.length;
		const newTargetItems: T[] = [];

		if (newItems) {
			for (let i = 0; i < newItems.length; i++) {
				newTargetItems[i] = getSource(newItems[i]);
				// Track the value (parent-based ownership)
				this.trackValue(newItems[i]);
			}
		}

		if (index === undefined) index = 0;
		else if (index > length) index = length;
		else if (index < 0) index = Math.max(0, length + index);

		if (arguments.length === 1) deleteCount = length - index;
		else if (deleteCount === undefined || deleteCount === null) deleteCount = 0;
		else deleteCount = Math.max(0, Math.min(deleteCount, length - index));

		// JS semantics: removed items must match identities at removal time
		const removedItems: T[] = [];
		for (let i = index; i < index + deleteCount; i++) {
			removedItems.push(this._getEffectiveValue(i) as T);
		}

		this.spliceItemsIntoValues(index, deleteCount, newTargetItems);

		if (deleteCount !== 0 || newTargetItems.length !== 0) {
			const shift = (newItems?.length ?? 0) - deleteCount;
			const reindexing = shift !== 0 && index + deleteCount < length;
			const count = reindexing
				? Number.POSITIVE_INFINITY
				: Math.max(deleteCount ?? 0, newItems?.length ?? 0);

			this.onArrayChanged(length !== this.source.length, index, count);
		}

		return removedItems;
	}

	spliceItemsIntoValues(
		index: number,
		deleteCount: number,
		newItems: T[]
	): T[] {
		return this.source.splice.apply(
			this.source,
			([index, deleteCount] as any).concat(newItems)
		);
	}

	onArrayChanged(lengthChanged = false, index?: number, count?: number): void {
		batch(() => {
			if (lengthChanged) {
				this.keysAtom.reportChanged();
			}
			if (index == null) {
				this.atom.reportChanged();
			} else if (count !== undefined && count > 0) {
				// Optimization: Do NOT iterate the full range [index, index+count).
				// That would be O(N) where N is array length (e.g. 2^32).
				// Instead, iterate only the *observed* atoms and check if they fall in range.
				// This is O(M) where M is number of observed indices, usually small.

				// We need to cast because NodeMap.keys() returns Iterable<unknown>
				// and valuesMap keys are numbers.
				const observedKeys = this.valuesMap.keys() as Iterable<number>;

				const end = index + count;
				for (const key of observedKeys) {
					// Check if key is in the affected range
					if (typeof key === "number" && key >= index && key < end) {
						const node = this.valuesMap.get(key);
						if (node) {
							node.reportChanged(this._getEffectiveValue(key));
						}
					}
				}
			}
			this.flushChange();
		});
	}
}

function createMethod(method: string, func: Function): any {
	if (Array.prototype.hasOwnProperty(method)) {
		return func;
	}

	return undefined;
}

function createStringMethod(method: string): any {
	return createMethod(method, function (this: unknown[]): unknown {
		const adm = getAdministration(this);
		adm.reportObserved();
		const sourceArr = getSource(this);

		return (sourceArr as any)[method].apply(sourceArr, arguments);
	});
}

function createSearchMethod(method: string): any {
	return createMethod(method, function (this: unknown[]): unknown {
		const adm = getAdministration(this);

		adm.reportObserved();
		const target = arguments[0];
		const source = getSource(target);
		const sourceArr = getSource(this);
		const args = arguments.length === 1 ? [source] : [source, arguments[1]];

		const result = (adm.source as any)[method].apply(sourceArr, args);

		// If we're searching for an observable and couldn't find its source on the source array
		// it might still exists as an observable on the source array. Look for that too
		if (
			isObservable(target) && typeof result === "boolean"
				? !result
				: result === -1
		) {
			const args = arguments.length === 1 ? [target] : [target, arguments[1]];
			return (adm.source as any)[method].apply(sourceArr, args);
		}

		return result;
	});
}

function createCopyMethod(method: string): any {
	return createMethod(method, function (this: unknown[]): unknown {
		const adm = getAdministration(this);
		adm.reportObserved();

		// Create a sparse array with the same length, then only populate existing indices.
		// This is O(k) where k is number of elements, NOT O(length).
		// We use Object.keys to iterate only over indices that actually exist in the source.
		const observedInput: unknown[] = [];
		observedInput.length = adm.source.length;

		// Object.keys for arrays returns only the indices that have values (not holes)
		const keys = Object.keys(adm.source);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const idx = Number(key);
			// Only process numeric indices
			if (!Number.isNaN(idx)) {
				observedInput[idx] = (this as any)[idx];
			}
		}

		// Handle concat carefully: if any argument is an observable array, use its observed values too
		const args = Array.from(arguments);
		if (method === "concat") {
			for (let i = 0; i < args.length; i++) {
				const arg = args[i];
				if (Array.isArray(arg) && isObservable(arg)) {
					const argAdm = getAdministration(arg);
					const argObserved: unknown[] = [];
					argObserved.length = argAdm.source.length;
					const argKeys = Object.keys(argAdm.source);
					for (let j = 0; j < argKeys.length; j++) {
						const argKey = argKeys[j];
						const argIdx = Number(argKey);
						if (!Number.isNaN(argIdx)) {
							argObserved[argIdx] = (arg as any)[argIdx];
						}
					}
					args[i] = argObserved;
				}
			}
		}

		// Result of the operation using observed values.
		// Return a plain array (raw container) containing the same identities as observed reads.
		return (Array.prototype as any)[method].apply(observedInput, args);
	});
}
function createMapMethod(method: string): any {
	return createMethod(
		method,
		function (this: unknown[], callback: Function, thisArg: unknown): unknown {
			const adm = getAdministration(this);
			adm.reportObserved();

			// Iteration must match reads:
			// - if an index is explicitly owned (assigned an observable), read returns the proxy
			// - otherwise, read returns the raw value
			// Return a plain array (raw container) containing the same identities as observed reads/iteration.
			return (adm.source as any)[method]((_element: unknown, index: number) => {
				return callback.call(thisArg, (this as any)[index], index, this);
			});
		}
	);
}
function createFilterMethod(method: string): any {
	return createMethod(
		method,
		function (this: unknown[], callback: Function, thisArg: unknown): unknown {
			const adm = getAdministration(this);
			adm.reportObserved();

			// Return a plain array (raw container) containing the same identities as observed reads/iteration.
			return (adm.source as any)[method]((_element: unknown, index: number) => {
				return callback.call(thisArg, (this as any)[index], index, this);
			});
		}
	);
}
function createReduceMethod(method: string): any {
	return createMethod(method, function (this: unknown[]): unknown {
		const adm = getAdministration(this);
		adm.reportObserved();

		// Pass raw values to callback - no deep wrapping
		return (adm.source as any)[method].apply(adm.source, arguments);
	});
}
