/// <reference types="r-state-tree/devtools/vite/client" />
import { token } from "virtual:r-state-tree-inspector";
import {
	Store,
	Model,
	createStore,
	mount,
	toSnapshot,
	type Snapshot,
	child,
	id,
	computed,
} from "r-state-tree";

class Item extends Model {
	@id accessor id = "item";
}

class Counter extends Store {
	@child(Item) accessor item!: Item;

	@computed get label(): string {
		return this.item.id;
	}
}

const store = mount(createStore(Counter));
const disposable: Disposable = store;
disposable[Symbol.dispose]();
const snapshot: Snapshot<Item> = toSnapshot(Item.create());
const relayToken: string = token;
void relayToken;
void snapshot;
