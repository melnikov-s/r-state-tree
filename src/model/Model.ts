import { getModelAdm, ModelAdministration } from "./ModelAdministration.js";
import type { ModelConfiguration, Snapshot } from "../types.js";
import { registerAdministration } from "../observables/index.js";

let initEnabled = false;

/** @internal Shared creation helper; allows skipping nested untracked/batch when already inside one. */
export function createModelInstance<T extends Model>(
	Ctor: { new (...args: unknown[]): T },
	snapshot: Snapshot<T> | undefined,
	inUntrackedBatch: boolean,
	undo?: (() => void)[]
): T {
	const prevInit = initEnabled;
	let instance: T;
	try {
		initEnabled = true;
		instance = new Ctor();
	} finally {
		initEnabled = prevInit;
	}
	const modelAdm = getModelAdm(instance);
	modelAdm._constructing = false;
	try {
		modelAdm.validateSnapshotFields();
		if (snapshot) {
			if (inUntrackedBatch) {
				modelAdm.loadSnapshotInBatch(snapshot, undo);
			} else {
				modelAdm.loadSnapshot(snapshot, undo);
			}
		}
	} catch (error) {
		modelAdm.dispose(true);
		throw error;
	}

	return instance;
}

export default class Model implements Disposable {
	declare static types?: ModelConfiguration<unknown>;

	static childTypes: object = {};

	static create<T extends Model = Model>(
		this: { new (...args: unknown[]): T },
		snapshot?: Snapshot<T>
	): T {
		return createModelInstance(this, snapshot, false);
	}

	constructor() {
		if (!initEnabled) {
			throw new Error(
				`r-state-tree: Can't initialize model directly, use \`${this.constructor.name}.create()\` instead`
			);
		}

		const adm = registerAdministration(new ModelAdministration(this));
		adm.setCtor(this.constructor as unknown as Function);
		adm._constructing = true;

		return adm.proxy;
	}

	get parent(): Model | null {
		return getModelAdm(this).parent?.proxy ?? null;
	}

	[Symbol.dispose](): void {
		getModelAdm(this).dispose();
	}
}
