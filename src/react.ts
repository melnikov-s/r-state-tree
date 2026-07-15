import { useSignals } from "@preact/signals-react/runtime";
import {
	createContext,
	createElement,
	memo,
	useContext,
	type Context,
	type FunctionComponent,
	type ReactNode,
} from "react";

import type Store from "./store/Store";

export type StoreType<T extends Store = Store> = abstract new (
	...args: any[]
) => T;

export interface StoreProviderProps<T extends Store> {
	store: T;
	children?: ReactNode;
}

const storeContexts = new WeakMap<Function, Context<Store | null>>();

function getStoreContext<T extends Store>(
	StoreClass: StoreType<T>
): Context<T | null> {
	let context = storeContexts.get(StoreClass);

	if (!context) {
		context = createContext<Store | null>(null);
		context.displayName = `${StoreClass.name || "Store"}Context`;
		storeContexts.set(StoreClass, context);
	}

	return context as Context<T | null>;
}

/**
 * Makes a realized Store available to descendants by its exact runtime class.
 * This is a React lookup scope only; it does not mount, own, reparent, or
 * dispose the Store.
 */
export function StoreProvider<T extends Store>({
	store,
	children,
}: StoreProviderProps<T>): ReactNode {
	const StoreClass = store.constructor as StoreType<T>;
	const context = getStoreContext(StoreClass);

	return createElement(context.Provider, { value: store }, children);
}

/** Returns the nearest Store provided for the exact Store class. */
export function useOptionalStore<T extends Store>(
	StoreClass: StoreType<T>
): T | null {
	return useContext(getStoreContext(StoreClass));
}

/**
 * Returns the nearest Store provided for the exact Store class, or throws when
 * the component is outside a matching StoreProvider.
 */
export function useStore<T extends Store>(StoreClass: StoreType<T>): T {
	const store = useOptionalStore(StoreClass);

	if (store === null) {
		const name = StoreClass.name || "the requested Store class";
		throw new Error(
			`r-state-tree/react: No StoreProvider found for ${name}. ` +
				"Wrap this component tree in <StoreProvider store={...}>."
		);
	}

	return store;
}

/**
 * Makes a function component rerender when signals read during rendering
 * change. Store props are not provisioned and Store lifecycle is unaffected.
 */
export function observer<T extends FunctionComponent<any>>(Component: T): T {
	const ObservedComponent = memo(function RStateTreeObserver(
		props: Parameters<T>[0]
	) {
		const effectStore = useSignals(1);

		try {
			return Component(props);
		} finally {
			effectStore.f();
		}
	});

	ObservedComponent.displayName =
		Component.displayName || Component.name || "ObserverComponent";

	return ObservedComponent as unknown as T;
}
