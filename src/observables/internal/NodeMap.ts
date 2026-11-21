import type { AtomNode, SignalNode } from "../preact.js";
import {
	createCachedAtom,
	createCachedSignal,
	type CachedNode,
	type CachedNodeOwner,
} from "./CachedNode.js";
import { isNonPrimitive } from "./utils.js";

// Per NodeMap, in addition to nodes with live subscribers. Object keys remain weak.
export const MAX_INACTIVE_NODES = 256;

abstract class NodeMap<
	K = unknown,
	GraphNode extends AtomNode | SignalNode<unknown> =
		| AtomNode
		| SignalNode<unknown>,
> implements CachedNodeOwner {
	private map: Map<unknown, CachedNode<GraphNode>> | undefined;
	private weakMap: WeakMap<object, CachedNode<GraphNode>> | undefined;
	private inactive: Map<unknown, CachedNode<GraphNode>> | undefined;

	protected abstract createNode(initialValue?: unknown): CachedNode<GraphNode>;

	get(key: unknown): CachedNode<GraphNode> | undefined {
		return isNonPrimitive(key) ? this.weakMap?.get(key) : this.map?.get(key);
	}

	private retainInactive(key: unknown, entry: CachedNode<GraphNode>): void {
		const inactive = (this.inactive ??= new Map());
		inactive.delete(key);
		inactive.set(key, entry);
		while (inactive.size > MAX_INACTIVE_NODES) {
			const oldestKey = inactive.keys().next().value;
			this.delete(oldestKey as K);
		}
	}

	onEntryObservedStateChange(key: unknown, observing: boolean): void {
		if (observing) {
			this.inactive?.delete(key);
		} else {
			// Preserve eager cleanup after the last live subscriber leaves.
			this.delete(key as K);
		}
	}

	delete(key: K): void {
		const entry = isNonPrimitive(key)
			? this.weakMap?.get(key)
			: this.map?.get(key);
		if (!entry) return;

		if (isNonPrimitive(key)) {
			this.weakMap?.delete(key);
		} else {
			this.map?.delete(key);
			this.inactive?.delete(key);
		}
		// Disconnect ownership references as well: an evicted dependency retained
		// by a lazy computed must not retain the entire cache through its callback.
		entry.setOwner?.(undefined, undefined);
		entry.onObservedStateChange = undefined;
		entry.invalidate();
	}

	/** Whether this cache contains any primitive-key dependencies, even lazy ones. */
	get hasPrimitiveKeys(): boolean {
		return (this.map?.size ?? 0) > 0;
	}

	getOrCreate(key: K, value?: unknown): GraphNode {
		const weak = isNonPrimitive(key);
		let entry = weak ? this.weakMap?.get(key) : this.map?.get(key);

		if (weak) {
			if (!entry) {
				this.weakMap ??= new WeakMap();
				entry = this.createNode(value);
				this.weakMap.set(key, entry);
			}
		} else {
			if (!entry) {
				this.map ??= new Map();
				entry = this.createNode(value);
				this.map.set(key, entry);
				if (entry.setOwner) {
					entry.setOwner(this, key);
				} else {
					entry.onObservedStateChange = (observing) => {
						this.onEntryObservedStateChange(key, observing);
					};
				}
			}
			if (!entry.observing) this.retainInactive(key, entry);
		}

		return entry;
	}

	reportObserved(key: K, value?: unknown): void {
		this.getOrCreate(key, value).reportObserved();
	}

	reportChanged(key: K, value?: unknown): void {
		return this.get(key)?.reportChanged(value);
	}

	keys(): Iterable<unknown> {
		return this.map?.keys() ?? [];
	}
}

export class AtomMap<K = unknown> extends NodeMap<K, AtomNode> {
	protected createNode(): CachedNode<AtomNode> {
		return createCachedAtom();
	}
}

export class SignalMap<K = unknown, V = unknown> extends NodeMap<
	K,
	SignalNode<V>
> {
	protected createNode(initialValue?: unknown): CachedNode<SignalNode<V>> {
		return createCachedSignal(initialValue as V);
	}
}
