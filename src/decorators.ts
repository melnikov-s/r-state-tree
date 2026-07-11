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
		const typeWithCtor = (typeObj as Function)(childCtor);
		const decorator = function <T>(value: T, context: DecoratorContext): T {
			return makeDecorator(typeWithCtor)(value, context);
		};
		// Allow using `child(ChildCtor)` / `modelRef(ModelCtor)` in `static types`.
		// We only attach the minimum metadata needed to resolve the entry.
		(decorator as any).type = (typeWithCtor as any)?.type;
		(decorator as any).childType = childCtor as any;
		return decorator;
	};
}

export const child = makeChildDecorator(childType);
const modelRefDecorator = makeChildDecorator(modelRefType);
export function modelRef<T extends Function>(childCtor: T): any;
export function modelRef<T extends Function>(
	childCtor: T,
	context?: DecoratorContext
): any {
	if (context !== undefined) {
		throw new Error(
			"r-state-tree: @modelRef requires a model constructor, for example `@modelRef(User)`"
		);
	}
	return modelRefDecorator(childCtor);
}
export const model = makeDecorator(modelType);
export const id = makeDecorator(idType);
export const state = makeDecorator(stateType);
