# Core API and modeling

Use this reference when creating or reviewing Stores, Models, Store Context, snapshots, or low-level observables.

## Store and Model placement

| Concern                              | Owner        |
| ------------------------------------ | ------------ |
| Serializable domain data             | `Model`      |
| Domain invariants and mutations      | `Model`      |
| Identifiers and model references     | `Model`      |
| View/session state                   | `Store`      |
| Async orchestration, routing, timers | `Store`      |
| Mounted subscriptions/resources      | `Store`      |
| Tiny DOM/view-only state             | UI framework |

Models are inert serializable state trees. Stores are behavioral trees with mounted lifetimes. Referencing a Model from a Store does not make the Store a persistence boundary.

## Store creation

Create a root Store descriptor, then realize and mount it:

```ts
import { createStore, mount, Store } from "r-state-tree";

class SearchStore extends Store<{ initialQuery?: string }> {
	query = this.props.initialQuery ?? "";

	setQuery(query: string) {
		this.query = query;
	}
}

const search = mount(createStore(SearchStore, { initialQuery: "signals" }));
```

Never call `new SearchStore(...)`. Constructor props are available after `super(props)` and remain reactive.

Update realized Store props through the public helper:

```ts
import { updateStore } from "r-state-tree";

updateStore(search, { initialQuery: "state trees" });
```

## Child Stores

Define child Stores with `@child` or `static types`. A child getter returns descriptors, not realized Stores:

```ts
import { child, createStore, Store } from "r-state-tree";

class ItemStore extends Store<{ id: string }> {}

class ListStore extends Store<{ ids: string[] }> {
	@child get items() {
		return this.props.ids.map((id) => createStore(ItemStore, { key: id, id }));
	}
}
```

Use stable unique keys in child arrays. Child getters are lazy behavioral boundaries; never read one only to force construction or activate effects.

Pass Models and other dependencies as ordinary typed Store props unless a narrowly scoped Store Context is more appropriate. The current public API has no `@model` injection decorator and no special `models` prop bag.

## Store Context

Store Context passes ambient dependencies through the Store ownership tree:

```ts
import { child, createContext, createStore, Store } from "r-state-tree";

type ApiClient = { load(id: string, signal: AbortSignal): Promise<unknown> };
const ApiContext = createContext<ApiClient>();

class RootStore extends Store<{ api: ApiClient }> {
	[ApiContext.provide]() {
		return this.props.api;
	}

	@child get feature() {
		return createStore(FeatureStore);
	}
}

class FeatureStore extends Store {
	get api() {
		return ApiContext.consume(this);
	}
}
```

Use one source for a dependency. Do not alternate between an explicit prop and ambient Context for the same value. Store Context cannot be consumed by Models or arbitrary objects.

## Models and snapshots

Create Models with `Model.create()` and configure persisted fields with decorators or `static types`:

```ts
import { child, id, Model } from "r-state-tree";

class TodoModel extends Model {
	@id id = "";
	title = "";
	completed = false;

	complete() {
		this.completed = true;
	}
}

class TodoListModel extends Model {
	@child(TodoModel) todos: TodoModel[] = [];
}

const list = TodoListModel.create({
	todos: [{ id: "1", title: "Write tests", completed: false }],
});
```

Use named factories for normalization, identifier generation, migrations, or external formats; have them produce the canonical snapshot accepted by `create()`.

Use:

- `toSnapshot(model)` to serialize;
- `applySnapshot(model, snapshot)` to hydrate atomically;
- `onSnapshot(model, callback)` to observe snapshots;
- `onSnapshotDiff(model, callback)` for undo/redo diffs;
- `findModelById(root, ModelType, id)` for typed identifier lookup;
- `@modelRef(ModelType)` for references to attached Models of that exact type.

Models and Stores both support snapshots. Ordinary Model fields are included by
default; mark runtime-only Model fields with `@transient`. Store snapshots include
explicit `@snapshot` session/view fields and keyed reactive children. Hydrate via
`mount(createStore(Type), { snapshot })`, or with `applySnapshot(store, snapshot)`
before or after mounting (post-mount application reconciles children like any
reactive update).

## Observable behavior

Store and Model fields configured by r-state-tree are reactive. For standalone data structures use `observable()`.

`observable()` is shallow:

```ts
const state = observable({
	count: 0,
	nested: observable({ value: 1 }),
});
```

Mutate observable arrays, maps, sets, and objects in place. Copy-on-write is not required for reactivity. Derived collection methods such as `slice()` and `filter()` return plain containers while preserving element identity.

Use `toObservableTree()` for a one-time recursive wrap of existing nested plain objects and arrays. Later assignments remain shallow and are not auto-wrapped.

Use `source(value)` only to access backing data. It is not a recursive sanitizer and does not repair observables manually inserted into backing sources.
