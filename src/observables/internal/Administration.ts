import { createAtom, createObservedAtom } from "../preact.js";
import type { AtomNode, ObservedAtomNode } from "../preact.js";
import { resolveNode } from "./utils.js";

export class Administration<T extends object = any> {
	static readonly proxyTraps: ProxyHandler<object> = {};
	readonly proxy: T;
	readonly source: T;
	private _atom?: ObservedAtomNode;

	protected isObserved = false;
	private forceObservedAtom?: AtomNode;
	private reportingObserved = false;

	constructor(source: T) {
		this.source = source;
		this.proxy = new Proxy(
			this.source,
			(this.constructor as typeof Administration).proxyTraps
		) as T;
	}

	get atom(): ObservedAtomNode {
		return (this._atom ??= createObservedAtom());
	}

	protected get atomObserving(): boolean {
		return this._atom !== undefined && this._atom.observing;
	}

	protected hasForceObserved(): boolean {
		return this.forceObservedAtom !== undefined;
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
		this._atom?.reportChanged();
	}

	reportObserved(): void {
		if (this.reportingObserved) return;
		this.reportingObserved = true;
		try {
			if (!this.forceObservedAtom) {
				this.forceObservedAtom = createAtom();
			}
			this.forceObservedAtom.reportObserved();
		} finally {
			this.reportingObserved = false;
		}
	}
}
