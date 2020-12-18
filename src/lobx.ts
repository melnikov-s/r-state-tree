import * as lobx from "lobx";

export const graph = lobx.graph();
export const graphOptions = { graph };

graph.enforceActions(true);

export function autorun(fn: (listener: Listener) => void): () => void {
	return lobx.autorun(fn, graphOptions);
}

export function reaction<T>(
	track: () => T,
	callback: (a: T, listener: Listener) => void
): () => void {
	return lobx.reaction(track, callback, graphOptions);
}

export function runInAction<T>(fn: () => T): T {
	return graph.runInAction(fn);
}

export function listener(callback: () => void): lobx.Listener {
	return lobx.listener(callback, graphOptions);
}

export function task<T>(promise: Promise<T>): Promise<T> {
	return graph.task(promise);
}

export type Listener = lobx.Listener;
export const isObservable = lobx.isObservable;
