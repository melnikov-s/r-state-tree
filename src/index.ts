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
	computed,
	source,
	reportChanged,
	reportObserved,
	getSignal,
	isObservable,
	reaction,
	Signal,
	type ReadonlySignal,
	batch,
	untracked,
	effect,
	Observable,
	signal,
} from "./observables";

export * from "./decorators";

export type { Configuration, Snapshot, IdType, SnapshotDiff } from "./types";
export type { Context } from "./context";
