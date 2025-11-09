# r-state-tree

r-state-tree is a reactive state management library for building complex applications by moving state out of your render tree.

- Stores hold application/view state as a tree and drive your UI.
- Models hold domain state as a separate tree with snapshots, identifiers and references.
- Views become dumb renderers that react to Stores/Models.

## Installation

```bash
pnpm add r-state-tree
```

### Requirements

This library uses [TC39 Stage 3 Decorators](https://github.com/tc39/proposal-decorators) and requires TypeScript 5.0+ with `target: "es2022"` or higher.

The library includes a decorator metadata polyfill for runtimes that don't yet natively support `Symbol.metadata`.

## TypeScript config (Stage 3 decorators)

TypeScript 5+ supports TC39 Stage 3 decorators.

```json
{
	"compilerOptions": {
		"target": "es2022",
		"module": "esnext",
		"moduleResolution": "bundler",
		"strict": true,
		"experimentalDecorators": false,
		"useDefineForClassFields": true,
		"lib": ["es2022", "dom"],
		"jsx": "react-jsx",
		"noEmit": true
	}
}
```

- `experimentalDecorators` must be `false` for Stage 3 decorators.
- `useDefineForClassFields: true` is recommended with modern toolchains targeting ES2022.
- The library includes a `Symbol.metadata` polyfill via `@tsmetadata/polyfill`.

## Core concepts

- Stores: application/view state containers. Create with `createStore()`, attach with `mount()`. Compose with `@child` (single or arrays, stable via `{ key }`). React to changes with `effect`/`reaction` and store lifecycles (`storeDidMount`/`storeWillUnmount`). Update reactive `props` via `updateStore()`.
- Models: domain state containers. Create with `Model.create()`. Persistent via snapshots (`toSnapshot`, `applySnapshot`, `onSnapshot`, diffs via `onSnapshotDiff`). Structure with `@state`, `@child`, identifiers via `@id`, and references via `@modelRef`.
- Context: pass data through Store/Model trees without prop drilling using `createContext<T>()`, `[Context.provide]`, and `Context.consume(this)`. Context is reactive and can be overridden by descendants.
- Reactivity: powered by signals. Use `@observable`, `@computed`, `effect`, `reaction`, `batch`, and `untracked` for precise updates.

## Separation of concerns

- Models: domain state + domain logic. Keep invariants, domain mutations (in-place updates), and computed/derived getters here. Models are serializable; mutate arrays/maps/sets in place and expose methods to add/remove/upsert. Derive values via getters.
- Stores: application/view state + orchestration. Coordinate routing, timers, reactions, and I/O. Stores call model methods to perform domain changes. Avoid embedding domain rules in stores.

### Why Stores and Models (motivation)

- What is a Model? Persistent domain state plus domain rules. It holds identifiers, references, invariants, and exposes pure domain mutations and derived getters. It is serializable (snapshots), re-hydratable, and safe to reuse across views.
- What is a Store? Application/view state and orchestration. It wires effects (reactions, timers, I/O), reacts to user intent, and delegates domain changes to Models. Stores are not snapshotted.
- Why separate?
  - Snapshots/undo/redo work cleanly when only domain lives in Models.
  - Views stay simple: UI reads derived getters, calls Store methods; Stores call Model methods.
  - Reuse: one Model can back multiple Stores/views without UI coupling.
  - Testability: Models are deterministic and easy to unit test; Stores are thin orchestrators.
  - Performance/identity: Models mutate in place; Stores manage child identity with `key`.
- Quick rule of thumb:
  - If it should be in a snapshot or referenced by id, put it in a Model (`@state`, `@child`, `@id`, `@modelRef`).
  - If it is ephemeral UI/app state or side-effect orchestration, put it in a Store.
  - Components should read from one Store; if a component needs multiple sources, compose them into a higher-level Store.

## Stores

Stores describe reactive state containers composed into a tree.

```ts
import { Store, createStore, mount, child } from "r-state-tree";

class TodoStore extends Store<{ title: string }> {
	get title() {
		return this.props.title;
	}
}

class AppStore extends Store {
	@child get todo() {
		return createStore(TodoStore, { title: "Write docs" });
	}
}

const app = mount(createStore(AppStore));
app.todo.title; // "Write docs"
```

### Store creation, props, and typing

- Always create with `createStore()` and attach with `mount()`. Stores cannot be constructed with `new` directly.
- Prefer no custom constructor. Type stores as `Store<Props>` and access props via `this.props`.
- If a constructor is necessary, call `super(props)` exactly once and keep it minimal; put effects in `storeDidMount`.
- Do not shadow or re-declare `props` as a class field; `props` is read-only. Use the generic `Store<{ ... }>` for typing.

```ts
class ItemStore extends Store<{ id: number; title?: string }> {
	get id() {
		return this.props.id;
	}
	get title() {
		return this.props.title ?? "";
	}
}

const root = mount(createStore(ItemStore, { id: 1, title: "Hello" }));
```

### Updating props

Stores receive reactive `props` objects. Use `updateStore` to change them.

```ts
import { updateStore } from "r-state-tree";

updateStore(app.todo, { title: "Ship release" });
```

### Child stores

Use `@child` for both single child stores and arrays.

```ts
import { child } from "r-state-tree";

class ListStore extends Store {
	items = ["Buy milk", "Walk dog"];

	@child get todos() {
		return this.items.map((title, i) =>
			createStore(TodoStore, { title, key: i })
		);
	}
}
```

#### Child store keys and identity

- Pass a stable `key` (e.g., an id) when creating child stores to preserve identity across reorders.
- `@child` must decorate a getter; child stores are derived from current state on access, and identity is preserved by keys.

```ts
class ItemsStore extends Store {
	items = [
		{ id: 1, title: "A" },
		{ id: 2, title: "B" },
	];

	@child get itemStores() {
		return this.items.map((it) =>
			createStore(TodoStore, { key: it.id, title: it.title })
		);
	}
}
```

### Lifecycle hooks

Stores support lifecycle methods:

```ts
class TodoStore extends Store {
	storeDidMount() {
		console.log("Store mounted");
	}

	storeWillUnmount() {
		console.log("Store will unmount");
	}
}
```

### Reactions

Create side effects that run when reactive values change:

```ts
class TodoStore extends Store {
	storeDidMount() {
		this.reaction(
			() => this.props.title,
			(title) => console.log("Title changed:", title)
		);
	}
}
```

### Context

Share data across the store tree without prop drilling:

```ts
import { createContext } from "r-state-tree";

const ThemeContext = createContext<"light" | "dark">("light");

class AppStore extends Store {
	theme = "dark";

	[ThemeContext.provide]() {
		return this.theme;
	}

	@child get todo() {
		return createStore(TodoStore);
	}
}

class TodoStore extends Store {
	get theme() {
		return ThemeContext.consume(this);
	}
}

const app = mount(createStore(AppStore));
app.todo.theme; // "dark"
```

Context is reactive and updates automatically when the provided value changes.

### Actions and batching

`batch` groups updates to avoid redundant reactions.

```ts
import { batch } from "r-state-tree";

batch(() => {
	app.todo.props.title = "Refactor";
});
```

### Models injection (@model)

Inject domain models into stores via the `models` creation prop and consume them with `@model` on the store. `@model` fields are read-only references.

```ts
import { Model, Store, model, createStore, mount } from "r-state-tree";

class User extends Model {
	@id id = 0;
	@state name = "";
}

class ProfileStore extends Store {
	@model user!: User;
}

const user = User.create({ id: 1, name: "Ada" });
const profile = mount(createStore(ProfileStore, { models: { user } }));
profile.user.name; // "Ada"
```

Type stores as `Store<Props>` and explicitly type `@model` fields for clarity. The `models` prop may also provide arrays of models.

## Modeling guide

### Store ↔ Component mapping (quick guide)

- Pair each container/screen component with one owning Store; components should read from a single Store.
- The Store tree overlays the component tree: parents map to parent Stores; children map to `@child` Stores; lists map to arrays of child Stores with stable `key`s.
- A Store can power multiple components (header/body/sidebar), but a component shouldn’t pull from multiple Stores. If it needs to, introduce a parent/adapter Store that composes and exposes exactly what the component needs.
- Use Context for cross‑cutting concerns (theme, auth) instead of coupling components to multiple Stores.
- Keep domain logic in Models; Stores orchestrate and delegate to Model methods, and expose derived getters for the UI.

- Root store: mount a single root Store that composes the application via `@child` properties.
- View stores: create one Store per view/route/tab. Views render from stores; stores drive view transitions.
- Keyed children: pass `{ key }` when creating child stores to preserve identity across reorders.
- Models in stores: pass domain Models via `{ models }` and consume with `@model` on the Store.

```ts
import { Store, Model, child, createStore, mount } from "r-state-tree";

class TabViewStore extends Store<{ title: string }> {}

class RootStore extends Store {
	@child get tabs() {
		return ["Home", "Profile"].map((title, i) =>
			createStore(TabViewStore, { title, key: i })
		);
	}
}

const root = mount(createStore(RootStore));
```

### Patterns: deriving Stores from Models

Derive child stores directly from model arrays with stable keys; delegate mutations to model methods.

```ts
class ItemModel extends Model {
	@id id = 0;
	@state title = "";
}

class ListModel extends Model {
	@child(ItemModel) items: ItemModel[] = [];

	add(id: number, title: string) {
		this.items.push(ItemModel.create({ id, title }));
	}
	remove(id: number) {
		const i = this.items.findIndex((m) => m.id === id);
		if (i >= 0) this.items.splice(i, 1);
	}
	get titles() {
		return this.items.map((m) => m.title);
	}
}

class ItemStore extends Store {
	@model item!: ItemModel;
	get title() {
		return this.item.title;
	}
}

class ListStore extends Store {
	@model list!: ListModel;

	@child get items() {
		return this.list.items.map((item) =>
			createStore(ItemStore, { key: item.id, models: { item } })
		);
	}

	addItem(id: number, title: string) {
		this.list.add(id, title); // delegate to domain
	}
}
```

## Mutability rules

- Models: prefer in-place mutation for arrays/maps/sets (`push`, `splice`, `set`, etc.). Replace the whole structure only when you intentionally want to swap the instance.
- Stores: store fields are reactive; in-place mutation is fine. Reassign the entire structure only if you need identity replacement semantics.

## Observable classes

For reactive class instances outside the Model/Store system, use `@observable` and `@computed` decorators:

```ts
import { Observable, observable, computed, effect } from "r-state-tree";

class Counter extends Observable {
	@observable count = 0;
	@observable step = 1;

	@computed get doubled() {
		return this.count * 2;
	}

	increment() {
		this.count += this.step;
	}
}

const counter = new Counter();

effect(() => {
	console.log("Count:", counter.count, "Doubled:", counter.doubled);
});

counter.increment(); // Triggers the effect
```

**Important:** Class instances require explicit `@observable` and `@computed` decorators. Properties without decorators are **not** reactive.

### Plain objects (implicit reactivity)

Plain objects wrapped with `observable()` use implicit reactivity:

```ts
import { observable, effect } from "r-state-tree";

const state = observable({ count: 0 });

effect(() => {
	console.log(state.count); // All properties are reactive
});

state.count++; // Triggers the effect
```

## Observables (low‑level)

Create reactive structures outside Stores/Models. Supported: Objects, Arrays, Map, Set, WeakMap, WeakSet.

- Track reads with `effect`/`reaction`. Nested values are tracked when you access them inside your effects.
- Access raw values via `source(observable)`; check if something is reactive with `isObservable(value)`.
- Arrays: reading specific indices (`arr[i]`) or `length` tracks those; common mutators (`push/pop/shift/unshift/splice/reverse/sort/fill`) are reactive; non-index and symbol keys are not reactive.

```ts
import { observable, effect, computed, reaction } from "r-state-tree";

// Object
const state = observable({ count: 0, nested: { value: 1 } });

effect(() => {
	// tracks reads
	state.count;
	state.nested.value;
});

state.count++;
state.nested.value++;

// Computed
const doubled = computed(() => state.count * 2);
effect(() => {
	doubled.value;
});

// Array
const arr = observable([0, 1]);
effect(() => arr[0]);
arr[0]++; // triggers; arr.push(2) does not, index 0 didn't change

// Map
const map = observable(new Map([["k", 1]]));
effect(() => map.get("k"));
map.set("k", 2); // triggers

// Set
const set = observable(new Set([1]));
effect(() => set.has(2));
set.add(2); // triggers

// Reaction (runs only on changes, skips initial)
let last: number | undefined;
reaction(
	() => state.count,
	(v) => {
		last = v;
	}
);
state.count++;
```

## Models and snapshots

Models capture persistent state with snapshot utilities.

```ts
import {
	Model,
	state,
	id,
	applySnapshot,
	onSnapshot,
	toSnapshot,
} from "r-state-tree";

class TodoModel extends Model {
	@id id = 0;
	@state title = "";
	@state completed = false;
}

const todo = TodoModel.create({ id: 1, title: "Learn signals" });

const stop = onSnapshot(todo, (snapshot) => {
	console.log(snapshot); // { id: 1, title: "Learn signals", completed: false }
});

todo.title = "Learn r-state-tree";
stop();
```

### Snapshots and persistence

- Snapshots capture Models (not Stores).
- Hydrate/persist with `applySnapshot` and `onSnapshot`:

```ts
const STORAGE_KEY = "list";

// hydrate
const list = ListModel.create();
const saved = localStorage.getItem(STORAGE_KEY);
if (saved) applySnapshot(list, JSON.parse(saved));

// persist
const off = onSnapshot(list, (snap) => {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
});
```

Mutate Models through domain methods and let snapshots record changes automatically.

### Model lifecycle hooks

Models support lifecycle methods:

```ts
class TodoModel extends Model {
	@child tags: TagModel[] = [];

	modelDidInit(snapshot?, ...args: unknown[]) {
		// Called when model is created via Model.create()
		// Receives the snapshot and any additional arguments passed to create()
		console.log("Model initialized", snapshot);
	}

	modelDidAttach() {
		// Called when this model is attached as a child to another model
		console.log("Model attached to parent");
	}

	modelWillDetach() {
		// Called when this model is detached from its parent
		console.log("Model will be detached");
	}
}
```

When to use each:

- `modelDidInit`: initialize/normalize data based on the initial snapshot.
- `modelDidAttach`: link to other models or read context after the model is part of a tree.
- `modelWillDetach`: cleanup before the model is removed or replaced.

### Model decorators

Use decorators to configure model properties:

```ts
import { Model, state, id, child, modelRef } from "r-state-tree";

class User extends Model {
	@id id = 0;
	@state name = "";
}

class TodoModel extends Model {
	@id id = 0;
	@state title = "";
	@modelRef assignee?: User; // Reference to another model by ID
	@child metadata = MetadataModel.create(); // Nested child model
	@child tags: TagModel[] = []; // Array of child models
}
```

The `@child` and `@modelRef` decorators support both single values and arrays. You can also specify the child type using `@child(ChildType)`:

```ts
class TodoModel extends Model {
	@child(TagModel) tags: TagModel[] = []; // Type-safe array of child models
	@child(TagModel) primaryTag: TagModel | null = null; // Can switch between single and array at runtime
}
```

### Model references

Reference models by ID using `@modelRef`:

```ts
class ProjectModel extends Model {
	@id id = 0;
	@child users: User[] = [];
	@modelRef owner?: User; // Single reference
	@modelRef assignees: User[] = []; // Array of references

	assignOwner(userId: number) {
		// Find user by ID and set as owner
		const user = this.users.find((u) => u.id === userId);
		this.owner = user;
	}
}

const project = ProjectModel.create({
	id: 1,
	users: [
		{ id: 1, name: "Alice" },
		{ id: 2, name: "Bob" },
	],
	owner: { id: 1 }, // Reference by ID in snapshot
});

project.owner?.name; // "Alice"
```

Both `@child` and `@modelRef` support runtime type switching between single values and arrays:

```ts
class ItemModel extends Model {
	@id id = 0;
	@state value = 0;
}

class ContainerModel extends Model {
	@child(ItemModel) items: ItemModel | ItemModel[]; // Can be single or array

	setSingle() {
		this.items = ItemModel.create({ id: 1, value: 10 });
	}

	setArray() {
		this.items = [
			ItemModel.create({ id: 2, value: 20 }),
			ItemModel.create({ id: 3, value: 30 }),
		];
	}
}
```

## API surface

- Stores
  - `Store`, `createStore`, `mount`, `unmount`, `updateStore`
- Models
  - `Model`, decorators: `@state`, `@id`, `@child`, `@modelRef`
- Snapshots
  - `onSnapshot`, `toSnapshot`, `applySnapshot`, `onSnapshotDiff`
  - Types: `Snapshot`, `SnapshotDiff`, `IdType`, `Configuration`
- Context
  - `createContext`, type `Context`
- Reactivity and observables
  - `observable`, `computed`, `effect`, `reaction`, `batch`, `untracked`, `Observable`
  - Utilities: `isObservable`, `source`, `reportObserved`, `reportChanged`
- Signals interop
  - `signal`, `getSignal`, types `Signal`, `ReadonlySignal`

## UI integration and signals interop

r-state-tree is built on `@preact/signals-core`. You can interoperate with signals directly:

- Per-property signals via `$prop` on observable objects (including Stores/Models), or `getSignal(obj, key)`.
- Re-exported utilities: `signal`, `computed`, `effect`, `batch`, `untracked`, and types `Signal`, `ReadonlySignal`.

```ts
import { observable, effect, getSignal } from "r-state-tree";

const state = observable({ count: 0 });

// Either form returns a Signal<number>
const s1 = state.$count;
const s2 = getSignal(state, "count");

effect(() => {
	// Use s1.value (or s2.value) in your UI binding
	console.log("count:", s1.value);
});

// Update via signal or through the object
s1.value = 1;
state.count = 2;
```

#### React / Preact usage

- Preact: use `@preact/signals`. Reading `signal.value` inside JSX is reactive; components re-render automatically.
- React: use `@preact/signals-react`. Call `useSignals()` in a component and read `signal.value` in render; updates re-render the component.

```ts
// Preact
function TodoView({ store }: { store: TodoStore }) {
	return <h1>{store.$title.value}</h1>;
}

// React
import { useSignals } from "@preact/signals-react/runtime";
function TodoView({ store }: { store: TodoStore }) {
	useSignals();
	return <h1>{store.$title.value}</h1>;
}
```

You can also use `getSignal(store, "title")` instead of `$title`. Use the observers/renderers provided by the signals bindings for your UI library; r-state-tree will participate automatically because Stores/Models are signal-backed.

### Identifier and reference rules

- `@id` values are unique within a tree. They cannot be cleared to `undefined` after assignment.
- Identifiers can be reassigned to a new value (including in snapshots) as long as uniqueness is preserved.
- `@modelRef` requires the referenced model to have an id and be attached to the tree; the ref becomes `undefined` when the model detaches.
- When a model is re-attached to the same tree, compatible refs restore automatically; attaching to a different root does not restore prior refs.
- `@modelRef` and `@child` can switch between single and array at runtime; reactions observe the property itself rather than internal array mutations.

### Snapshot diffs

Use `onSnapshotDiff` to receive undo/redo payloads:

```ts
const history: SnapshotDiff[] = [];

const off = onSnapshotDiff(todo, (diff) => {
	history.push(diff);
});

todo.title = "New title";
todo.completed = true;

// Undo
applySnapshot(todo, history[history.length - 1].undo);

// Redo
applySnapshot(todo, history[history.length - 1].redo);
```

### Context with Models

Models also support context:

```ts
const AuthContext = createContext<User | null>(null);

class AppModel extends Model {
	@child currentUser = User.create({ id: 1, name: "Alice" });

	[AuthContext.provide]() {
		return this.currentUser;
	}

	@child project = ProjectModel.create();
}

class ProjectModel extends Model {
	get currentUser() {
		return AuthContext.consume(this);
	}
}
```

## Do/Don’t guide

Do:

- Keep domain operations in Models
- Delegate from Stores to Models for domain changes
- Use `@child` for child stores (getter-based)
- Use stable `key` values for child stores
- Mutate model arrays/maps/sets in place

Don’t:

- Shadow or re-declare `props` on stores
- Instantiate Stores with `new`
- Perform effectful work in constructors
- Manually “sync” store state into Models (call model methods instead)

## Compact code samples

Store without a constructor:

```ts
class ViewStore extends Store<{ q?: string }> {
	get q() {
		return this.props.q ?? "";
	}
}
```

Store with an injected `@model`:

```ts
class ItemStore extends Store {
	@model item!: ItemModel;
}
const item = ItemModel.create({ id: 1, title: "X" });
const s = mount(createStore(ItemStore, { models: { item } }));
```

`@child` mapping from a model array (stable keys):

```ts
class ListStore extends Store {
	@model list!: ListModel;
	@child get items() {
		return this.list.items.map((item) =>
			createStore(ItemStore, { key: item.id, models: { item } })
		);
	}
}
```

Model with in-place mutations and a derived getter:

```ts
class ListModel extends Model {
	@child(ItemModel) items: ItemModel[] = [];
	add(m: ItemModel) {
		this.items.push(m);
	}
	get count() {
		return this.items.length;
	}
}
```

Lifecycle hooks:

```ts
class M extends Model {
	modelDidInit() {}
	modelDidAttach() {}
	modelWillDetach() {}
}
class S extends Store {
	storeDidMount() {}
	storeWillUnmount() {}
}
```

Snapshot hydrate/persist:

```ts
const m = ListModel.create();
const saved = localStorage.getItem("m");
if (saved) applySnapshot(m, JSON.parse(saved));
const off = onSnapshot(m, (snap) =>
	localStorage.setItem("m", JSON.stringify(snap))
);
```

## Common pitfalls

- Forgetting stable keys for `@child` arrays causes identity churn.
- Assuming deep reactivity on undecorated fields of plain classes; use `@observable` for `Observable` classes, or use Stores/Models.
- Creating child stores in constructors: `@child` must be on getters so identity and lifecycle can be managed by the framework.

## Typing recipes

- Type stores as `Store<Props>`; read `this.props` inside methods/getters.
- Explicitly type `@model` fields on stores, and pass matching values via the `models` creation prop.
- When a store has no props, use `class X extends Store {}`.

## Cheat sheet

- Decorators (Models): `@state`, `@id`, `@child`, `@modelRef`
- Decorators (Stores): `@child`, `@model`
- Core: `createStore`, `mount`, `unmount`, `updateStore`
- Snapshots: `onSnapshot`, `toSnapshot`, `applySnapshot`, `onSnapshotDiff`
- Lifecycle: `storeDidMount`, `storeWillUnmount`, `modelDidInit`, `modelDidAttach`, `modelWillDetach`
- Best practices: domain in Models; delegate from Stores; stable keys for `@child`; in-place mutations in Models; no effectful constructors; don’t shadow `props`.

## Testing

The repository ships with Vitest suites covering stores, models, containers, and observable primitives.

```bash
pnpm test
```

## Build & publishing

```bash
pnpm build
```

The build emits CommonJS, ESM bundles, and type declarations under `dist/`.

## License

MIT
