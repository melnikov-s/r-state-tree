import { getAdministration } from "./observables";
import type Store from "./store/Store";

// Unique symbol to identify Context objects
const CONTEXT_SYMBOL = Symbol("context");
const HAS_DEFAULT = Symbol("hasDefault");

export interface Context<T> {
	readonly [CONTEXT_SYMBOL]: symbol;
	readonly [HAS_DEFAULT]: boolean;
	readonly defaultValue: T;
	readonly provide: symbol;
	consume(store: Store): T;
}

export function createContext<T>(): Context<T | undefined>;
export function createContext<T>(defaultValue: T): Context<T>;
export function createContext<T>(defaultValue?: T): Context<T | undefined> {
	const provideSymbol = Symbol("provide");
	const contextId = Symbol("contextId");
	const hasDefault = arguments.length > 0;

	return {
		[CONTEXT_SYMBOL]: contextId,
		[HAS_DEFAULT]: hasDefault,
		defaultValue,
		provide: provideSymbol,
		consume(store: Store): T | undefined {
			const adm = getAdministration(store) as any;
			if (!adm || typeof adm.getContextValue !== "function") {
				throw new Error("r-state-tree: Context can only be consumed by Stores");
			}
			return adm.getContextValue(
				contextId,
				provideSymbol,
				defaultValue,
				hasDefault
			) as T | undefined;
		},
	};
}
