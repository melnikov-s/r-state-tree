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

### Vite / esbuild config (SSR)

When using Vite or esbuild for SSR, ensure the target is set to `es2022` to support Stage 3 decorators:

```ts
// vite.config.ts
export default defineConfig({
	esbuild: {
		target: "es2022",
	},
});
```

## Core concepts

- Stores: application/view state containers. Create with `createStore()`, attach with `mount()`. Compose with `@child` (single or arrays, stable via `{ key }`). React to changes with `effect`/`reaction` and store lifecycles (`storeDidMount`/`storeWillUnmount`). Update reactive `props` via `updateStore()`.
- Models: domain state containers. Create with `Model.create()`. Persistent via snapshots (`toSnapshot`, `applySnapshot`, `onSnapshot`, diffs via `onSnapshotDiff`). Structure with `@state`, `@child`, identifiers via `@id`, and references via `@modelRef`.
- Context: pass data through Store/Model trees without prop drilling using `createContext<T>()`, `[Context.provide]`, and `Context.consume(this)`. Context is reactive and can be overridden by descendants.
- Reactivity: powered by signals. Use `observable()`, `@computed`, `effect`, `reaction`, `batch`, and `untracked` for precise updates.

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

- Models: model fields are shallow-reactive, but values are not auto-wrapped. For raw `@state` arrays/objects, prefer **reassignment** (immutability) so snapshots stay up to date. If you want in-place mutation (`push`, `splice`, `set`, etc.) to trigger updates and snapshot invalidation, store an `observable()` container (or `signal()`) in `@state`.
- Stores: store fields are shallow-reactive. Use `observable()` containers (or `signal()`) when you want in-place mutations of nested values/collections to trigger updates.

### `Observable` base class

For class instances that need to be reactive, extending the `Observable` base class is the supported pattern. This ensures compatibility with ES `#private` fields and built-in brand checks because the observable is created in the base constructor, allowing derived field initializers (including `#private`) to run on the observable.

```ts
import { Observable, effect } from "r-state-tree";

class Counter extends Observable {
	count = 0; // Public fields are automatically reactive
	#internal = 0; // Private fields also work perfectly

	get total() {
		return this.count + this.#internal;
	}

	increment() {
		this.count++;
		this.#internal++;
	}
}

const counter = new Counter();

// Use an effect to track and react to property changes
effect(() => {
	console.log(`Visible: ${counter.count}, Total: ${counter.total}`);
});

counter.increment();
```

> [!IMPORTANT] > **Why `extends Observable`?**
> ES `#private` fields are brand-checked. If you wrap a class instance with `observable()` _after_ it has been created (post-hoc wrapping), or if you return an observable from a standard constructor, the private state is installed on the original `this`, but methods run with the observable as `this`, causing `TypeError: Cannot read private member`.
>
> `extends Observable` solves this by returning the observable from `super()`, so derived classes initialize their private fields directly on the observable receiver.

### Limitations of `observable(instance)`

The `observable()` function is selective about what it makes observable. It wraps **supported containers** only:

- Plain objects
- Arrays
- Maps and Sets
- Dates

**Functions are not observable containers**. Calling `observable(fn)` returns the function unchanged with a dev-mode warning. However, functions stored as properties on observable objects are still automatically **batched as actions** when called—this existing behavior is preserved, just not via `observable(fn)` directly.

If you pass an arbitrary class instance, built-in (like `URL`, `RegExp`, `Promise`, or DOM objects), or frozen object to `observable()`, it will **return the object unchanged** and emit a warning in development mode.

This design prevents “silent failure” where an observable object appears to work but throws `TypeError` when accessing private members or internal slots. For your own classes, use `extends Observable`. For third-party or built-in objects, use composition:

```ts
// ❌ Post-hoc wrapping - returns raw URL, not an observable
const url = observable(new URL("..."));

// ✅ Composition - wrap a container instead
const state = observable({ url: new URL("...") });
```

Wrap values with `observable()` for reactivity. Collections (arrays, maps, sets) track mutations:

```ts
import { observable, effect, isObservable } from "r-state-tree";

class DataStore {
	// Wrap state with observable() for reactivity
	state = observable({ count: 0 });

	// Wrap array with observable() to track push/pop/splice etc.
	items = observable([]);
}

const store = new DataStore();

effect(() => {
	console.log("Items length:", store.items.length);
});

store.items.push({ value: 1 }); // Triggers effect
console.log(isObservable(store.items[0])); // false - shallow by default
```

### Shallow behavior

All observables are **shallow by default**. Only the container's own properties are tracked—nested values are NOT wrapped:

- Collections (Arrays, Maps, Sets) wrapped with `observable()` track mutations
- Plain objects assigned to properties are NOT wrapped (helps preserve `structuredClone` compatibility for stored values)
- Nested object properties do NOT trigger effects unless explicitly wrapped

**Mental model: reactive property, explicit reactive value**

- Reading/writing a property on an observable container (including Stores/Models) is reactive.
- The _value_ you store is not auto-wrapped. If you store a plain object/array, mutating inside it won’t trigger reactions; wrap nested values with `observable()` (or use `signal()`), or use `toObservableTree` for a one-time deep wrap of an existing JSON-like structure.

**What gets tracked in shallow mode:**

| Expression              | Tracked?      | Why                                              |
| ----------------------- | ------------- | ------------------------------------------------ |
| `data.nested`           | ✅ Yes        | Property access on the observable container      |
| `data.nested.value`     | ❌ No         | `data.nested` is a plain object, not observable  |
| `data.nested = { ... }` | ✅ Triggers   | Reassigns a property on the observable container |
| `data.nested.value = 2` | ❌ No trigger | Mutates a plain object; container unchanged      |

```ts
const data = observable({ nested: { value: 1 } });

effect(() => {
	data.nested.value; // Reads `data.nested` (tracked), then reads `.value` (not tracked)
});

data.nested.value = 2; // Does NOT trigger — mutating a plain object
data.nested = { value: 3 }; // DOES trigger — reassigning a property on the observable
```

To make `nested` reactive, wrap it explicitly:

```ts
const data = observable({ nested: observable({ value: 1 }) });
data.nested.value = 2; // Now triggers — `nested` is also observable
```

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

- Track reads with `effect`/`reaction`. Observables are **shallow**: reads are tracked on the observable container, but nested object mutations do **not** trigger unless you explicitly wrap nested values with `observable()` (or use signals).
- Access backing values via `source(value)`; check if something is reactive with `isObservable(value)`.
- Rule of thumb: `source(...)` returns the backing data, **not** a sanitizer—it's only observable-free if you didn't manually seed observables into the backing source.
- Arrays: reading specific indices (`arr[i]`) or `length` tracks those; common mutators (`push/pop/shift/unshift/splice/reverse/sort/fill`) are reactive; non-index and symbol keys are not reactive.

### `source()` and structuredClone

`source(x)` returns the backing value behind an observable. It is **not** a “observable stripper”.

**One-way rule (important):**

- If you mutate through the observable wrapper (e.g. `obj.prop = observable(child)`), r-state-tree stores the **raw backing value** in `source(obj).prop` (unwrap-on-write).
- If you manually mutate backing sources yourself (e.g. `source(obj).prop = observable(child)`), r-state-tree does **not** sanitize or rewrite your data. In that case, `source(...)` may contain observables.

If you need to pass values to APIs that require cloneable data (e.g. `structuredClone`, `postMessage`), avoid seeding observables into backing sources. Prefer reading via `source(...)` and keep your stored values plain/cloneable.

```ts
import { observable, effect, computed, reaction } from "r-state-tree";

// Object
const state = observable({ count: 0, nested: observable({ value: 1 }) });

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

### Derived collections and identity preservation

Native methods that return copies of a collection—such as `Array.prototype.slice`, `filter`, and `concat`, or `Set.prototype.union` and `intersection`—behave according to the **Explicit Architecture**:

- **Raw Return**: The returned container is a plain JavaScript object (raw, non-observable).
- **Identity Preservation**: Each element in the returned container maintains the same identity it had in the observable source. If an element was an observable (because it was explicitly owned), it remains an observable in the raw result.

This ensures that "derived" state is not automatically made reactive, while still allowing observers to maintain reference stability with existing objects in your state tree.

```ts
const item = observable({ id: 1 });
const arr = observable([item, { id: 2 }]);

// slice() returns a plain array
const sliced = arr.slice();
isObservable(sliced); // false

// Identity is preserved
sliced[0] === item; // true (same observable identity)

// If you want the result to be reactive, wrap it explicitly
const reactiveSlice = observable(arr.slice());
```

### Recursively wrapping nested values (`toObservableTree`)

By default, `observable()` is **shallow**: only the top-level container is wrapped, and nested objects/arrays are not. This is intentional for performance and `structuredClone` compatibility.

`toObservableTree` performs a **one-time initial pass** that wraps all existing nested plain objects and arrays with `observable()`. After the initial wrap, the returned observables behave exactly like normal shallow observables — new assignments are **not** auto-wrapped.

```ts
import { toObservableTree, effect, source, isObservable } from "r-state-tree";

// Initial pass wraps all existing nested plain objects/arrays
const tree = toObservableTree({
	user: { name: "Alice", tags: ["admin", "active"] },
	settings: { theme: "dark" },
});

effect(() => {
	// Existing nested values are observable and tracked
	console.log(tree.user.name);
	console.log(tree.user.tags[0]);
});

// Mutations to initially-wrapped values trigger effects
tree.user.name = "Bob"; // triggers
tree.user.tags[0] = "superadmin"; // triggers

// NEW assignments are NOT auto-wrapped (normal shallow behavior)
tree.newProp = { foo: 1 };
isObservable(tree.newProp); // false — not wrapped

// Source is observable-free and clonable *as long as you don't manually seed observables*
// into backing data structures. r-state-tree unwraps observables on writes performed
// through observable containers, but it does not sanitize user-mutated backing sources.
const snapshot = structuredClone(source(tree));
```

**Key behavior:**

- **One-time pass**: Only values present at call time are wrapped. New assignments afterward behave like normal `observable()` (shallow).
- **Not MobX-style "deep"**: This does NOT change the observable's behavior. It's just a convenience for wrapping an existing structure upfront.

**When to use:**

- Hydrating API/JSON responses where you want all nested values observable from the start
- Cases where manually wrapping each nested object would be tedious

**Constraints:**

- Input must be JSON-like and **acyclic** (no circular references)
- Only plain objects and arrays are wrapped; other types (Map, Set, Date, class instances, RegExp, Error, etc.) are left as-is and not traversed

## Models and snapshots

Models capture persistent state with snapshot utilities.

**Important:** `@state` is **shallow-reactive** at the property level (assignments track), but values are **not auto-wrapped**. If you need nested mutations to be reactive (and to invalidate snapshot caches on in-place mutation), store `observable()` containers or `signal()` values inside `@state`.

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

### Snapshot data contract

**Snapshots are JSON-only**: they contain primitives, arrays, plain objects, and Dates (serialized as ISO strings).

- **Primitives**: `string`, `number`, `boolean`, `null`, `undefined` pass through.
- **Arrays**: recursively cloned.
- **Plain objects**: recursively cloned (prototype must be `Object.prototype` or `null`).
- **Dates**: serialize to ISO strings (e.g., `"2024-01-15T10:30:00.000Z"`).
- **Signals**: serialize to their current `.value` (recursively cloned).
- **Map/Set/WeakMap/WeakSet and other non-plain objects are rejected** with a descriptive error. Convert them to plain structures before storing in `@state`.

```ts
class Event extends Model {
	@state title = "Meeting";
	@state createdAt = new Date(); // Date → ISO string in snapshot
}

const event = Event.create();
toSnapshot(event);
// { title: "Meeting", createdAt: "2024-01-15T10:30:00.000Z" }
```

If you store a `Map` or class instance in `@state`, snapshotting will throw:

```ts
class M extends Model {
	@state cache = new Map(); // ❌ Will throw on toSnapshot()
}
// Error: r-state-tree: snapshots do not support Map at path "cache". ...
```

Convert to a plain structure instead:

```ts
class M extends Model {
	@state cache: Record<string, unknown> = {}; // ✅ Plain object
}
```

### Snapshot invalidation rules

Snapshots are **memoized computeds**. Once a snapshot is observed (via `onSnapshot`, `onSnapshotDiff`, or `toSnapshot`), subsequent calls return the cached value unless a reactive dependency changes.

Because snapshots are **memoized computeds** and observables are **shallow**, the snapshot cache is invalidated only by:

1. **Reassigning** the `@state` field itself.
2. **Mutating observable containers** (`observable()`) or **signals** (`signal()`) stored in the field.

**Rule:** Treat raw `@state` values (plain objects/arrays) as immutable. If you mutate them in place without reassignment, the snapshot cache goes stale—`onSnapshot` won't fire and `toSnapshot` returns the old cached value.

```ts
class M extends Model {
	@state tags: string[] = [];

	// ❌ In-place mutation — snapshot cache goes stale
	addTagBroken(tag: string) {
		this.tags.push(tag);
	}

	// ✅ Reassign — invalidates cache, onSnapshot fires
	addTagReassign(tag: string) {
		this.tags = [...this.tags, tag];
	}
}
```

If you need in-place mutations **and** snapshot updates, wrap the value in `observable()` or use `signal()`:

```ts
class M extends Model {
	// ✅ observable() container — in-place mutations invalidate cache
	@state items: { id: number }[] = observable([]);

	addItem(id: number) {
		this.items.push({ id }); // onSnapshot fires
	}
}

class Counter extends Model {
	// ✅ signal() — .value updates invalidate cache
	@state count = signal(0);

	increment() {
		this.count.value++; // onSnapshot fires
	}
}
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
  - `observable`, `computed`, `effect`, `reaction`, `batch`, `untracked`
  - Utilities: `isObservable`, `source`, `reportObserved`, `reportChanged`
- Advanced
  - `toObservableTree` — recursively wrap nested values in a JSON-like structure
- Signals interop
  - `signal`, `getSignal`, types `Signal`, `ReadonlySignal`

## UI integration and signals interop

r-state-tree is built on `@preact/signals-core`. You can interoperate with signals directly:

- Per-property signals via `getSignal(obj, key)`.
- Re-exported utilities: `signal`, `computed`, `effect`, `batch`, `untracked`, and types `Signal`, `ReadonlySignal`.

```ts
import { observable, effect, getSignal } from "r-state-tree";

const state = observable({ count: 0 });

const countSignal = getSignal(state, "count");

effect(() => {
	console.log("count:", countSignal.value);
});

// Update via signal or through the object
countSignal.value = 1;
state.count = 2;
```

#### React / Preact usage

- Preact: use `@preact/signals`. Reading `signal.value` inside JSX is reactive; components re-render automatically.
- React: use `@preact/signals-react`. Call `useSignals()` in a component and read `signal.value` in render; updates re-render the component.

```ts
// Preact
function TodoView({ store }: { store: TodoStore }) {
	const titleSignal = getSignal(store, "title");
	return <h1>{titleSignal.value}</h1>;
}

// React
import { useSignals } from "@preact/signals-react/runtime";
function TodoView({ store }: { store: TodoStore }) {
	useSignals();
	const titleSignal = getSignal(store, "title");
	return <h1>{titleSignal.value}</h1>;
}
```

Use the observers/renderers provided by the signals bindings for your UI library; r-state-tree will participate automatically because Stores/Models are signal-backed.

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
- Mutate **`@child` model collections** and **`observable()` containers** in place (push/splice/set/add/etc.)
- Treat **raw `@state` arrays/objects** as immutable: use reassignment so snapshots stay up to date (or store an `observable()` container / `signal()` inside `@state`)

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
- Assuming **deep** reactivity: nested plain objects/arrays are not reactive unless you explicitly wrap them (or use `toObservableTree` for initial hydration).
- Mutating raw `@state` arrays/objects in place (`push`, `obj.x = 1`) and expecting snapshots to update. Snapshots are memoized; use reassignment or store `observable()` containers / `signal()` values in `@state`.
- Passing observables to third‑party APIs that expect cloneable/serializable values (e.g. `structuredClone`). Use `source(value)` to get the backing value. It will be observable-free for values written via r-state-tree’s observable APIs (unwrap-on-write), but `source(...)` is **not** guaranteed observable-free if you manually seed observables into backing sources.
- Creating child stores in constructors: `@child` must be on getters so identity and lifecycle can be managed by the framework.
- Passing `models` into child stores during mount can create a recursive mount loop. If a child needs parent models, create the child store/model inside `storeDidMount` instead of wiring it through `models` during the mount cycle.

### Circular store/model creation

When child stores are created during mount with `models` that point back into the parent, it is easy to trigger an endless mount loop. The runtime now guards this by throwing a descriptive error (for example, `detected circular store/model creation while mounting ParentStore -> ChildStore.loop -> ...`). If you see this, move child creation into `storeDidMount` or break the cycle so that models are produced after the parent finishes mounting.

## LLM implementation checklist

- Do not thread context data via props. Provide contexts at the parent and consume them in children. Passing `getX` callbacks for resource/page/video/skill is a red flag—consume contexts instead.
- Avoid aggregating contexts into a single `ctx` object; consume where needed or expose small, focused getters.
- Only create stores in three places: root, `@child` getters, or immediately before mounting. Avoid standalone factory helpers; inline `createStore` in `@child` getters.
- Do not wrap `createStore` calls with `as Record<string, unknown>`; fix typing instead.
- Domain/persistent state belongs in Models; UI/app orchestration in Stores. Keep UI terms out of domain models—name domain concepts (e.g., `ChatThreadsModel`).
- If state is persistent/rehydratable, model it and derive stores from the model; keep purely view/ephemeral state in stores.
- Use r-state-tree snapshots (`toSnapshot`/`applySnapshot`) instead of hand-rolled `serialize`/`rehydrate` unless a different shape is required.
- Keep `onPersist` only when syncing store state into a backing model; otherwise prefer snapshot listeners.
- Pure, stateless helpers belong in utility modules, not as store methods. If a method does not touch `this`, extract it; keep coupled helpers in the store.
- Provide stable, rarely changing resource/view/video/page data via context (resourceId, resourceType, totalPages, current page/display mode, page offsets, document title, skill/detail, video info). Children should consume context directly.
- Use `@child` getters to create child stores with stable keys; avoid constructor creation. Pass only what the child needs; avoid prop drilling context.
- Eliminate blanket casts; fix types and let inference work. Avoid `any`.
- For `createStore` props, extend `Record<string, unknown>` only if needed; otherwise rely on proper prop types and context.
- Avoid barrel files if they cause import confusion; prefer direct imports.
- Keep file boundaries clean: one model per file; avoid piling multiple models together.
- Do not shadow `props` or use constructors for work better suited to `storeDidMount`.
- Use `@model` for injected models; `@child` for child stores; stable keys for arrays.

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
