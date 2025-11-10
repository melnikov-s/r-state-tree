import { createAtom, createSignal } from "../preact";
import type { AtomNode, ObservedAtomNode, SignalNode } from "../preact";
import { isNonPrimitive } from "./utils";

class NodeMap<
	K = unknown,
	GraphNode extends AtomNode | SignalNode<unknown> =
		| AtomNode
		| SignalNode<unknown>
> {
	private map: Map<unknown, GraphNode> | undefined;
	private weakMap: WeakMap<object, GraphNode> | undefined;
	private observedAtom?: ObservedAtomNode;
	private cleanUpRegistered = false;

	constructor(observedAtom?: ObservedAtomNode) {
		this.observedAtom = observedAtom;
	}

	private registerCleanup(): void {
		if (this.observedAtom) {
			this.cleanUpRegistered = true;
			const unsub = this.observedAtom.onObservedStateChange((observing) => {
				if (!observing) {
					this.map?.clear();
					this.cleanUpRegistered = false;
					unsub();
				}
			});
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	protected createNode(_initialValue?: unknown): GraphNode {
		return {} as GraphNode;
	}

	get(key: unknown): GraphNode | undefined {
		return isNonPrimitive(key) ? this.weakMap?.get(key) : this.map?.get(key);
	}

	delete(key: K): void {
		isNonPrimitive(key) ? this.weakMap?.delete(key) : this.map?.delete(key);
	}

	add(key: K, atom: GraphNode): void {
		isNonPrimitive(key)
			? this.weakMap?.set(key, atom)
			: this.map?.set(key, atom);
	}

	getOrCreate(key: K, value?: unknown): GraphNode {
		let entry: GraphNode | undefined = this.get(key);

		if (!entry) {
			if (isNonPrimitive(key)) {
				this.weakMap = this.weakMap ?? new WeakMap();

				entry = this.createNode(value);

				this.weakMap.set(key, entry);
			} else {
				this.map = this.map ?? new Map();

				entry = this.createNode(value);

				if (!this.cleanUpRegistered) {
					this.registerCleanup();
				}

				this.map.set(key, entry);
			}
		}

		return entry;
	}

	reportObserved(key: K, value?: unknown): void {
		this.getOrCreate(key, value).reportObserved();
	}

	reportChanged(key: K, value?: unknown): void {
		return this.get(key)?.reportChanged(value);
	}
}

export class AtomMap<K = unknown> extends NodeMap<K, AtomNode> {
	protected createNode(): AtomNode {
		return createAtom();
	}
}

export class SignalMap<K = unknown, V = unknown> extends NodeMap<
	K,
	SignalNode<V>
> {
	protected createNode(initialValue?: unknown): SignalNode<V> {
		return createSignal(initialValue as V);
	}
}
