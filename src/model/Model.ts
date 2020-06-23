import { ModelAdministration, getModelAdm } from "./ModelAdministration";
import { Configuration } from "../types";

export default class Model {
	static types: unknown = {};

	constructor() {
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
	modelDidMount(): void {}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	modelWillUnmount(): void {}
}
