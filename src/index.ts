import "@tsmetadata/polyfill";
import Store, { createStore, updateStore } from "./store/Store";
import Model from "./model/Model";
import {
	mount,
	unmount,
	onSnapshot,
	toSnapshot,
	applySnapshot,
	onSnapshotDiff,
} from "./api";
import { createContext } from "./context";

export {
	createStore,
	Store,
	Model,
	mount,
	unmount,
	updateStore,
	onSnapshot,
	onSnapshotDiff,
	toSnapshot,
	applySnapshot,
	createContext,
};

export {
	observable,
	source,
	reportChanged,
	reportObserved,
	getSignal,
	isObservable,
	createSignal,
	createAtom,
	createComputed,
	createReaction,
	createListener,
	runInBatch,
	runInUntracked,
	createEffect,
	Observable,
} from "./observables";

export * from "./decorators";

export type { Configuration, Snapshot, IdType, SnapshotDiff } from "./types";
export type { Context } from "./context";
