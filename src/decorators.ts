import "@tsmetadata/polyfill";
import {
	childType,
	modelType,
	modelRefType,
	idType,
	stateType,
	childrenType,
	modelRefsType,
} from "./types";

function makeDecorator(type: unknown): any {
	return function <T>(value: T, context: DecoratorContext): T {
		context.metadata![context.name!] = type;

		return value;
	};
}

function makeChildDecorator(
	type?: typeof childType | typeof childrenType
): any {
	return function <T>(valueOrChildType: T, context?: DecoratorContext): any {
		// Direct use: @child
		if (context !== undefined) {
			return makeDecorator(type)(valueOrChildType, context);
		}

		// Factory use: @child(ChildType)
		const childType = valueOrChildType;
		return makeDecorator(type ? type(childType as Function) : type);
	};
}

export const child = makeChildDecorator(childType);
export const children = makeChildDecorator(childrenType);
export const model = makeDecorator(modelType);
export const modelRef = makeDecorator(modelRefType);
export const modelRefs = makeDecorator(modelRefsType);
export const identifier = makeDecorator(idType);
export const state = makeDecorator(stateType);
