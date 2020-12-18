import { ModelAdministration, getModelAdm } from "./ModelAdministration";
import { Configuration, Snapshot } from "../types";

let initEnabled = false;
export default class Model {
	static types: object = {};
	static childTypes: object = {};

	static create<T extends Model = Model>(
		this: { new (...args: unknown[]): T },
		snapshot?: Snapshot<T>,
		...args: unknown[]
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

		const config = (this.constructor as typeof Model).types as Configuration<
			this
		>;

		const adm = new ModelAdministration(this, config);

		return adm.proxy;
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
