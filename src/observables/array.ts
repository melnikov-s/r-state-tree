import { createAtom, batch } from "./preact.js";
import type { AtomNode } from "./preact.js";
import {
	getAdministration,
	getSource,
	isObservable,
} from "./internal/lookup.js";
import { Administration } from "./internal/Administration.js";
import { ArraySignalMap, type SignalMap } from "./internal/NodeMap.js";
import { resolveNode } from "./internal/utils.js";
import { debugWrite, debugEnabled } from "./internal/debug.js";

/**
 * Parse a property key as a canonical ECMAScript array index in [0, 2^32 - 2].
 * Returns -1 if not a valid array index.
 */
function parseArrayIndex(key: PropertyKey): number {
	if (typeof key !== "string") return -1;
	const len = key.length;
	if (len === 0) return -1;
	const c0 = key.charCodeAt(0) - 48;
	if (c0 < 0 || c0 > 9) return -1;
	if (len === 1) return c0;
	if (c0 === 0 || len > 10) return -1;
	if (len === 2) {
		const c1 = key.charCodeAt(1) - 48;
		return c1 >= 0 && c1 <= 9 ? c0 * 10 + c1 : -1;
	}
	let n = c0;
	for (let i = 1; i < len; i++) {
		const c = key.charCodeAt(i) - 48;
		if (c < 0 || c > 9) return -1;
		n = n * 10 + c;
	}
	return n < 4294967295 ? n : -1;
}

/** ECMAScript ToIntegerOrInfinity (unary + also rejects BigInt and Symbol). */
function toIntegerOrInfinity(value: unknown): number {
	const number = +(value as number);
	return Number.isNaN(number) ? 0 : Math.trunc(number);
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
	private _valuesMap?: ArraySignalMap;
	private _keysAtom?: AtomNode;
	/**
	 * Parent-based ownership tracking: sources assigned as observable.
	 * Unlike index-based tracking, this doesn't require updates on reorder ops.
	 */
	private observableSources?: WeakSet<object>;
	private rawSources?: WeakSet<object>;

	get valuesMap(): SignalMap<number> {
		return (this._valuesMap ??= new ArraySignalMap());
	}

	get keysAtom(): AtomNode {
		return (this._keysAtom ??= createAtom());
	}

	/** @internal Register a known-observable raw source on this array. */
	protected trackObservableSource(source: object): void {
		(this.observableSources ??= new WeakSet()).add(source);
	}

	/**
	 * Track a value being assigned to this array.
	 * Detects conflicts if same source is assigned as both observable and raw.
	 */
	private trackValue(value: unknown): void {
		if (typeof value === "object" && value !== null) {
			const source = getSource(value);
			if (isObservable(value)) {
				if (this.rawSources?.has(source)) {
					reportConflict();
				}
				(this.observableSources ??= new WeakSet()).add(source);
			} else {
				if (this.observableSources?.has(source)) {
					reportConflict();
				} else {
					(this.rawSources ??= new WeakSet()).add(source);
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

			const index = parseArrayIndex(name);
			if (index !== -1) {
				return adm.get(index);
			}

			const arrayMethods = (adm.constructor as typeof ArrayAdministration)
				.methods;

			const method = arrayMethods[name as keyof typeof arrayMethods];
			if (method !== undefined) {
				return method;
			}

			// Use Reflect.get with receiver to preserve prototype chain semantics
			return Reflect.get(adm.source, name, receiver);
		},

		set(target, name, value, receiver) {
			const adm = getAdministration(target) as ArrayAdministration<any>;

			if (name === "length") {
				return adm.setArrayLength(value);
			}
			const index = parseArrayIndex(name);
			if (index !== -1) {
				return adm.set(index, value);
			}
			return Reflect.set(adm.source, name, value, receiver);
		},

		defineProperty(target, name, descriptor) {
			const adm = getAdministration(target) as ArrayAdministration<any>;
			const before = debugEnabled
				? Object.getOwnPropertyDescriptor(adm.source, name)?.value
				: undefined;
			const result = Reflect.defineProperty(adm.source, name, descriptor);
			if (result && debugEnabled)
				debugWrite(
					adm.source,
					name,
					"define",
					before,
					"value" in descriptor ? descriptor.value : undefined
				);

			if (result) {
				// Arrays are complex because modifying length or indices affects many things.
				// We opt for a coarse notification strategy similar to array mutation methods for safety.
				batch(() => {
					adm.flushChange();

					if (name === "length") {
						adm._keysAtom?.reportChanged();
						adm.reportChanged();
					} else {
						const index = parseArrayIndex(name);
						if (index !== -1) {
							adm._keysAtom?.reportChanged();
							adm.onArrayChanged(false, index, 1);
						} else {
							// Other properties
							adm.reportChanged();
						}
					}
				});
			}
			return result;
		},

		deleteProperty(target, name) {
			const adm = getAdministration(target) as ArrayAdministration<any>;
			const index = parseArrayIndex(name);

			const had = name in adm.source;
			const before = debugEnabled
				? Object.getOwnPropertyDescriptor(adm.source, name)?.value
				: undefined;
			const result = Reflect.deleteProperty(adm.source, name);
			if (result && had && debugEnabled)
				debugWrite(adm.source, name, "delete", before, undefined);
			if (result && had && index !== -1) {
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
			const index = parseArrayIndex(name);
			if (index !== -1) {
				adm.atom.reportObserved();
				adm.valuesMap.reportObserved(index, adm.source[index]);
				return index in adm.source;
			}
			return Reflect.has(adm.source, name);
		},
	};

	static methods: Partial<{
		[
			K in keyof typeof Array.prototype as (typeof Array.prototype)[K] extends Function
				? K
				: never
		]: (typeof Array.prototype)[K];
	}> = Object.assign(Object.create(null), {
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
				if (debugEnabled)
					debugWrite(adm.source, "$items", "fill", undefined, undefined);
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
			if (debugEnabled)
				debugWrite(adm.source, "$items", "reverse", undefined, undefined);
			adm.onArrayChanged(false, 0, adm.source.length);
			return this;
		},

		sort<T>(this: T[], compareFn?: ((a: T, b: T) => number) | undefined): T[] {
			const adm = getAdministration(this);
			if (compareFn !== undefined && typeof compareFn !== "function") {
				throw new TypeError(
					"The comparison function must be a function or undefined"
				);
			}
			// Keep stored identities, but compare observed values. Leave undefined
			// entries and holes intact so native sort orders them without comparing them.
			const pairs = adm.source.map((stored, i) =>
				stored === undefined ? undefined : { value: this[i], stored }
			);

			pairs.sort((a, b) => {
				if (compareFn !== undefined) return compareFn(a!.value, b!.value);
				// Template coercion uses ToString, which (unlike String) rejects Symbols.
				const as = `${a!.value as string}`;
				const bs = `${b!.value as string}`;
				return as < bs ? -1 : as > bs ? 1 : 0;
			});

			for (let i = 0; i < pairs.length; i++) {
				if (i in pairs) {
					adm.source[i] = pairs[i]?.stored as T;
				} else if (!Reflect.deleteProperty(adm.source, i)) {
					throw new TypeError("Cannot delete array index during sort");
				}
			}

			if (debugEnabled)
				debugWrite(adm.source, "$items", "sort", undefined, undefined);
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
			if (debugEnabled)
				debugWrite(adm.source, "$items", "copyWithin", undefined, undefined);
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
	});

	constructor(source: T[] = []) {
		super(source);
	}

	getNode(key?: number): unknown {
		if (key == null) {
			return this.atom;
		}

		return resolveNode(this.valuesMap.getOrCreate(key, this.source[key]));
	}

	get(index: number): T | undefined {
		const value = this.source[index];
		this.atom.reportObserved();
		const slots = this._valuesMap?._slots;
		const entry = slots !== undefined && index < 256 ? slots[index] : undefined;
		if (entry !== undefined && entry.observing) {
			entry.reportObserved();
		} else {
			this.valuesMap.reportObserved(index, value);
		}

		if (typeof value === "object" && value !== null && this.observableSources) {
			return this._wrapValue(index, value);
		}
		return value;
	}

	private _wrapValue(index: number, value: T & object): T {
		if (!Object.isFrozen(value) && this.observableSources!.has(value)) {
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
		return value;
	}

	private _getEffectiveValue(index: number): T | undefined {
		const value = this.source[index];
		if (typeof value === "object" && value !== null && this.observableSources) {
			return this._wrapValue(index, value);
		}
		return value;
	}

	set(index: number, newValue: T): boolean {
		const values = this.source;
		const isObj = typeof newValue === "object" && newValue !== null;
		let targetValue = newValue;
		if (isObj) {
			targetValue = getSource(newValue);
			// Always track the value for observability (even if source is same)
			this.trackValue(newValue);
		}
		const oldLength = values.length;

		// Check if value changed
		if (index < oldLength && targetValue === values[index]) {
			return true;
		}

		const before = debugEnabled
			? Object.getOwnPropertyDescriptor(values, index)?.value
			: undefined;
		const result = Reflect.set(values, index, targetValue);
		if (!result) return false;

		const lengthChanged = values.length !== oldLength;

		if (debugEnabled)
			debugWrite(this.source, String(index), "set", before, newValue);

		if (!lengthChanged && !this.hasForceObserved()) {
			const node = this._valuesMap?.get(index);
			if (node) {
				node.reportChanged(isObj ? this._getEffectiveValue(index) : newValue);
			}
			return true;
		}
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

		if (debugEnabled)
			debugWrite(this.source, "length", "set", currentLength, newLength);
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
		const relativeIndex = toIntegerOrInfinity(index);
		index =
			relativeIndex < 0
				? Math.max(length + relativeIndex, 0)
				: Math.min(relativeIndex, length);
		deleteCount =
			arguments.length === 1
				? length - index
				: Math.max(
						0,
						Math.min(toIntegerOrInfinity(deleteCount), length - index)
					);

		const newLen = newItems ? newItems.length : 0;
		const newTargetItems: T[] = new Array(newLen);
		for (let i = 0; i < newLen; i++) {
			const item = newItems![i];
			if (typeof item === "object" && item !== null) {
				newTargetItems[i] = getSource(item);
				this.trackValue(item);
			} else {
				newTargetItems[i] = item;
			}
		}

		// Removed items preserve both holes and identities at removal time.
		const removedItems = new Array<T>(deleteCount);
		for (let i = 0; i < deleteCount; i++) {
			if (index + i in this.source) {
				removedItems[i] = this._getEffectiveValue(index + i) as T;
			}
		}

		this.spliceItemsIntoValues(index, deleteCount, newTargetItems);

		if (deleteCount !== 0 || newLen !== 0) {
			if (debugEnabled)
				debugWrite(
					this.source,
					"$items",
					"splice",
					removedItems.length,
					newLen
				);
			const shift = newLen - deleteCount;
			const reindexing = shift !== 0 && index + deleteCount < length;
			const count = reindexing
				? Number.POSITIVE_INFINITY
				: Math.max(deleteCount, newLen);

			this.onArrayChanged(length !== this.source.length, index, count);
		}

		return removedItems;
	}

	spliceItemsIntoValues(
		index: number,
		deleteCount: number,
		newItems: T[]
	): T[] {
		if (newItems.length === 0) {
			return this.source.splice(index, deleteCount);
		}
		return this.source.splice(index, deleteCount, ...newItems);
	}

	private reportIndexChanged(index: number): void {
		const node = this._valuesMap?.get(index);
		if (node) node.reportChanged(this._getEffectiveValue(index));
	}

	onArrayChanged(lengthChanged = false, index?: number, count?: number): void {
		if (
			!lengthChanged &&
			!this.hasForceObserved() &&
			count === 1 &&
			index !== undefined &&
			Number.isInteger(index)
		) {
			this.reportIndexChanged(index);
			return;
		}
		if (
			!lengthChanged &&
			!this.hasForceObserved() &&
			index !== undefined &&
			!this._valuesMap
		) {
			return;
		}
		batch(() => {
			if (lengthChanged) {
				this._keysAtom?.reportChanged();
			}
			if (index == null) {
				this.reportChanged();
			} else if (count === 1 && Number.isInteger(index)) {
				// An indexed write need not enumerate unrelated tracked indices.
				// Non-integer bounds (e.g. from fill) still use the range check.
				this.reportIndexChanged(index);
			} else if (count !== undefined && count > 0 && this._valuesMap) {
				// Optimization: Do NOT iterate the full range [index, index+count).
				// Instead, iterate only the *observed* atoms and check if they fall in range.
				const observedKeys = this._valuesMap.keys() as Iterable<number>;

				const end = index + count;
				for (const key of observedKeys) {
					// Check if key is in the affected range
					if (typeof key === "number" && key >= index && key < end) {
						this.reportIndexChanged(key);
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

			// Run find/filter against the observed values so the returned match identities
			// align with `this[index]`, while still returning a plain array for `filter`.
			const observedInput: unknown[] = [];
			observedInput.length = adm.source.length;

			const keys = Object.keys(adm.source);
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i];
				const idx = Number(key);
				if (!Number.isNaN(idx)) {
					observedInput[idx] = (this as any)[idx];
				}
			}

			return (Array.prototype as any)[method].call(
				observedInput,
				(_element: unknown, index: number) => {
					return callback.call(thisArg, (this as any)[index], index, this);
				}
			);
		}
	);
}
function createReduceMethod(method: string): any {
	return createMethod(method, function (this: unknown[]): unknown {
		const adm = getAdministration(this);
		adm.reportObserved();

		const observedInput: unknown[] = [];
		observedInput.length = adm.source.length;

		const keys = Object.keys(adm.source);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const idx = Number(key);
			if (!Number.isNaN(idx)) {
				observedInput[idx] = (this as any)[idx];
			}
		}

		const args = Array.from(arguments);
		const callback = args[0] as Function;
		args[0] = (acc: unknown, _element: unknown, index: number) => {
			return callback(acc, (this as any)[index], index, this);
		};

		return (Array.prototype as any)[method].apply(observedInput, args);
	});
}
