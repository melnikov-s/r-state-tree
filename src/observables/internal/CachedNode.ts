import { Signal } from "../preact.js";
import type { AtomNode, SignalNode } from "../preact.js";

/** @internal */
export interface NodeMapOwner {
	_onNodeObserved(node: CachedNode<any>): void;
	_onNodeUnobserved(key: unknown): void;
}

export type CachedNode<T> = T & {
	readonly observing: boolean;
	onObservedStateChange?: (observing: boolean) => void;
	invalidate(): void;
	/** @internal */
	_owner?: NodeMapOwner;
	/** @internal */
	_key?: unknown;
	/** @internal Intrusive LRU links for inactive nodes in NodeMap. */
	_prev?: CachedNode<any>;
	/** @internal */
	_next?: CachedNode<any>;
	/** @internal */
	_inInactive?: boolean;
};

// Boxed sentinel lets invalidate() bump the single Preact Signal version without
// exposing a fabricated value through peek() / .value reads.
class InvalidatedBox {
	readonly value: unknown;
	constructor(value: unknown) {
		this.value = value;
	}
}

function onCachedNodeWatched(this: Signal<unknown>): void {
	const node = this as CachedSignal<unknown> | CachedAtom;
	node.observing = true;
	if (node._owner) node._owner._onNodeObserved(node);
	else node.onObservedStateChange?.(true);
}

function onCachedNodeUnwatched(this: Signal<unknown>): void {
	const node = this as CachedSignal<unknown> | CachedAtom;
	node.observing = false;
	if (node._owner) node._owner._onNodeUnobserved(node._key);
	else node.onObservedStateChange?.(false);
}

const CACHED_NODE_OPTIONS = {
	watched: onCachedNodeWatched,
	unwatched: onCachedNodeUnwatched,
};

export class CachedSignal<T>
	extends Signal<T>
	implements CachedNode<SignalNode<T>>
{
	observing = false;
	onObservedStateChange?: (observing: boolean) => void;
	/** @internal */
	_owner?: NodeMapOwner;
	/** @internal */
	_key?: unknown;
	/** @internal */
	_prev?: CachedNode<any>;
	/** @internal */
	_next?: CachedNode<any>;
	/** @internal */
	_inInactive?: boolean;

	constructor(initialValue: T) {
		super(initialValue, CACHED_NODE_OPTIONS);
	}

	get node(): Signal<T> {
		return this;
	}

	override get value(): T {
		const v = super.value;
		return v instanceof InvalidatedBox ? (v.value as T) : v;
	}

	override set value(next: T) {
		super.value = next;
	}

	invalidate(): void {
		super.value = new InvalidatedBox(this.peek()) as unknown as T;
	}

	reportObserved(): void {
		super.value;
	}

	reportChanged(next: T): void {
		super.value = next;
	}

	get(): T {
		return this.value;
	}

	set(next: T): T {
		return (super.value = next);
	}
}

export class CachedAtom extends Signal<number> implements CachedNode<AtomNode> {
	observing = false;
	onObservedStateChange?: (observing: boolean) => void;
	/** @internal */
	_owner?: NodeMapOwner;
	/** @internal */
	_key?: unknown;
	/** @internal */
	_prev?: CachedNode<any>;
	/** @internal */
	_next?: CachedNode<any>;
	/** @internal */
	_inInactive?: boolean;
	private _revision = 0;

	constructor() {
		super(0, CACHED_NODE_OPTIONS);
	}

	get node(): Signal<unknown> {
		return this;
	}

	invalidate(): void {
		this.value = ++this._revision;
	}

	reportObserved(): void {
		this.value;
	}

	reportChanged(): void {
		this.value = ++this._revision;
	}
}

export function createCachedSignal<T>(
	initialValue: T
): CachedNode<SignalNode<T>> {
	return new CachedSignal(initialValue);
}

export function createCachedAtom(): CachedNode<AtomNode> {
	return new CachedAtom();
}
