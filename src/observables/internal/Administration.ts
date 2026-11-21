import { createAtom, createObservedAtom } from "../preact.js";
import type { AtomNode, ObservedAtomNode } from "../preact.js";
import { resolveNode } from "./utils.js";

let circularRefSet: WeakSet<object> | null = null;

export class Administration<T extends object = any> {
	static readonly proxyTraps: ProxyHandler<object> = {};
	readonly proxy: T;
	readonly source: T;
	private _atom?: ObservedAtomNode;

	protected isObserved = false;
	private forceObservedAtom?: AtomNode;

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

	protected get hasForceObservedAtom(): boolean {
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
