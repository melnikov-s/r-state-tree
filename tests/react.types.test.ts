import { createElement } from "react";

import { Store } from "../src";
import {
	observer,
	StoreProvider,
	useOptionalStore,
	useStore,
} from "../src/react";

class TypedStore extends Store<{ label: string }> {}

const Component = ({ label, count = 0 }: { label: string; count?: number }) =>
	createElement("span", null, `${label}:${count}`);
const ObservedComponent = observer(Component);

createElement(ObservedComponent, { label: "valid" });
createElement(ObservedComponent, { label: "valid", count: 1 });

// @ts-expect-error label remains required after wrapping with observer.
createElement(ObservedComponent, {});

// @ts-expect-error count remains a number after wrapping with observer.
createElement(ObservedComponent, { label: "invalid", count: "one" });

declare const store: TypedStore;
createElement(StoreProvider, { store }, createElement("span"));

function StoreConsumer() {
	const required: TypedStore = useStore(TypedStore);
	const optional: TypedStore | null = useOptionalStore(TypedStore);

	return createElement(
		"span",
		null,
		required.props.label,
		optional?.props.label
	);
}

void StoreConsumer;
