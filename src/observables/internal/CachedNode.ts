import { Signal, type SignalOptions } from "@preact/signals-core";
import type { AtomNode, SignalNode } from "../preact.js";

export type CachedNode<T> = T & {
	readonly observing: boolean;
	onObservedStateChange?: (observing: boolean) => void;
	invalidate(): void;
};

// Preact invokes the handlers with the signal constructed with these options.
// Sharing them avoids allocating lifecycle closures for every dependency.
const revisionOptions: SignalOptions<number> = {
	watched() {
		(this as Revision).setObserved(true);
	},
	unwatched() {
		(this as Revision).setObserved(false);
	},
};

class Revision extends Signal<number> implements CachedNode<AtomNode> {
	observing = false;
	onObservedStateChange?: (observing: boolean) => void;
	private revision = 0;

	constructor() {
		super(0, revisionOptions);
	}

	get node(): Signal<number> {
		return this;
	}

	setObserved(observing: boolean): void {
		this.observing = observing;
		this.onObservedStateChange?.(observing);
	}

	invalidate(): void {
		this.value = ++this.revision;
	}

	reportObserved(): void {
		this.value;
	}

	reportChanged(): void {
		this.invalidate();
	}
}

// Keep the payload in a native signal so Preact can still suppress net-zero
// batch writes. The separate revision invalidates lazy computed dependencies on
// eviction without overwriting that payload. Both proxy and exposed signal reads
// go through the same two dependencies, including native peek()/subscribe().
class ValueEntry<T> extends Signal<T> implements CachedNode<SignalNode<T>> {
	private readonly revision = new Revision();

	get node(): Signal<T> {
		return this;
	}

	get observing(): boolean {
		return this.revision.observing;
	}

	get onObservedStateChange(): ((observing: boolean) => void) | undefined {
		return this.revision.onObservedStateChange;
	}

	set onObservedStateChange(
		callback: ((observing: boolean) => void) | undefined
	) {
		this.revision.onObservedStateChange = callback;
	}

	override get value(): T {
		this.revision.reportObserved();
		return super.value;
	}

	override set value(next: T) {
		super.value = next;
	}

	invalidate(): void {
		this.revision.invalidate();
	}

	reportObserved(): void {
		this.value;
	}

	reportChanged(next: T): void {
		this.value = next;
	}

	get(): T {
		return this.value;
	}

	set(next: T): T {
		return (this.value = next);
	}
}

export function createCachedAtom(): CachedNode<AtomNode> {
	return new Revision();
}

export function createCachedSignal<T>(
	initialValue: T
): CachedNode<SignalNode<T>> {
	return new ValueEntry(initialValue);
}
