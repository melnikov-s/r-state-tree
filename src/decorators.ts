/* eslint-disable @typescript-eslint/no-explicit-any */
import Store from "./store/Store";
import { type } from "lobx";
import { graph } from "./lobx";
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

function makeDecorator(
	type: unknown,
	asMethod = (val: unknown) => makeDecorator((type as Function)(val))
): any {
	return function (...args: unknown[]) {
		if (args.length === 1) {
			return asMethod(args[0]);
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

export const child = makeDecorator(childType);
export const children = makeDecorator(childrenType);
export const model = makeDecorator(modelType);
export const modelRef = makeDecorator(modelRefType);
export const modelRefs = makeDecorator(modelRefsType);
export const identifier = makeDecorator(idType);
export const state = makeDecorator(stateType);

const taskMethod = makeDecorator(type.task, (fn) =>
	graph.task(fn as Promise<unknown>)
);
export function task<T>(val: T): T;
export function task(...args: any[]): any;
export function task(...args: unknown[]) {
	return taskMethod(...args);
}
