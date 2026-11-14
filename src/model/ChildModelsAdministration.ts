import { ArrayAdministration, getSource, batch } from "../observables";
import { getAdministration } from "../observables/internal/lookup";

const listenerMap: WeakMap<object, ObservableListener<unknown>> = new WeakMap();

export function notifyArrayUpdate<T>(
	arr: T[],
	index: number,
	oldValue: T,
	newValue: T
): void {
	listenerMap.get(arr)?.notify({
		object: arr,
		type: "updateArray",
		index,
		oldValue,
		newValue,
	});
}

export function notifySpliceArray<T>(
	arr: T[],
	index: number,
	added: T[],
	removed: T[]
): void {
	listenerMap.get(arr)?.notify({
		object: arr,
		type: "spliceArray",
		index,
		added,
		removed,
	});
}

export function observe<T>(
	obj: object,
	method: MutationListener<T>
): () => void {
	let listener = listenerMap.get(obj) as ObservableListener<unknown>;

	if (!listener) {
		listener = new ObservableListener<unknown>();
		listenerMap.set(obj, listener);
	}

	return listener.subscribe(method as MutationListener<unknown>);
}

export type UpdateArrayEvent<T> = {
	object: T[];
	type: "updateArray";
	index: number;
	oldValue: T;
	newValue: T;
};

export type SpliceArrayEvent<T> = {
	object: T[];
	type: "spliceArray";
	index: number;
	added: T[];
	removed: T[];
};

export type MutationEvent<T> = UpdateArrayEvent<T> | SpliceArrayEvent<T>;

export type MutationListener<T> = (ev: MutationEvent<T>) => void;
export type HasListener<T> = {
	listener: ObservableListener<T>;
};

class ObservableListener<T> {
	private listeners: MutationListener<T>[] | undefined;
	private notifying: boolean = false;

	subscribe(l: MutationListener<T>): () => void {
		let unsubed = false;

		this.listeners = this.listeners || [];

		this.listeners.push(l);

		return (): void => {
			if (!unsubed) {
				if (this.notifying) {
					throw new Error(
						"Can't unsubscribe from observer during notification"
					);
				}
				const idx = this.listeners?.indexOf(l);
				if (idx != null && idx !== -1) this.listeners!.splice(idx, 1);
				unsubed = true;
			}
		};
	}

	get size(): number {
		return this.listeners?.length ?? 0;
	}

	notify(ev: MutationEvent<T>): void {
		if (!this.listeners) return;

		this.notifying = true;
		try {
			for (let i = 0; i < this.listeners.length; i++) {
				this.listeners[i](ev);
			}
		} finally {
			this.notifying = false;
		}
	}
}

export class ChildModelsAdministration<T> extends ArrayAdministration<T> {
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
	});

	setArrayLength(): never {
		throw new TypeError(
			"r-state-tree: child array length is read-only; use splice() to remove children"
		);
	}

	set(index: number, newValue: T): boolean {
		if (index > this.source.length)
			throw new RangeError("r-state-tree: child arrays cannot contain holes");
		newValue = (getAdministration(newValue as object)?.proxy as T) ?? newValue;
		if (index === this.source.length) {
			this.spliceWithArray(index, 0, [newValue]);
			return true;
		}
		return batch(() => {
			const oldValue = this.source[index];
			const result = super.set(index, newValue);

			const sourceValue = getSource(newValue);
			if (oldValue !== sourceValue) {
				try {
					notifyArrayUpdate(this.proxy, index, oldValue, sourceValue);
				} catch (error) {
					super.set(
						index,
						(getAdministration(oldValue as object)?.proxy as T) ?? oldValue
					);
					throw error;
				}
			}
			return result;
		});
	}

	spliceWithArray(
		index: number,
		deleteCount?: number | undefined,
		newItems?: T[] | undefined
	): T[] {
		const argumentCount = arguments.length;
		return batch(() => {
			// Keep the normalized index for rollback after a length-changing splice.
			const start = Math.trunc(+index) || 0;
			index =
				start < 0
					? Math.max(this.source.length + start, 0)
					: Math.min(start, this.source.length);
			const deleted =
				argumentCount === 1
					? super.spliceWithArray(index)
					: super.spliceWithArray(index, deleteCount, newItems);
			if (deleted.length || newItems?.length) {
				try {
					notifySpliceArray(this.proxy, index, newItems ?? [], deleted);
				} catch (error) {
					super.spliceWithArray(index, newItems?.length ?? 0, deleted);
					throw error;
				}
			}

			return deleted;
		});
	}
}
