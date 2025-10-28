import "@tsmetadata/polyfill";
import { childType, modelType, modelRefType, idType, stateType } from "./types";

function makeDecorator(type: unknown): any {
	return function <T>(value: T, context: DecoratorContext): T {
		context.metadata![context.name!] = type;
		return value;
	};
}

// Unified decorator that supports both @child and @child(Type) syntax
function makeChildDecorator(typeObj: any): any {
	return function <T>(valueOrChildType: T, context?: DecoratorContext): any {
		// Direct use: @child
		if (context !== undefined) {
			return makeDecorator(typeObj)(valueOrChildType, context);
		}

		// Factory use: @child(ChildType)
		const childCtor = valueOrChildType;
		return function <T>(value: T, context: DecoratorContext): T {
			const typeWithCtor = (typeObj as Function)(childCtor);
			return makeDecorator(typeWithCtor)(value, context);
		};
	};
}

export const child = makeChildDecorator(childType);
export const modelRef = makeChildDecorator(modelRefType);
export const model = makeDecorator(modelType);
export const identifier = makeDecorator(idType);
export const state = makeDecorator(stateType);
