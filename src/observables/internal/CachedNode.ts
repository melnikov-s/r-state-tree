import type { SignalOptions } from "@preact/signals-core";
import { Signal } from "../preact.js";
import type { AtomNode, SignalNode } from "../preact.js";

export interface CachedNodeOwner {
	onEntryObservedStateChange(key: unknown, observing: boolean): void;
}

export type CachedNode<T> = T & {
	readonly observing: boolean;
	onObservedStateChange?: (observing: boolean) => void;
	setOwner?(owner: CachedNodeOwner | undefined, key: unknown): void;
	invalidate(): void;
};

const cachedSignalOptions: SignalOptions<unknown> = {
	watched(this: Signal<unknown>) {
		(this as CachedSignalNode<unknown>).handleObservedState(true);
	},
	unwatched(this: Signal<unknown>) {
		(this as CachedSignalNode<unknown>).handleObservedState(false);
	},
};

const cachedAtomOptions: SignalOptions<number> = {
	watched(this: Signal<number>) {
		(this as CachedAtomNode).handleObservedState(true);
	},
	unwatched(this: Signal<number>) {
		(this as CachedAtomNode).handleObservedState(false);
	},
};

// A separate revision lets eviction invalidate lazy computed dependencies without
// changing the value they expose. Subclassing Signal keeps the value accessor on
// the prototype and tracks the revision using only public Preact APIs (including
// peek/subscribe).
class CachedSignalNode<T>
	extends Signal<T>
	implements CachedNode<SignalNode<T>>
{
	private _version: Signal<number>;
	private _revision = 0;
	private _observing = false;
	private _owner: CachedNodeOwner | undefined;
	private _ownerKey: unknown;
	onObservedStateChange?: (observing: boolean) => void;

	constructor(initialValue: T) {
		super(initialValue, cachedSignalOptions as SignalOptions<T>);
		this._version = new Signal(0);
	}

	override get value(): T {
		void this._version.value;
		return super.value;
	}

	override set value(next: T) {
		super.value = next;
	}

	get node(): Signal<T> {
		return this;
	}

	get observing(): boolean {
		return this._observing;
	}

	setOwner(owner: CachedNodeOwner | undefined, key: unknown): void {
		this._owner = owner;
		this._ownerKey = key;
	}

	handleObservedState(observing: boolean): void {
		this._observing = observing;
		this._owner?.onEntryObservedStateChange(this._ownerKey, observing);
		this.onObservedStateChange?.(observing);
	}

	invalidate(): void {
		this._version.value = ++this._revision;
	}

	reportObserved(): void {
		void this._version.value;
		void super.value;
	}

	reportChanged(next: T): void {
		super.value = next;
	}

	get(): T {
		void this._version.value;
		return super.value;
	}

	set(next: T): T {
		return (super.value = next);
	}
}

class CachedAtomNode extends Signal<number> implements CachedNode<AtomNode> {
	private _revision = 0;
	private _observing = false;
	private _owner: CachedNodeOwner | undefined;
	private _ownerKey: unknown;
	onObservedStateChange?: (observing: boolean) => void;

	constructor() {
		super(0, cachedAtomOptions);
	}

	get node(): Signal<unknown> {
		return this;
	}

	get observing(): boolean {
		return this._observing;
	}

	setOwner(owner: CachedNodeOwner | undefined, key: unknown): void {
		this._owner = owner;
		this._ownerKey = key;
	}

	handleObservedState(observing: boolean): void {
		this._observing = observing;
		this._owner?.onEntryObservedStateChange(this._ownerKey, observing);
		this.onObservedStateChange?.(observing);
	}

	invalidate(): void {
		super.value = ++this._revision;
	}

	reportObserved(): void {
		void super.value;
	}

	reportChanged(): void {
		super.value = ++this._revision;
	}
}

export function createCachedSignal<T>(
	initialValue: T
): CachedNode<SignalNode<T>> {
	return new CachedSignalNode(initialValue);
}

export function createCachedAtom(): CachedNode<AtomNode> {
	return new CachedAtomNode();
}
