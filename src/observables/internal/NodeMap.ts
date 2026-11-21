import type { AtomNode, SignalNode } from "../preact.js";
import {
	CachedAtom,
	CachedSignal,
	type CachedNode,
	type NodeMapOwner,
} from "./CachedNode.js";
import { isNonPrimitive } from "./utils.js";

// Per NodeMap, in addition to nodes with live subscribers. Object keys remain weak.
export const MAX_INACTIVE_NODES = 256;

abstract class NodeMap<
	K = unknown,
	GraphNode extends AtomNode | SignalNode<unknown> =
		| AtomNode
		| SignalNode<unknown>,
> implements NodeMapOwner {
	protected map: Map<unknown, CachedNode<GraphNode>> | undefined;
	private weakMap: WeakMap<object, CachedNode<GraphNode>> | undefined;
	// Intrusive doubly-linked LRU list for inactive primitive-key nodes (head = oldest, tail = newest).
	private _head: CachedNode<GraphNode> | undefined;
	protected _tail: CachedNode<GraphNode> | undefined;
	private _inactiveSize = 0;

	protected abstract createNode(initialValue?: unknown): CachedNode<GraphNode>;

	private unlinkInactive(entry: CachedNode<GraphNode>): void {
		if (!entry._inInactive) return;
		const prev = entry._prev;
		const next = entry._next;
		if (prev) prev._next = next;
		else this._head = next;
		if (next) next._prev = prev;
		else this._tail = prev;
		entry._prev = undefined;
		entry._next = undefined;
		entry._inInactive = false;
		this._inactiveSize--;
	}

	protected retainInactive(entry: CachedNode<GraphNode>): void {
		if (entry === this._tail && entry._inInactive) return;
		if (entry._inInactive) {
			const prev = entry._prev;
			const next = entry._next;
			if (prev) prev._next = next;
			else this._head = next;
			if (next) next._prev = prev;
			else this._tail = prev;
			const tail = this._tail;
			entry._prev = tail;
			entry._next = undefined;
			if (tail) tail._next = entry;
			else this._head = entry;
			this._tail = entry;
			return;
		}
		const tail = this._tail;
		entry._prev = tail;
		entry._next = undefined;
		entry._inInactive = true;
		if (tail) tail._next = entry;
		else this._head = entry;
		this._tail = entry;
		this._inactiveSize++;
		if (this._inactiveSize > MAX_INACTIVE_NODES) {
			const oldest = this._head;
			if (oldest) this.delete(oldest._key as K);
		}
	}

	/** @internal */
	_onNodeObserved(node: CachedNode<any>): void {
		this.unlinkInactive(node);
	}

	/** @internal */
	_onNodeUnobserved(key: unknown): void {
		// Preserve eager cleanup after the last live subscriber leaves.
		this.delete(key as K);
	}

	get(key: unknown): CachedNode<GraphNode> | undefined {
		if (
			key === null ||
			(typeof key !== "object" && typeof key !== "function")
		) {
			return this.map?.get(key);
		}
		return this.weakMap?.get(key);
	}

	delete(key: K): void {
		const nonPrimitive = isNonPrimitive(key);
		const entry = nonPrimitive ? this.weakMap?.get(key) : this.map?.get(key);
		if (!entry) return;

		if (nonPrimitive) {
			this.weakMap!.delete(key);
		} else {
			this.map!.delete(key);
			this.unlinkInactive(entry);
		}
		// Disconnect owner/callback so an evicted dependency retained by a lazy
		// computed does not retain this cache.
		entry._owner = undefined;
		entry._key = undefined;
		entry.onObservedStateChange = undefined;
		entry.invalidate();
	}

	getOrCreate(key: K, value?: unknown): GraphNode {
		if (
			key === null ||
			(typeof key !== "object" && typeof key !== "function")
		) {
			let map = this.map;
			let entry = map?.get(key);
			if (entry === undefined) {
				if (!map) {
					map = new Map();
					this.map = map;
				}
				entry = this.createNode(value);
				entry._owner = this;
				entry._key = key;
				map.set(key, entry);
			}
			if (!entry.observing) this.retainInactive(entry);
			return entry;
		}

		let weakMap = this.weakMap;
		let entry = weakMap?.get(key as object);
		if (entry === undefined) {
			if (!weakMap) {
				weakMap = new WeakMap();
				this.weakMap = weakMap;
			}
			entry = this.createNode(value);
			weakMap.set(key as object, entry);
		}
		return entry;
	}

	reportObservedPrimitive(key: K, value?: unknown): void {
		let map = this.map;
		let entry = map?.get(key);
		if (entry === undefined) {
			if (!map) {
				map = new Map();
				this.map = map;
			}
			entry = this.createNode(value);
			entry._owner = this;
			entry._key = key;
			map.set(key, entry);
			this.retainInactive(entry);
		} else if (!entry.observing && entry !== this._tail) {
			this.retainInactive(entry);
		}
		entry.reportObserved();
	}

	reportObserved(key: K, value?: unknown): void {
		if (
			key === null ||
			(typeof key !== "object" && typeof key !== "function")
		) {
			let map = this.map;
			let entry = map?.get(key);
			if (entry === undefined) {
				if (!map) {
					map = new Map();
					this.map = map;
				}
				entry = this.createNode(value);
				entry._owner = this;
				entry._key = key;
				map.set(key, entry);
				this.retainInactive(entry);
			} else if (!entry.observing && entry !== this._tail) {
				this.retainInactive(entry);
			}
			entry.reportObserved();
			return;
		}

		let weakMap = this.weakMap;
		let entry = weakMap?.get(key as object);
		if (entry === undefined) {
			if (!weakMap) {
				weakMap = new WeakMap();
				this.weakMap = weakMap;
			}
			entry = this.createNode(value);
			weakMap.set(key as object, entry);
		}
		entry.reportObserved();
	}

	reportChanged(key: K, value?: unknown): void {
		if (
			key === null ||
			(typeof key !== "object" && typeof key !== "function")
		) {
			const entry = this.map?.get(key);
			if (entry !== undefined) entry.reportChanged(value);
			return;
		}
		const entry = this.weakMap?.get(key as object);
		if (entry !== undefined) entry.reportChanged(value);
	}

	keys(): Iterable<unknown> {
		return this.map?.keys() ?? [];
	}
}

export class AtomMap<K = unknown> extends NodeMap<K, AtomNode> {
	protected createNode(): CachedNode<AtomNode> {
		return new CachedAtom();
	}
}

export class SignalMap<K = unknown, V = unknown> extends NodeMap<
	K,
	SignalNode<V>
> {
	protected createNode(initialValue?: unknown): CachedNode<SignalNode<V>> {
		return new CachedSignal(initialValue as V);
	}
}

const ARRAY_SLOT_LIMIT = 256;

/** Dense integer-indexed SignalMap for ArrayAdministration; keeps NodeMap untouched for non-array keys. */
export class ArraySignalMap<V = unknown> extends SignalMap<number, V> {
	/** @internal */
	_slots: (CachedNode<SignalNode<V>> | undefined)[] | undefined;

	override get(index: number): CachedNode<SignalNode<V>> | undefined {
		if (index >= 0 && index < ARRAY_SLOT_LIMIT && this._slots) {
			return this._slots[index];
		}
		return super.get(index);
	}

	override delete(index: number): void {
		if (index >= 0 && index < ARRAY_SLOT_LIMIT && this._slots) {
			this._slots[index] = undefined;
		}
		super.delete(index);
	}

	override getOrCreate(index: number, value?: unknown): SignalNode<V> {
		if (index >= 0 && index < ARRAY_SLOT_LIMIT) {
			const entry = this._slots?.[index];
			if (entry !== undefined) {
				if (!entry.observing && entry !== this._tail)
					this.retainInactive(entry);
				return entry;
			}
			const created = super.getOrCreate(index, value) as CachedNode<
				SignalNode<V>
			>;
			(this._slots ??= [])[index] = created;
			return created;
		}
		return super.getOrCreate(index, value);
	}

	override reportObserved(index: number, value?: unknown): void {
		if (index >= 0 && index < ARRAY_SLOT_LIMIT) {
			const entry = this._slots?.[index];
			if (entry !== undefined) {
				if (!entry.observing && entry !== this._tail)
					this.retainInactive(entry);
				entry.reportObserved();
				return;
			}
			const created = super.getOrCreate(index, value) as CachedNode<
				SignalNode<V>
			>;
			(this._slots ??= [])[index] = created;
			created.reportObserved();
			return;
		}
		super.reportObserved(index, value);
	}

	override reportChanged(index: number, value?: unknown): void {
		if (index >= 0 && index < ARRAY_SLOT_LIMIT) {
			const entry = this._slots?.[index];
			if (entry !== undefined) entry.reportChanged(value as V);
			return;
		}
		super.reportChanged(index, value);
	}
}
