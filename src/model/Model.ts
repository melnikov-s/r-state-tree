import { getModelAdm, ModelAdministration } from "./ModelAdministration";
import type { Configuration, ModelConfiguration, Snapshot } from "../types";
import { createObservableWithCustomAdministration } from "../observables";
import { getConfigurationForCtor } from "../configuration";

let initEnabled = false;

export default class Model implements Disposable {
	declare static types?: ModelConfiguration<unknown>;

	static childTypes: object = {};

	static create<T extends Model = Model>(
		this: { new (...args: unknown[]): T },
		snapshot?: Snapshot<T>
	): T {
		let instance: T;
		try {
			initEnabled = true;
			instance = new this();
		} finally {
			initEnabled = false;
		}
		const adm = getModelAdm(instance);
		try {
			snapshot && adm.loadSnapshot(snapshot);
		} catch (error) {
			adm.dispose(true);
			throw error;
		}

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
				(getConfigurationForCtor(
					this.constructor as unknown as Function
				) as Configuration<this>) ?? {}
		);

		return observable;
	}

	get parent(): Model | null {
		return getModelAdm(this).parent?.proxy ?? null;
	}

	reaction<T>(
		track: () => T,
		callback: (value: T, previousValue: T) => void
	): () => void {
		return getModelAdm(this).reaction(track, callback);
	}

	effect(callback: () => void | (() => void)): () => void {
		return getModelAdm(this).effect(callback);
	}

	[Symbol.dispose](): void {
		getModelAdm(this).dispose();
	}
}
