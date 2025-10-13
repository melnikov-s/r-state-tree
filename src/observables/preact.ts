import {
	computed,
	signal,
	Signal,
	ReadonlySignal,
	batch,
	effect,
	untracked,
} from "@preact/signals-core";

import { ObjectAdministration } from "./object";
import {
	getAdministration,
	getInternalNode,
	getObservable,
	getObservableClassInstance,
	getSource,
} from "./internal/lookup";

export { isObservable } from "./index";

export class PreactObjectAdministration<
	T extends object
> extends ObjectAdministration<T> {
	static proxyTraps: ProxyHandler<object> = Object.assign(
		{},
		ObjectAdministration.proxyTraps,
		{
			get(target, prop, proxy) {
				if (
					!(prop in target) &&
					(typeof prop === "string" || typeof prop === "number") &&
					String(prop)[0] === "$"
				) {
					return getSignal(proxy, prop.substring(1) as keyof typeof target);
				}

				return ObjectAdministration.proxyTraps.get?.apply(
					null,
					arguments as any
				);
			},
		} as ProxyHandler<object>
	);
}

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
	const s = signal(initialValue);

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
	const s = signal(value);

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

export function createEffect(fn: () => void) {
	return effect(fn);
}

export function runInUntracked<T>(fn: () => T): T {
	return untracked(() => fn());
}

export function createReaction<T>(fn: () => T, callback: (value: T) => void) {
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
	const c = computed(context ? fn.bind(context) : fn);
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

export type PreactObservable<T> = T extends Function
	? T
	: T extends Map<infer K, infer V>
	? Map<K, PreactObservable<V>>
	: T extends Array<infer V>
	? Array<PreactObservable<V>>
	: T extends Set<infer V>
	? Set<PreactObservable<V>>
	: T extends WeakSet<infer V>
	? WeakSet<PreactObservable<V>>
	: T extends WeakMap<infer K, infer V>
	? WeakMap<K, PreactObservable<V>>
	: {
			[key in keyof T]: T[key] extends object
				? PreactObservable<T[key]>
				: T[key];
	  } & {
			readonly [key in keyof T as T[key] extends object
				? never
				: `$${string & key}`]?: Signal<T[key]>;
	  };

export function observable<T>(obj: T): PreactObservable<T> {
	return getObservable(obj) as any;
}

export function source<T>(obj: PreactObservable<T> | T): T {
	return getSource(obj) as T;
}

export function runInBatch<T>(fn: () => T): T {
	return batch(() => fn());
}

export class Observable {
	constructor() {
		return getObservableClassInstance(this);
	}
}

export function reportChanged<T extends object>(obj: T): T {
	const adm = getAdministration(obj);
	adm.reportChanged();

	return obj;
}

export function reportObserved<T extends object>(
	obj: T,
	opts?: { deep?: boolean }
): T {
	const adm = getAdministration(obj);

	adm.reportObserved(opts?.deep);

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
