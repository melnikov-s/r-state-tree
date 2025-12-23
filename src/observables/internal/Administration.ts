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
	private forceObservedAtom?: AtomNode;

	constructor(source: T) {
		this.atom = createObservedAtom();
		this.source = source;
		this.proxy = new Proxy(
			this.source,
			(this.constructor as typeof Administration).proxyTraps
		) as T;
	}

	protected flushChange(): void {
		if (this.forceObservedAtom) {
			this.forceObservedAtom.reportChanged();
			this.forceObservedAtom = undefined;
		}
	}

	getNode(): unknown {
		return resolveNode(this.atom);
	}

	reportChanged(): void {
		this.atom.reportChanged();
	}

	reportObserved(): void {
		const entry = circularRefSet == null;
		if (entry) {
			circularRefSet = new WeakSet();
		} else if (circularRefSet!.has(this)) {
			return;
		}

		circularRefSet!.add(this);

		if (!this.forceObservedAtom) {
			this.forceObservedAtom = createAtom();
		}
		this.forceObservedAtom.reportObserved();

		if (entry) {
			circularRefSet = null;
		}
	}
}
