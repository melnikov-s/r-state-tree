import {
	computed as preactComputed,
	signal as preactSignal,
	Signal,
	batch,
	effect,
	untracked,
} from "@preact/signals-core";
import type { ReadonlySignal } from "@preact/signals-core";

import { computedType } from "../types.js";
import { retainedChildRead } from "./internal/retainedRead.js";

import { ObjectAdministration } from "./object.js";
import { getPropertyDescriptor } from "./internal/utils.js";
import {
	getAdministration,
	getInternalNode,
	getObservable,
	getSource,
} from "./internal/lookup.js";

export { isObservable } from "./index.js";

export class PreactObjectAdministration<
	T extends object,
> extends ObjectAdministration<T> {}

export interface AtomNode {
	reportObserved(): void;
	reportChanged(val?: unknown): void;
	node?: Signal<unknown>;
}

export type ObservedAtomNode = AtomNode & {
	observing: boolean;
	onObservedStateChange(callback: (observing: boolean) => void): () => void;
};

export interface SignalNode<T> {
	reportObserved(): void;
	reportChanged(val: T): void;
	node?: Signal<T>;
	get: () => T;
	set: (value: T) => T;
}

export interface ComputedNode<T> {
	get(): T;
	node?: ReadonlySignal<T>;
}

export interface ListenerNode {
	dispose: () => void;
	track: <T>(trackFn: () => T) => T;
	isDisposed: boolean;
}

export function createObservedAtom() {
	let value = 0;
	const callbacks = new Set<(observing: boolean) => void>();
	let observing = false;

	const signal = new Signal(value, {
		watched() {
			callbacks.forEach((callback) => callback(true));
			observing = true;
		},
		unwatched() {
			callbacks.forEach((callback) => callback(false));
			observing = false;
		},
	});

	return {
		node: signal,
		reportObserved() {
			return signal.value;
		},
		reportChanged() {
			return (signal.value = ++value);
		},
		get observing() {
			return observing;
		},
		onObservedStateChange(callback: (observing: boolean) => void) {
			callbacks.add(callback);
			return () => {
				callbacks.delete(callback);
			};
		},
	};
}

export function createSignal<T>(initialValue: T): SignalNode<T> {
	const s = preactSignal(initialValue);

	return {
		node: s,
		reportChanged(value) {
			return (s.value = value);
		},
		reportObserved() {
			return s.value;
		},
		get: () => {
			return s.value as T;
		},
		set: (value) => {
			return (s.value = value as T);
		},
	};
}

export function createAtom(): AtomNode {
	let value = 0;
	const s = preactSignal(value);

	return {
		node: s,
		reportChanged() {
			return (s.value = ++value);
		},
		reportObserved() {
			return s.value;
		},
	};
}

export { effect, batch, untracked, Signal };
export type { ReadonlySignal };

export function reaction<T>(
	fn: () => T,
	callback: (value: T, previousValue: T) => void
): () => void {
	let initialized = false;
	let currentValue: T;

	return effect(() => {
		const nextValue = fn();

		if (!initialized) {
			initialized = true;
			currentValue = nextValue;
			return;
		}

		if (Object.is(currentValue, nextValue)) {
			return;
		}

		const previousValue = currentValue;
		currentValue = nextValue;

		untracked(() => {
			callback(nextValue, previousValue);
		});
	});
}

export type Listener = {
	dispose: () => void;
	track: <T>(trackFn: () => T) => T;
	isDisposed: boolean;
	callback(listener: Listener): void;
};

export function createListener(
	callback: (listener: Listener) => void
): Listener {
	let primed = false;
	let disposeEffect: (() => void) | undefined;

	const listener: Listener = {
		dispose() {
			if (!listener.isDisposed) {
				listener.isDisposed = true;
				disposeEffect?.();
				disposeEffect = undefined;
			}
		},
		track<T>(trackFn: () => T): T {
			if (listener.isDisposed) {
				throw new Error("Cannot track using a disposed listener");
			}

			let value!: T;
			const unsub = effect(() => {
				value = trackFn();

				if (!primed) {
					primed = true;
					return;
				}

				// Let the owner compare against its reconciled value, which may
				// also have changed through a synchronous read inside a batch.
				untracked(() => {
					listener.callback(listener);
				});
			});

			disposeEffect = unsub;

			return value;
		},
		isDisposed: false,
		callback,
	};

	return listener;
}

function internalCreateComputed<T>(fn: () => T) {
	const version = preactSignal(0);
	const c = preactComputed(
		() => {
			version.value;
			return fn();
		},
		{
			unwatched() {
				// Mark as dirty when unobserved. This is silent because there are no subscribers.
				version.value++;
			},
		}
	);

	// Keep the native signal object and ordinary Preact tracking/cache behavior.
	// peek(), coercions and subscribe() also read through this value accessor.
	const cachedValue = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(c),
		"value"
	)!.get!;
	let readingRetained = false;
	Object.defineProperty(c, "value", {
		get() {
			if (!retainedChildRead) return cachedValue.call(this);
			// Don't cache restricted results/errors on this RStateTree computed.
			if (readingRetained) throw new Error("Cycle detected");
			readingRetained = true;
			try {
				return fn();
			} finally {
				readingRetained = false;
			}
		},
	});

	return c;
}

export function createComputed<T>(
	fn: () => T,
	context: unknown = null
): ComputedNode<T> {
	const bound = context ? fn.bind(context) : fn;
	const c = internalCreateComputed(bound);

	return {
		node: c,
		get() {
			return c.value;
		},
	};
}

export type PreactObservable<T> = T;

export function observable<T>(obj: T): PreactObservable<T> {
	return getObservable(obj) as PreactObservable<T>;
}

export function signal<T>(value: T): Signal<T> {
	return preactSignal(value);
}

// computed can be used both as a decorator and as a function
export function computed<T>(
	value: () => T,
	context: ClassGetterDecoratorContext
): void;
export function computed<T>(fn: () => T): ReadonlySignal<T>;
export function computed(value: any, context?: any): any {
	// If context exists and has 'kind', it's being used as a decorator
	if (context && typeof context === "object" && "kind" in context) {
		// Decorator behavior - set metadata
		context.metadata![context.name!] = computedType;
		return value;
	}

	// Otherwise, it's the regular computed function (value is actually the fn)
	return internalCreateComputed(value);
}

// Allow using `computed` in `static types` without introducing import cycles.
(computed as any).type = computedType.type;

export function source<T>(obj: PreactObservable<T> | T): T {
	return getSource(obj) as T;
}

export function reportChanged<T extends object>(obj: T): T {
	const adm = getAdministration(obj);
	adm.reportChanged();

	return obj;
}

export function reportObserved<T extends object>(obj: T): T {
	const adm = getAdministration(obj);

	adm.reportObserved();

	return obj;
}

const signalMap: WeakMap<Signal, Signal> = new WeakMap();

type Writable<T> = { -readonly [K in keyof T]: T[K] };
type SignalFor<T, K extends keyof T> =
	(<U>() => U extends Pick<T, K> ? 1 : 2) extends <U>() => U extends Writable<
		Pick<T, K>
	>
		? 1
		: 2
		? Signal<T[K]>
		: ReadonlySignal<T[K]>;

export function getSignal<T extends object, K extends keyof T = keyof T>(
	obj: T,
	key: K
): SignalFor<T, K>;
export function getSignal<T extends object, K extends keyof T>(
	obj: T,
	key: K
): ReadonlySignal<T[K]> {
	const adm = getAdministration(obj);
	if (!adm || adm.proxy !== obj) {
		throw new TypeError(
			"r-state-tree: getSignal expected an observable object"
		);
	}

	const name = typeof key === "number" ? String(key) : key;
	const descriptor = getPropertyDescriptor(adm.source, name);
	const writableField = !descriptor || descriptor.writable;
	let node: unknown;
	if (adm instanceof ObjectAdministration) {
		const type = adm.getType(name);
		if (type === "computed" && descriptor?.get && !descriptor.set) {
			const computedNode = getInternalNode(obj, name);
			// Preact computed signals are Signal instances too. Don't add a setter.
			if (computedNode instanceof Signal) return computedNode;
		} else if (type === "observable" && writableField) {
			// The backend treats an empty getNode key as a request for the object atom.
			node =
				name === ""
					? adm.valuesMap.getOrCreate(name, descriptor?.value).node
					: getInternalNode(obj, name);
		}
	} else if (Array.isArray(obj) && writableField && typeof name === "string") {
		const index = Number(name) >>> 0;
		if (name === "length") node = getInternalNode(obj, name);
		else if (String(index) === name && index < 0xffffffff) {
			node = getInternalNode(obj, index);
		}
	}

	if (!(node instanceof Signal)) {
		throw new TypeError(
			`r-state-tree: getSignal(${String(key)}) expected an observable field or a getter-only computed`
		);
	}

	let signal = signalMap.get(node);
	if (!signal) {
		signal = new Signal();
		Object.defineProperties(signal, {
			value: {
				get() {
					return obj[key];
				},
				set(v) {
					obj[key] = v;
				},
			},
			peek: {
				value() {
					return untracked(() => obj[key]);
				},
			},
		});
		signalMap.set(node, signal);
	}

	return signal;
}
