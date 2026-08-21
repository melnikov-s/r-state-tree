import type Store from "./store/Store";
import type Model from "./model/Model";
import type { Signal } from "@preact/signals-core";

export type StoreElement = {
	Type: new (...args: unknown[]) => Store;
	props: Props;
	key: string | number;
	/** Snapshot stashed by applySnapshot before instantiation; consumed by mount(). */
	snapshot?: StoreSnapshot;
};
export type ChildStore = Store | Store[] | null;
export type Key = string | number | undefined;
export type Context = { [key: string]: unknown };
export type Props = {
	[key: string]: unknown;
	key?: Key;
};
export type StoreProps<T extends Record<string, any> = Record<string, any>> =
	T & {
		[key: string]: unknown;
		key?: Key;
	};
export type StoreCtor<S extends Store = Store> = (new (
	...args: ConstructorParameters<typeof Store>
) => S) & { [P in keyof Store]: Store[P] };

export type ChildModel = Model | Model[] | null;
export type IdType = string | number;

export enum CommonCfgTypes {
	child = "child",
}

export enum ModelCfgTypes {
	transient = "transient",
	id = "id",
	modelRef = "modelRef",
}

export enum StoreCfgTypes {
	snapshot = "snapshot",
}

export enum ObservableCfgTypes {
	computed = "computed",
}

export type ConfigurationTypes =
	| CommonCfgTypes
	| ModelCfgTypes
	| StoreCfgTypes
	| ObservableCfgTypes;

export type ConfigurationValue = {
	type: ConfigurationTypes;
	childType?: Function;
	[key: string]: unknown;
};

// Configuration entries can be plain objects or callable (e.g. childType/modelRefType)
// or decorator-like functions that will be resolved at runtime.
export type ConfigurationType = ConfigurationValue | Function;
export type ModelConfiguration<T> = Record<PropertyKey, ConfigurationType>;
export type StoreConfiguration<T> = Record<PropertyKey, ConfigurationType>;
export type Configuration<T> = ModelConfiguration<T> | StoreConfiguration<T>;

/**
 * Types that are explicitly rejected in snapshots.
 * Runtime guards enforce this; implicit Model snapshot fields and Store
 * `@snapshot` fields containing these values throw on `toSnapshot()`.
 */
type NonSnapshotable =
	| Map<unknown, unknown>
	| Set<unknown>
	| WeakMap<object, unknown>
	| WeakSet<object>
	| RegExp
	| Error
	| Promise<unknown>;

/**
 * Converts a type to its snapshot representation.
 *
 * Snapshot contract:
 * - Supported JavaScript primitives pass through, including undefined and
 *   non-finite numbers. Applications choose their own transport codec.
 * - Arrays are recursively converted.
 * - Plain objects are recursively converted (see note below).
 * - Date → string (ISO format).
 * - Signal<T> → SnapshotValue<T> (unwraps to the signal's value type, recursively converted).
 * - Model → Snapshot<Model>.
 * - Map/Set/WeakMap/WeakSet/RegExp/Error/Promise/bigint/symbol/function → never (rejected at runtime).
 *
 * Note: TypeScript cannot fully enforce the "plain object" constraint at compile time.
 * This type models object recursion for Record/object types, but runtime guards will
 * reject class instances and other non-plain objects with a descriptive error.
 */
export type SnapshotValue<T> = T extends bigint | symbol | Function
	? never // Rejected at runtime; never here causes type errors
	: T extends NonSnapshotable
	? never // Rejected at runtime; never here causes type errors
	: T extends Signal<infer U>
	? SnapshotValue<U> // Signals unwrap to their value type
	: T extends Model
	? Snapshot<T>
	: T extends Date
	? string // Dates serialize to ISO strings
	: T extends Array<infer R>
	? R extends Model
		? Array<Snapshot<R>>
		: Array<SnapshotValue<R>>
	: T extends object
	? { [K in keyof T]: SnapshotValue<T[K]> } // Recursively convert object properties
	: T;

export type Snapshot<T extends Model = Model> = {
	[K in keyof T]?: SnapshotValue<T[K]> | null;
};

export type SnapshotDiff<T extends Model = Model> = {
	undo: Snapshot<T>;
	redo: Snapshot<T>;
};

export type SnapshotChange<T extends Model = Model> = (
	snapshot: Snapshot<T>,
	model: T
) => void;

export type StoreSnapshot = {
	state: Record<string, unknown>;
	children: Record<string, StoreChildSnapshot | StoreChildSnapshot[] | null>;
};

export type StoreChildSnapshot = StoreSnapshot & {
	key?: string | number;
};

export type StoreSnapshotChange<T extends Store = Store> = (
	snapshot: StoreSnapshot,
	store: T
) => void;

export type RefSnapshot = { [key: string]: IdType; [key: number]: IdType };

export const childType = Object.assign(
	function (childType: Function): ConfigurationValue {
		return { type: CommonCfgTypes.child, childType };
	},
	{ type: CommonCfgTypes.child }
);

export const transientType: ConfigurationValue = {
	type: ModelCfgTypes.transient,
};

export const snapshotType: ConfigurationValue = {
	type: StoreCfgTypes.snapshot,
};

export const modelRefType = Object.assign(
	function (childType: Function): ConfigurationValue {
		return { type: ModelCfgTypes.modelRef, childType };
	},
	{ type: ModelCfgTypes.modelRef }
);

export const idType: ConfigurationValue = { type: ModelCfgTypes.id };
export const computedType: ConfigurationValue = {
	type: ObservableCfgTypes.computed,
};
