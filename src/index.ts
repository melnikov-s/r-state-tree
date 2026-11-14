import "@tsmetadata/polyfill";
import Store, { createStore, updateStore } from "./store/Store.js";
import Model from "./model/Model.js";
import {
	mount,
	onSnapshot,
	toSnapshot,
	applySnapshot,
	onSnapshotDiff,
	findModelById,
} from "./api.js";
import { createContext } from "./context.js";
import { toObservableTree } from "./toObservableTree.js";

export {
	createStore,
	Store,
	Model,
	mount,
	updateStore,
	onSnapshot,
	onSnapshotDiff,
	toSnapshot,
	applySnapshot,
	findModelById,
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
} from "./observables/index.js";

export * from "./decorators.js";

export type {
	Configuration,
	Snapshot,
	SnapshotValue,
	IdType,
	SnapshotDiff,
	StoreSnapshot,
	StoreChildSnapshot,
} from "./types.js";
export type { Context } from "./context.js";
