import { Signal } from "../preact";
import type { AtomNode, SignalNode } from "../preact";

export type CachedNode<T> = T & {
	readonly observing: boolean;
	onObservedStateChange?: (observing: boolean) => void;
	invalidate(): void;
};

// A separate revision lets eviction invalidate lazy computed dependencies without
// changing the value they expose. The Signal facade preserves the node API; its
// reads track the revision using only public Preact APIs (including peek/subscribe).
export function createCachedSignal<T>(
	initialValue: T
): CachedNode<SignalNode<T>> {
	const value = new Signal(initialValue);
	let revision = 0;
	let observing = false;
	const version = new Signal(0, {
		watched() {
			observing = true;
			entry.onObservedStateChange?.(true);
		},
		unwatched() {
			observing = false;
			entry.onObservedStateChange?.(false);
		},
	});
	const node = new Signal<T>();
	const invalidate = () => {
		version.value = ++revision;
	};
	Object.defineProperty(node, "value", {
		get() {
			version.value;
			return value.value;
		},
		set(next: T) {
			value.value = next;
		},
	});
	const entry: CachedNode<SignalNode<T>> = {
		node,
		get observing() {
			return observing;
		},
		invalidate,
		reportObserved() {
			return node.value;
		},
		reportChanged(next) {
			return (node.value = next);
		},
		get: () => node.value,
		set: (next) => (node.value = next),
	};
	return entry;
}

export function createCachedAtom(): CachedNode<AtomNode> {
	let revision = 0;
	let observing = false;
	const node = new Signal(0, {
		watched() {
			observing = true;
			entry.onObservedStateChange?.(true);
		},
		unwatched() {
			observing = false;
			entry.onObservedStateChange?.(false);
		},
	});
	const invalidate = () => {
		node.value = ++revision;
	};
	const entry: CachedNode<AtomNode> = {
		node,
		get observing() {
			return observing;
		},
		invalidate,
		reportObserved() {
			return node.value;
		},
		reportChanged: invalidate,
	};
	return entry;
}
