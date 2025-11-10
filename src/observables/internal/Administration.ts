import { batch } from "@preact/signals-core";
import { createAtom, createObservedAtom } from "../preact";
import type { AtomNode, ObservedAtomNode } from "../preact";
import type { SignalMap } from "./NodeMap";
import { resolveNode } from "./utils";

let circularRefSet: WeakSet<object> | null = null;

export class Administration<T extends object = any> {
	static readonly proxyTraps: ProxyHandler<object> = {};
	readonly proxy: T;
	readonly source: T;
	readonly atom: ObservedAtomNode;

	protected valuesMap?: SignalMap;
	protected isObserved = false;
	private forceObservedAtoms?: AtomNode[];

	constructor(source: T) {
		this.atom = createObservedAtom();
		this.source = source;
		this.proxy = new Proxy(
			this.source,
			(this.constructor as typeof Administration).proxyTraps
		) as T;
	}

	protected flushChange(): void {
		if (this.forceObservedAtoms?.length) {
			batch(() => {
				for (let i = 0; i < this.forceObservedAtoms!.length; i++) {
					this.forceObservedAtoms![i].reportChanged();
				}
			});
			this.forceObservedAtoms = undefined;
		}
	}

	getNode(): unknown {
		return resolveNode(this.atom);
	}

	reportChanged(): void {
		this.atom.reportChanged();
	}

	protected reportObserveDeep(): void {}

	reportObserved(deep = false): void {
		const entry = circularRefSet == null;
		if (entry) {
			circularRefSet = new WeakSet();
		} else if (circularRefSet!.has(this)) {
			return;
		}

		circularRefSet!.add(this);

		const atom = createAtom();
		if (!this.forceObservedAtoms) {
			this.forceObservedAtoms = [];
		}
		this.forceObservedAtoms.push(atom);
		atom.reportObserved();
		if (deep) {
			this.reportObserveDeep();
		}

		if (entry) {
			circularRefSet = null;
		}
	}
}
