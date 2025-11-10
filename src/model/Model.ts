import { getModelAdm, ModelAdministration } from "./ModelAdministration";
import type { Configuration, ModelConfiguration, Snapshot } from "../types";
import { createObservableWithCustomAdministration } from "../observables";

let initEnabled = false;

type ExtractModelDidInitArgs<T extends Model> = T extends {
	modelDidInit(...args: infer Args): unknown;
}
	? Args extends [infer Snapshot, ...infer Rest]
		? Rest
		: []
	: [];

export default class Model {
	static get types(): ModelConfiguration<unknown> {
		return (this as any)[Symbol.metadata];
	}

	static childTypes: object = {};

	static create<T extends Model = Model>(
		this: { new (...args: unknown[]): T },
		snapshot?: Snapshot<T>,
		...args: ExtractModelDidInitArgs<T>
	): T {
		let instance: T;
		try {
			initEnabled = true;
			instance = new this();
		} finally {
			initEnabled = false;
		}
		const adm = getModelAdm(instance);
		snapshot && adm.loadSnapshot(snapshot);
		instance.modelDidInit(snapshot, ...args);

		return instance;
	}

	constructor() {
		if (!initEnabled) {
			throw new Error(
				`r-state-tree: Can't initialize model directly, use \`${this.constructor.name}.create()\` instead`
			);
		}

		const observable = createObservableWithCustomAdministration(
			this,
			ModelAdministration
		);
		const adm = getModelAdm(observable);
		adm.setConfiguration(
			() =>
				((this.constructor as typeof Model).types as Configuration<this>) ?? {}
		);

		return observable;
	}

	get parent(): Model | null {
		return getModelAdm(this).parent?.proxy ?? null;
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	modelDidInit(snapshot?: Snapshot<this>, ...args: unknown[]): void {}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	modelDidAttach(): void {}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	modelWillDetach(): void {}
}
