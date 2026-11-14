import { ArrayAdministration, getSource, batch } from "../observables/index.js";
import { getAdministration } from "../observables/internal/lookup.js";
import Model from "./Model.js";

function isIndex(name: PropertyKey): boolean {
	if (typeof name !== "string") return false;
	const index = Number(name);
	return (
		Number.isInteger(index) &&
		index >= 0 &&
		index < 2 ** 32 - 1 &&
		String(index) === name
	);
}

export class ChildModelsAdministration<
	T extends Model,
> extends ArrayAdministration<T> {
	private members = new Set<T>();
	private mutating = false;
	// The owner validates before commit, then publishes ownership in the same batch.
	change?: (added: T[], removed: T[], commit: () => void) => void;

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
			return adm.transaction(
				() => ArrayAdministration.methods.reverse!.call(this) as T[]
			);
		},
		sort<T extends Model>(this: T[], compareFn?: (a: T, b: T) => number): T[] {
			const adm = getAdministration(this) as ChildModelsAdministration<T>;
			return adm.transaction(
				() => ArrayAdministration.methods.sort!.call(this, compareFn) as T[]
			);
		},
	});

	assertMutable(): void {
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
