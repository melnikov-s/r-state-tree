import Store from "./store/Store";
import Model from "./model/Model";

export type StoreElement = {
	Type: new (...args: unknown[]) => Store;
	props: Props;
	key: string | number;
};
export type ChildStore = Store | Store[] | null;
export type Key = string | number | undefined;
export type Context = { [key: string]: unknown };
export type Props = {
	[key: string]: unknown;
	key?: Key;
	models?: { [key: string]: Model | Model[] | null };
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
	state = "state",
	id = "id",
	modelRef = "modelRef",
}

export enum StoreCfgTypes {
	model = "model",
}

export enum ObservableCfgTypes {
	observable = "observable",
	computed = "computed",
}

export type ConfigurationTypes =
	| CommonCfgTypes
	| ModelCfgTypes
	| StoreCfgTypes
	| ObservableCfgTypes;

export type ConfigurationType = {
	type: ConfigurationTypes;
	childType?: Function;
	[key: string]: unknown;
};
export type ModelConfiguration<T> = Record<PropertyKey, ConfigurationType>;
export type StoreConfiguration<T> = Record<PropertyKey, ConfigurationType>;
export type Configuration<T> = ModelConfiguration<T> | StoreConfiguration<T>;

// Don't evaluate property types to avoid circular references
// Snapshot types are primarily for documentation - actual snapshot logic
// uses the configuration object, not TypeScript types
export type Snapshot<T extends Model = Model> = {
	[K in keyof T]?: T[K] extends Model
		? Snapshot<T[K]>
		: T[K] extends Array<infer R>
		? R extends Model
			? Array<Snapshot<R>>
			: T[K]
		: T[K] | null;
};

export type SnapshotDiff<T extends Model = Model> = {
	undo: Snapshot<T>;
	redo: Snapshot<T>;
};

export type SnapshotChange<T extends Model = Model> = (
	snapshot: Snapshot<T>,
	model: T
) => void;

export type RefSnapshot = { [key: string]: IdType; [key: number]: IdType };

export const childType = Object.assign(
	function (childType: Function): ConfigurationType {
		return { type: CommonCfgTypes.child, childType };
	},
	{ type: CommonCfgTypes.child }
);

export const stateType: ConfigurationType = {
	type: ModelCfgTypes.state,
};

export const modelRefType = Object.assign(
	function (childType: Function): ConfigurationType {
		return { type: ModelCfgTypes.modelRef, childType };
	},
	{ type: ModelCfgTypes.modelRef }
);

export const idType: ConfigurationType = { type: ModelCfgTypes.id };
export const modelType: ConfigurationType = {
	type: StoreCfgTypes.model,
};

export const observableType: ConfigurationType = {
	type: ObservableCfgTypes.observable,
};

export const computedType: ConfigurationType = {
	type: ObservableCfgTypes.computed,
};
