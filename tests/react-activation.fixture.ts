import { child, createStore, mount, Store } from "../src";

type ResourceProps = {
	value: string;
	resources: {
		constructed: number;
		started: number;
		active: number;
		cleaned: number;
	};
};

class ResourceStore extends Store<ResourceProps> {
	constructor(props: ResourceStore["props"]) {
		super(props);
		const { resources } = props;
		resources.constructed++;
		this.effect(() => {
			resources.started++;
			resources.active++;
			return () => {
				resources.active--;
				resources.cleaned++;
			};
		});
	}

	get value() {
		return this.props.value;
	}
}

class RootStore extends Store<ResourceProps> {
	@child get resource() {
		return createStore(ResourceStore, {
			value: this.props.value,
			resources: this.props.resources,
		});
	}
}

export function activationFixture(value = "child") {
	// Plain counters deliberately do not subscribe React or the Store effect.
	const resources = { constructed: 0, started: 0, active: 0, cleaned: 0 };
	const store = mount(createStore(RootStore, { value, resources }));
	return { store, RootStore, resources };
}
