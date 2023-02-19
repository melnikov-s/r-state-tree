import { createGraph } from "nu-observables";
import {
	AtomNode,
	batch,
	ComputedNode,
	isInAction,
	isTracking,
	onObservedStateChange,
	runInAction,
	ListenerNode,
	enforceActions
} from "nu-reactive-graph";

enforceActions(true);

export function listener(
	callback: (listener: ListenerNode) => void
): ListenerNode {
	return new ListenerNode(callback);
}

export function reaction<T>(
	track: () => T,
	callback: (a: T, listener: ListenerNode) => void
): () => void {
	let value: T;

	const l = listener(() => {
		const newValue = l.track(track);

		if (newValue !== value) {
			value = newValue;
			callback(value, l);
		}
	});

	value = l.track(track);

	return function (): void {
		l.dispose();
	};
}

export function effect(callback: (t: ListenerNode) => void): () => void {
	const boundCallback: () => void = () => callback.call(null, l);

	const l = listener(() => {
		l.track(boundCallback);
	});

	l.track(boundCallback);

	return function (): void {
		l.dispose();
	};
}

export function createComputed<T>(
	fn: () => T,
	context: unknown = null,
	keepAlive = false
): ComputedNode<T> {
	return new ComputedNode(fn, undefined, keepAlive, context);
}

export {
	batch,
	runInAction,
	isTracking,
	ComputedNode,
	ListenerNode,
	Signal,
	untracked,
	AtomNode,
	task,
} from "nu-reactive-graph";

export const graph = createGraph({
	createAtom() {
		return new AtomNode();
	},
	createComputed(fn, context) {
		return createComputed(fn, context);
	},
	batch,
	runInAction(fn) {
		return runInAction(fn, false);
	},
	isTracking,
	onObservedStateChange,
	effect,
	isInAction,
});
