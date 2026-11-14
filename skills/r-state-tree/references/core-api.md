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

Every `createStore()` call returns a fresh descriptor, despite its Store-shaped TypeScript return type. The `@child` wrapper reconciles descriptors into realized instances; matching keys and compatible Store types preserve identity only within that parent's child property. `mount()` realizes roots. Do not read state or call methods on descriptors.

Use stable unique keys in child arrays. Child getters are lazy behavioral boundaries; never read one only to force construction or activate effects.

Pass Models and other dependencies as ordinary typed Store props unless a narrowly scoped Store Context is more appropriate. The current public API has no `@model` injection decorator and no special `models` prop bag.

Place presentation reads in the actual consumer, not in shared child descriptors. Pass a Model or a callback when it narrows dependencies; descriptor prop getters are copied as values, not retained as lazy getters. See [reactive dependency placement](../SKILL.md#read-reactive-state-at-the-consumer).

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

Prefer typed props for local or reusable inputs; use Context for ambient subtree dependencies and scoped overrides. Neither is required merely because several Stores need a value. Avoid competing implicit sources for the same dependency. Store Context cannot be consumed by Models or arbitrary objects.

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

Model children loaded from snapshots require a runtime constructor: `@child(TodoModel)` or `child(TodoModel)` in `static types`. Bare `@child` can attach already-created Models, but type annotations do not supply constructors.

Use named factories for normalization, identifier generation, migrations, or external formats; have them produce the canonical snapshot accepted by `create()`.

Use:

- `toSnapshot(model)` to serialize;
- `applySnapshot(model, snapshot)` to hydrate with batched notifications and rollback on load failure (not an identity-preserving transaction);
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

Ordinary public Store and Model fields are observable at the assignment level:
reading a field in a tracked context subscribes to it, and assigning the field
notifies observers. ES `#private` fields are not independently tracked.

Assignment never converts the assigned value. This is deliberately different from
MobX's default deep conversion: a plain array or object stored in a field — whether
assigned later or initialized inline — is an **inert** value. Mutating it in place
(`push`, `splice`, index/key writes, property writes) notifies no one. Mutable
Store/Model arrays, objects, Maps, and Sets must be initialized with `observable()`
and mutated directly in place. Use `toObservableTree()` for initial nested wrapping;
Model `@child` collections have their own reactive administration. Do not turn
mutations into copy-and-reassign updates merely to pass lint.

```ts
import { observable, Store } from "r-state-tree";

class SessionsStore extends Store {
	// Observable container; push/splice/index writes are tracked.
	ids: string[] = observable([]);

	trustedPaths: string[] = observable([]);

	trust(path: string) {
		this.trustedPaths.push(path);
	}
}
```

When reviewing mutable Store/Model fields, fix plain collection mutations by
wrapping their initialization, not by replacing the mutation with spread/`slice()`
assignment. Whole-field replacement is legitimate for intentionally immutable value
models; copies are also appropriate at genuine ownership, snapshot, or transport
boundaries. Plain derived/read-only collections need not be observable. Standalone
mutable data structures that need reactive tracking use `observable()`.

`observable()` is shallow:

```ts
const state = observable({
	count: 0,
	nested: observable({ value: 1 }),
});
```

Items inserted into an observable container are not wrapped: an observable array of
plain objects tracks the array's structure (length, index, iteration) but not the
objects' fields. Wrap an item with `observable()` (or `toObservableTree()`) before
inserting it if its fields will be mutated in place.

Mutate observable arrays, maps, sets, and objects in place in authoritative methods/callbacks, never in getters/computeds. Keep derivations pure: they may construct and mutate fresh local results, but must not change existing/external state, including shared elements of shallow copies. Derived collection methods such as `slice()` and `filter()` return plain containers while preserving element identity; the derivation itself is tracked, but the returned copy is not a live container.

Use `toObservableTree()` for a one-time recursive wrap of existing nested plain objects and arrays. Later assignments remain shallow and are not auto-wrapped.

Use `source(value)` only to access backing data. It is not a recursive sanitizer and does not repair observables manually inserted into backing sources.
