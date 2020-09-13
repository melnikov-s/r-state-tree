import Store from "./store/Store";
import { type } from "lobx";
import Model from "./model/Model";
import {
	childType,
	modelType,
	modelRefType,
	idType,
	stateType,
	childrenType,
	modelRefsType,
} from "./types";

function makeDecorator(type: unknown, optType: unknown = type): any {
	return function (...args: unknown[]) {
		if (args.length === 1) {
			return makeDecorator((optType as Function)(args[0]));
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

export const action = makeDecorator(type.action({ async: true }), type.action);
export const computed = makeDecorator(type.computed);
export const observable = makeDecorator(type.observable);
export const child = makeDecorator(childType);
export const children = makeDecorator(childrenType);
export const model = makeDecorator(modelType);
export const modelRef = makeDecorator(modelRefType);
export const modelRefs = makeDecorator(modelRefsType);
export const identifier = makeDecorator(idType);
export const state = makeDecorator(stateType);
