import {
	computed as preactComputed,
	signal as preactSignal,
	Signal,
	batch,
	effect,
	untracked,
} from "@preact/signals-core";
import type { ReadonlySignal } from "@preact/signals-core";

import { ObjectAdministration } from "./object";
import {
	getAdministration,
	getInternalNode,
	getObservable,
	getSource,
} from "./internal/lookup";

export { isObservable } from "./index";

export class PreactObjectAdministration<
	T extends object
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
	clear: () => void;
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

export function reaction<T>(fn: () => T, callback: (value: T) => void) {
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

		currentValue = nextValue;

		untracked(() => {
			callback(nextValue);
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
	let lastvalue!: unknown;

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

				if (Object.is(lastvalue, value)) {
					return;
				}

				lastvalue = value;

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

export function createComputed<T>(
	fn: () => T,
	context: unknown = null
): ComputedNode<T> {
	const c = preactComputed(context ? fn.bind(context) : fn);
	return {
		node: c,
		get() {
			return c.value;
		},
		clear: () => {
			untracked(() => {
				(c as any)._value = undefined;
			});
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
		context.metadata![context.name!] = { type: "computed" };
		return value;
	}

	// Otherwise, it's the regular computed function (value is actually the fn)
	return preactComputed(value);
}

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

export function getSignal<T extends object>(
	obj: T,
	key: keyof T
): Signal<T[keyof T]> {
	const node = getInternalNode(obj, key);

	if (node instanceof Signal) {
		let signal = signalMap.get(node);
		if (!signal) {
			signal = new Signal();
			Object.defineProperties(signal, {
				value: {
					get() {
						return obj[key];
					},
					set(v) {
						return (obj[key] = v);
					},
				},
				peek: {
					value() {
						return source(obj)[key];
					},
				},
			});

			signalMap.set(node, signal);
		}

		return signal!;
	}

	return node;
}
