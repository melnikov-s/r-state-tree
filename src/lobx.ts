import * as lobx from "lobx";

export const graph = lobx.graph();
export const graphOptions = { graph };

graph.enforceActions(true);

export function autorun(
	fn: Parameters<typeof lobx.autorun>[0]
): ReturnType<typeof lobx.autorun> {
	return lobx.autorun(fn, graphOptions);
}

export function reaction(
	track: Parameters<typeof lobx.reaction>[0],
	callback: Parameters<typeof lobx.reaction>[1]
): ReturnType<typeof lobx.autorun> {
	return lobx.reaction(track, callback, graphOptions);
}

export function listener(
	callback: Parameters<typeof lobx.listener>[0]
): ReturnType<typeof lobx.listener> {
	return lobx.listener(callback, graphOptions);
}

export type Listener = lobx.Listener;
export const isObservable = lobx.isObservable;
export function task<T>(p: Promise<T>): Promise<T> {
	return lobx.task(p, graphOptions);
}
