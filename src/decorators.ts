import Store from "./store/Store";
import { type } from "lobx";
import Model from "./model/Model";

function makeDecorator(type: unknown): any {
	return function (...args: unknown[]) {
		if (args.length === 1) {
			return makeDecorator((type as Function)(args[0]));
		} else {
			const [target, propertyKey, descriptor] = args as [
				object,
				PropertyKey,
				PropertyDescriptor
			];
			const Ctor = target.constructor as typeof Store;
			if (Ctor.types === Store.types || Ctor.types === Model.types) {
				Ctor.types = {};
			}

			(Ctor.types as any)[propertyKey] = type;

			return descriptor;
		}
	};
}

export const action = makeDecorator(type.action);
export const computed = makeDecorator(type.computed);
export const observable = makeDecorator(type.observable);
export const child = makeDecorator("child");
export const children = makeDecorator("children");
export const model = makeDecorator("model");
export const modelRef = makeDecorator("modelRef");
export const modelRefs = makeDecorator("modelRefs");
export const identifier = makeDecorator("id");
