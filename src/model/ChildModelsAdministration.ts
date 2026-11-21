import { ArrayAdministration, getSource, batch } from "../observables/index.js";
import { getAdministration } from "../observables/internal/lookup.js";
import Model from "./Model.js";
import type { ModelAdministration } from "./ModelAdministration.js";

function isIndex(name: PropertyKey): boolean {
	if (typeof name !== "string") return false;
	const len = name.length;
	if (len === 0 || len > 10) return false;
	const c0 = name.charCodeAt(0);
	if (c0 < 48 || c0 > 57) return false;
	if (len === 1) return true;
	if (c0 === 48) return false;
	let n = c0 - 48;
	for (let i = 1; i < len; i++) {
		const c = name.charCodeAt(i);
		if (c < 48 || c > 57) return false;
		n = n * 10 + (c - 48);
	}
	return n < 4294967295;
}

export class ChildModelsAdministration<
	T extends Model,
> extends ArrayAdministration<T> {
	private members = new Set<T>();
	private mutating = false;
	private disposed = false;
	private _cachedAdms?: ModelAdministration[];
	// The owner validates before commit, then publishes ownership in the same batch.
	change?: (added: T[], removed: T[], commit: () => void) => void;

	/** @internal Cached ModelAdministration list matching source order; invalidated on structural writes. */
	getMemberAdms(): ModelAdministration[] {
		let adms = this._cachedAdms;
		if (!adms) {
			const src = this.source;
			const len = src.length;
			adms = new Array<ModelAdministration>(len);
			for (let i = 0; i < len; i++) {
				adms[i] = getAdministration(src[i]) as unknown as ModelAdministration;
			}
			this._cachedAdms = adms;
		}
		return adms;
	}

	static proxyTraps: ProxyHandler<unknown[]> = {
		...ArrayAdministration.proxyTraps,
		defineProperty(target, name, descriptor) {
			if (name === "length" || isIndex(name)) {
				throw new TypeError(
					"r-state-tree: child arrays do not support defineProperty(); use indexed assignment or splice()"
				);
			}
			return ArrayAdministration.proxyTraps.defineProperty!(
				target,
				name,
				descriptor
			);
		},
		deleteProperty(target, name) {
			if (isIndex(name))
				throw new TypeError(
					"r-state-tree: child arrays cannot contain holes; use splice()"
				);
			return ArrayAdministration.proxyTraps.deleteProperty!(target, name);
		},
		preventExtensions(): never {
			throw new TypeError("r-state-tree: child arrays must remain extensible");
		},
		setPrototypeOf(): never {
			throw new TypeError(
				"r-state-tree: child array prototypes cannot be changed"
			);
		},
	};

	static methods = Object.assign({}, ArrayAdministration.methods, {
		fill(): never {
			throw new TypeError(
				"r-state-tree: child arrays do not support fill(); use indexed assignment or splice()"
			);
		},
		copyWithin(): never {
			throw new TypeError(
				"r-state-tree: child arrays do not support copyWithin(); use splice()"
			);
		},
		reverse<T extends Model>(this: T[]): T[] {
			const adm = getAdministration(this) as ChildModelsAdministration<T>;
			return adm.transaction(() => {
				adm._cachedAdms = undefined;
				return ArrayAdministration.methods.reverse!.call(this) as T[];
			});
		},
		sort<T extends Model>(this: T[], compareFn?: (a: T, b: T) => number): T[] {
			const adm = getAdministration(this) as ChildModelsAdministration<T>;
			return adm.transaction(() => {
				adm._cachedAdms = undefined;
				return ArrayAdministration.methods.sort!.call(this, compareFn) as T[];
			});
		},
	});

	dispose(): void {
		this.disposed = true;
		this.change = undefined;
		this._cachedAdms = undefined;
	}

	/** Populate a freshly created unattached child array without proxy/batch overhead. */
	initMembers(models: T[]): T[] {
		// Use the supplied iterable (as a spread into push would), not its indices.
		const proxies = [...models];
		const len = proxies.length;
		const adms = new Array<ModelAdministration>(len);
		const source = this.source;
		const members = this.members;
		for (let i = 0; i < len; i++) {
			const item = proxies[i];
			if (!(item instanceof Model))
				throw new TypeError(
					"r-state-tree: child arrays require Model instances"
				);
			const adm = getAdministration(item)!;
			const raw = adm.source as T;
			if (members.has(raw)) {
				throw new Error(
					"r-state-tree: child arrays cannot contain duplicate models"
				);
			}
			members.add(raw);
			source.push(raw);
			const proxy = adm.proxy as T;
			this.trackObservableSource(raw);
			proxies[i] = proxy;
			adms[i] = adm as unknown as ModelAdministration;
		}
		this._cachedAdms = adms;
		return proxies;
	}

	/** Copy an existing child slot in the same order, without revalidating its membership. */
	copyMembersFrom(adms: ModelAdministration[]): void {
		const source = this.source;
		for (let i = 0; i < adms.length; i++) {
			const raw = adms[i].source as T;
			source[i] = raw;
			this.members.add(raw);
			this.trackObservableSource(raw);
		}
		this._cachedAdms = adms;
	}

	assertMutable(): void {
		if (this.disposed)
			throw new Error("r-state-tree: cannot use a disposed model");
		if (this.mutating)
			throw new Error("r-state-tree: reentrant child array mutation");
	}

	private transaction<R>(commit: () => R): R {
		this.assertMutable();
		return batch(() => {
			this.mutating = true;
			try {
				return commit();
			} finally {
				// Reactions run as the batch exits and may start a new transaction.
				this.mutating = false;
			}
		});
	}

	private normalize(value: T): T {
		if (!(value instanceof Model))
			throw new TypeError("r-state-tree: child arrays require Model instances");
		return getAdministration(value)!.proxy as T;
	}

	private update(added: T[], removed: T[], commit: () => void): void {
		const removedSet = new Set(removed.map((item) => getSource(item)));
		const addedSet = new Set<T>();
		for (const item of added) {
			const source = getSource(item);
			if (
				addedSet.has(source) ||
				(this.members.has(source) && !removedSet.has(source))
			) {
				throw new Error(
					"r-state-tree: child arrays cannot contain duplicate models"
				);
			}
			addedSet.add(source);
		}
		if (this.change) this.change(added, removed, commit);
		else commit();
		this._cachedAdms = undefined;
		for (const item of removedSet) this.members.delete(item);
		for (const item of addedSet) this.members.add(item);
	}

	setArrayLength(): never {
		throw new TypeError(
			"r-state-tree: child array length is read-only; use splice() to remove children"
		);
	}

	set(index: number, newValue: T): boolean {
		return this.transaction(() => {
			if (index > this.source.length)
				throw new RangeError("r-state-tree: child arrays cannot contain holes");
			newValue = this.normalize(newValue);
			if (index === this.source.length) {
				this.spliceNormalized(index, 0, [newValue]);
			} else if (getSource(newValue) !== this.source[index]) {
				this.update([newValue], [this.proxy[index]], () => {
					if (!super.set(index, newValue))
						throw new TypeError("r-state-tree: cannot write child array index");
				});
			}
			return true;
		});
	}

	spliceWithArray(index: number, deleteCount?: number, newItems?: T[]): T[] {
		const argumentCount = arguments.length;
		return this.transaction(() => {
			const length = this.source.length;
			const start = Math.trunc(+index) || 0;
			index = start < 0 ? Math.max(length + start, 0) : Math.min(start, length);
			deleteCount =
				argumentCount === 1
					? length - index
					: Math.min(
							Math.max(Math.trunc(+(deleteCount as number)) || 0, 0),
							length - index
						);
			const added = Array.from(newItems ?? [], (item) => this.normalize(item));
			return this.spliceNormalized(index, deleteCount, added);
		});
	}

	private spliceNormalized(
		index: number,
		deleteCount: number,
		added: T[]
	): T[] {
		const removed: T[] = [];
		for (let i = 0; i < deleteCount; i++) removed.push(this.proxy[index + i]);
		if (deleteCount || added.length) {
			this.update(added, removed, () =>
				super.spliceWithArray(index, deleteCount, added)
			);
		}
		return removed;
	}

	spliceItemsIntoValues(
		index: number,
		deleteCount: number,
		newItems: T[]
	): T[] {
		return Array.prototype.splice.call(
			this.source,
			index,
			deleteCount,
			...newItems
		) as T[];
	}
}
