import Store from "./store/Store";
import Model from "./model/Model";
import { reaction } from "lobx";

export type ReactionParams = [
	Parameters<typeof reaction>[0],
	Parameters<typeof reaction>[1]
];
export type ReactionReturn = ReturnType<typeof reaction>;

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
) => S) &
	{ [P in keyof Store]: Store[P] };

export type ChildModel = Model | Model[] | null;
export type IdType = string | number;

export enum CommonCfgTypes {
	child = "child",
	children = "children",
}

export enum ModelCfgTypes {
	state = "state",
	id = "id",
	modelRef = "modelRef",
	modelRefs = "modelRefs",
}

export enum StoreCfgTypes {
	model = "model",
}

export type ConfigurationTypes = CommonCfgTypes | ModelCfgTypes | StoreCfgTypes;

export type ConfigurationType = {
	type: ConfigurationTypes;
	childType?: Function;
	[key: string]: unknown;
};
export type ModelConfiguration<T> = Record<PropertyKey, ConfigurationType>;
export type StoreConfiguration<T> = Record<PropertyKey, ConfigurationType>;
export type Configuration<T> = ModelConfiguration<T> | StoreConfiguration<T>;
export type Snapshot<T = Model> = Record<string, unknown>;
export type SnapshotChange<T = Model> = (
	snapshot: Snapshot<T>,
	model: T
) => void;

export const childType = Object.assign(
	function (childType: Function): ConfigurationType {
		return { type: CommonCfgTypes.child, childType };
	},
	{ type: CommonCfgTypes.child }
);

export const childrenType = Object.assign(
	function (childType: Function): ConfigurationType {
		return { type: CommonCfgTypes.children, childType };
	},
	{ type: CommonCfgTypes.children }
);

export const stateType: ConfigurationType = {
	type: ModelCfgTypes.state,
};
export const modelRefType: ConfigurationType = {
	type: ModelCfgTypes.modelRef,
};
export const modelRefsType: ConfigurationType = {
	type: ModelCfgTypes.modelRefs,
};
export const idType: ConfigurationType = { type: ModelCfgTypes.id };
export const modelType: ConfigurationType = {
	type: StoreCfgTypes.model,
};
