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
export type ModelConfiguration<T> = Record<keyof T, any>;

export type StoreConfiguration<T> = Record<keyof T, any>;
export type Configuration<T> = ModelConfiguration<T> | StoreConfiguration<T>;
