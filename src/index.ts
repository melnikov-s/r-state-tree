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
import { toObservableTree } from "./toObservableTree";

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
	toObservableTree,
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
	signal,
	Observable,
} from "./observables";

export * from "./decorators";

export type {
	Configuration,
	Snapshot,
	SnapshotValue,
	IdType,
	SnapshotDiff,
} from "./types";
export type { Context } from "./context";
