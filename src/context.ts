import { getAdministration } from "./observables";
import type Model from "./model/Model";
import type Store from "./store/Store";

// Unique symbol to identify Context objects
const CONTEXT_SYMBOL = Symbol("context");
const HAS_DEFAULT = Symbol("hasDefault");

export interface Context<T> {
	readonly [CONTEXT_SYMBOL]: symbol;
	readonly [HAS_DEFAULT]: boolean;
	readonly defaultValue: T | undefined;
	readonly provide: symbol;
	consume(instance: Model | Store): T;
}

export function createContext<T>(defaultValue?: T): Context<T> {
	const provideSymbol = Symbol("provide");
	const contextId = Symbol("contextId");
	const hasDefault = arguments.length > 0;

	return {
		[CONTEXT_SYMBOL]: contextId,
		[HAS_DEFAULT]: hasDefault,
		defaultValue,
		provide: provideSymbol,
		consume(instance: Model | Store): T {
			const adm = getAdministration(instance) as any;
			if (!adm || typeof adm.getContextValue !== "function") {
				throw new Error("Context can only be consumed in Models or Stores");
			}
			return adm.getContextValue(
				contextId,
				provideSymbol,
				defaultValue,
				hasDefault
			) as T;
		},
	};
}
