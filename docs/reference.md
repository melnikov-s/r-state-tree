# API reference

[Start with the quick start](../README.md#quick-start). For design trade-offs, see
[architecture guidance](architecture.md); for compiler setup, see
[decorators and toolchains](toolchains.md).

- [Stores](#stores): descriptors, props, snapshots, children, lifetime, and Context
- [Models and snapshots](#models-and-snapshots): hydration, snapshot contracts, and references
- [Mutability rules](#mutability-rules) and [low-level observables](#observables-lowlevel)
- [React integration](#react-integration)
- [API surface](#api-surface), signals interop, identifiers, and snapshot diffs
- [Common pitfalls](#common-pitfalls)

Most examples are focused fragments that reuse earlier declarations or use
application-specific helpers (such as `connect()`). They are not standalone
programs. The quick-start, React quick-start, and Model references examples are
executed by
[`tests/documentation.test.ts`](../tests/documentation.test.ts).

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

Fallback (no decorators) using `static types`:

```ts
import { Store, createStore, mount, child } from "r-state-tree";

class TodoStore extends Store<{ title: string }> {
	get title() {
		return this.props.title;
	}
}

class AppStore extends Store {
	get todo() {
		return createStore(TodoStore, { title: "Write docs" });
	}

	static types = {
		todo: child,
	};
}

const app = mount(createStore(AppStore));
app.todo.title;
```

### Store creation, props, and typing

- Always create with `createStore()` and attach with `mount()`. Stores cannot be constructed with `new` directly.
- Prefer no custom constructor. Type stores as `Store<Props>` and access props via `this.props`.
- Constructors may register framework-owned reactions and effects after `super(props)`. Store registrations activate when mounting and are disposed with the store; return cleanup from effects to release resources.
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

### Store snapshots and mount-time hydration

Use `@snapshot` to opt Store-owned session/view state into snapshots. Other Store
fields remain reactive but are not serialized. Props, Context values, effects,
and reactions are never included.

```ts
class EditorStore extends Store {
	@snapshot draft = "";
	@snapshot scrollTop = 0;
	hoveredLine: number | null = null; // reactive, not snapshotted
}

const saved = {
	state: { draft: "Recovered", scrollTop: 120 },
};

const editor = mount(createStore(EditorStore), { snapshot: saved });
```

Hydration happens before mounted effects and reactions activate when a snapshot
is passed to `mount(..., { snapshot })` or applied via `applySnapshot` before
mounting. `applySnapshot(store, snapshot)` also works on an already-mounted
Store: state updates and child reconciliation go through the same reactive
machinery as any props-driven update, so live effects and reactions simply
observe the change.

`toSnapshot(store)` and `onSnapshot(store, callback)` use this shape:

```ts
type StoreSnapshot = {
	state?: Record<string, unknown>;
	children?: Record<
		string,
		StoreChildSnapshot | (StoreChildSnapshot | null)[] | null
	>;
};
```

Empty `state` and `children` sections are omitted. Stores without persisted state
or persisted descendants are excluded, even if they have a key. If the whole tree
has no persisted data, `toSnapshot(store)` returns `undefined`; `onSnapshot` may
also receive `undefined`. Explicitly persisted values such as `{}` and `[]` are
preserved. Older snapshots containing empty sections still hydrate normally.

Reactive child snapshots are matched within their parent child property by
stable `key`. Pending snapshots are retained unchanged while a child property
remains lazy and are applied before matching children mount. After hydration,
the next save uses the compact format automatically. Once the property is realized,
unmatched snapshots are discarded. Use stable keys for snapshotted child arrays;
unkeyed children are matched positionally. Empty unkeyed stores use explicit
`null` entries to preserve positions, including at the end of an array. Empty
keyed stores are omitted, as are arrays with no persisted child data.

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

- Pass stable, unique keys (e.g., ids) in child arrays to preserve identity across reorders.
- `createStore()` returns a fresh descriptor on every call, despite being typed as the Store class for getter ergonomics. Do not read state, call methods, or dispose the descriptor.
- The `@child` getter's framework wrapper reconciles descriptors into realized Stores. Matching keys and compatible Store types preserve instances within that parent's child property, not globally. Unkeyed array children match by position. Removing a child disposes it; reusing its key later creates a new instance.
- `@child` must decorate a getter. Root descriptors become realized Stores through `mount()`.

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

### Store lifetime and owned effects

Stores implement `Disposable`, and their owned effects run only during the mounted lifetime:

```ts
class TodoStore extends Store {
	constructor(props) {
		super(props);
		this.effect(() => {
			const connection = connect();
			return () => connection.close();
		});
	}
}

const store = mount(createStore(TodoStore));
store[Symbol.dispose]();

{
	using store = mount(createStore(TodoStore));
} // Symbol.dispose is called automatically
```

Every realized Store exposes a readonly `AbortSignal` for its terminal lifetime. It
is active while the Store is alive and aborts when disposal begins, before child
disposal and effect cleanup. This is a standard `AbortSignal`, not a reactive
signal. Disposal attempts every child and owned cleanup even if one throws,
finalizes lifecycle state, then throws an `AggregateError` containing the failures.
Repeated or reentrant disposal is a no-op. Child getters throw once disposal
begins, rather than creating or reconciling children on a disposed Store.

Pass the lifetime signal to APIs that support cancellation:

```ts
class LibraryStore extends Store {
	async load() {
		const response = await fetch("/api/library", { signal: this.signal });
		const data = await response.json();
		if (this.signal.aborted) return;
		this.apply(data);
	}
}
```

For a promise that cannot be canceled, check the signal before applying its
result:

```ts
const saved = await loadPersistedState();
if (this.signal.aborted) return;
this.applySavedState(saved);
```

An operation that also needs independent cancellation can combine both lifetimes
where `AbortSignal.any()` is supported:

```ts
const operation = new AbortController();
const signal = AbortSignal.any([this.signal, operation.signal]);
const response = await fetch(url, { signal });

operation.abort(); // cancels only this operation
```

The Store signal only represents disposal. Per-operation cancellation, run IDs,
and take-latest behavior remain application concerns; the library does not manage
loading state, errors, polling, or concurrency policy.

### Reactions

Create side effects that run when reactive values change:

```ts
class TodoStore extends Store {
	constructor(props) {
		super(props);
		this.reaction(
			() => this.props.title,
			(title, previousTitle) => console.log(previousTitle, "->", title)
		);
	}
}
```

`Store.effect()` and `Store.reaction()` register mount-scoped behavior. Mounting first links the complete store tree and commits its private mounted state bottom-up in one transaction. Registrations then activate bottom-up, so even a grandchild's initial effect sees a complete tree. A reaction establishes its initial value at activation and still skips its initial callback. Calling the disposer returned during construction cancels the pending registration; after mount, it disposes the live subscription. All registrations are disposed automatically with the store.

Registration activation is non-reentrant. If an active effect or reaction lazily materializes another child store, the new child's registrations are queued until the current callback and child getter stack have returned. This prevents initialization behavior from running inside the getter that created the store.

### Context

Pass ambient behavioral dependencies through the Store tree without prop drilling:

```ts
import { createContext } from "r-state-tree";

type VoiceServices = {
	speak(text: string): void;
};

const VoiceContext = createContext<VoiceServices | null>(null);

class RootStore extends Store {
	voiceServices: VoiceServices | null = null;

	[VoiceContext.provide]() {
		return this.voiceServices;
	}

	@child get editor() {
		return createStore(EditorStore);
	}
}

class EditorStore extends Store {
	get voiceServices() {
		return VoiceContext.consume(this);
	}
}
```

Context is reactive and updates automatically when the provided value changes.
When there is no default, consumption includes `undefined` because a provider may
not exist:

```ts
type User = { name: string };

const UserContext = createContext<User>();
const user = UserContext.consume(store); // User | undefined

if (user) {
	console.log(user.name);
}
```

Use a nullable default when `null` better represents the missing value:

```ts
const UserContext = createContext<User | null>(null);
const user = UserContext.consume(store); // User | null

if (user !== null) {
	console.log(user.name);
}
```

Context is exclusively a Store-tree facility. Models express domain relationships
through child Models, model references, state, ordinary fields, and explicit method
parameters. Passing a Model through Store props keeps it available as an ordinary
typed value; it does not attach the Model to the Store tree or expose Store Context
to that Model.

### Actions and batching

`batch` groups updates to avoid redundant reactions.

```ts
import { batch, updateStore } from "r-state-tree";

batch(() => {
	updateStore(app.todo, { title: "Refactor" });
});
```

### Passing models to stores

Pass domain models to stores as ordinary typed props.

```ts
import { Model, Store, createStore, mount } from "r-state-tree";

class User extends Model {
	@id id = 0;
	name = "";
}

class ProfileStore extends Store<{ user: User }> {
	get name() {
		return this.props.user.name;
	}
}

const user = User.create({ id: 1, name: "Ada" });
const profile = mount(createStore(ProfileStore, { user }));
profile.name; // "Ada"
```

Fallback (no decorators) using `static types`:

```ts
import { Model, Store, createStore, mount, id } from "r-state-tree";

class User extends Model {
	id = 0;
	name = "";
	static types = { id };
}

class ProfileStore extends Store<{ user: User }> {}

const user = User.create({ id: 1, name: "Ada" });
const profile = mount(createStore(ProfileStore, { user }));
profile.props.user.name;
```

Type stores as `Store<Props>`; model values and model arrays use the same prop mechanism as every other dependency.

## Models and snapshots

Models capture persistent state with snapshot utilities.

**Important:** ordinary Model fields are snapshot fields and are **shallow-reactive** at the property level (assignments track), but values are **not auto-wrapped**. If you need nested mutations to be reactive (and to invalidate snapshot caches on in-place mutation), store `observable()` containers or `signal()` values in the field. Mark runtime-only Model fields with `@transient`.

```ts
import { Model, id, applySnapshot, onSnapshot, toSnapshot } from "r-state-tree";

class TodoModel extends Model {
	@id id = 0;
	title = "";
	completed = false;
}

const todo = TodoModel.create({ id: 1, title: "Learn signals" });

const stop = onSnapshot(todo, (snapshot) => {
	console.log(snapshot); // { id: 1, title: "Learn signals", completed: false }
});

todo.title = "Learn r-state-tree";
stop();
```

### Snapshot isolation and failed application

`Model.create(snapshot)` and `applySnapshot(model, snapshot)` do not adopt
incoming arrays or plain objects as live state. A snapshot can be reused to
create independent Models. Treat `toSnapshot()` output as read-only: it can be
cached, and is not deeply frozen.

For Models, `applySnapshot()` batches loading and rollback together. If loading
fails, it undoes its state and child-slot writes, including ID and reference
changes, and throws the original error. Snapshot and diff subscribers do not
receive failed intermediate values or a redundant notification for restored
state. Reactive effects run after loading or rollback finishes. Subscriber errors
after a successful application propagate without triggering rollback.

Rollback is not a general transaction: it does not guarantee the identity of
replaced containers (such as child array proxies), and cannot undo arbitrary
side effects of constructors, accessors or custom runtime code. If custom
runtime behavior prevents a write from being restored, the original load error
still takes precedence. Store hydration clones incoming data, but does not use
Model rollback; applying a snapshot to a mounted Store can reconcile its live
children during the load.

### Snapshot data contract

Snapshots are plain JavaScript representations. r-state-tree creates and loads
the representation; the application owns transport encoding, schema validation,
normalization, and migrations. A snapshot can be passed through Zod and encoded
as JSON, Protobuf, or another format.

- **Primitives**: strings, numbers (including `NaN` and infinities), booleans,
  `null`, and `undefined` pass through.
- **Arrays**: recursively cloned.
- **Plain objects**: recursively cloned (prototype must be `Object.prototype` or `null`).
- **Dates**: serialize to ISO strings (e.g., `"2024-01-15T10:30:00.000Z"`).
- **Signals**: serialize to their current `.value` (recursively cloned).
- **Map/Set/WeakMap/WeakSet and other non-plain objects are rejected** with a descriptive error. Convert persistent values to plain structures or mark runtime-only fields with `@transient`.

`JSON.stringify()` does not preserve every supported snapshot value: it omits
object properties containing `undefined` and converts `NaN` and infinities to
`null`. Applications using JSON should validate or normalize the snapshot before
stringifying it.

```ts
class Event extends Model {
	title = "Meeting";
	createdAt = new Date("2024-01-15T10:30:00.000Z"); // Date → ISO string in snapshot
}

const event = Event.create();
toSnapshot(event);
// { title: "Meeting", createdAt: "2024-01-15T10:30:00.000Z" }
```

When the current runtime value is a `Date`, snapshot hydration converts its ISO
string back into a `Date`. The default runtime shape therefore acts as the
hydration shape for Dates, Signals, arrays, and plain objects.

If an implicit Model snapshot field contains a `Map` or class instance, Model creation fails immediately:

```ts
class M extends Model {
	cache = new Map();
}
M.create(); // ❌ Throws; use @transient for a runtime-only cache
// Error: r-state-tree: snapshots do not support Map at path "cache". ...
```

Convert to a plain structure instead:

```ts
class M extends Model {
	cache: Record<string, unknown> = {}; // ✅ Plain object
}
```

### Snapshot invalidation rules

Snapshots are **memoized computeds**. Once a snapshot is observed (via `onSnapshot`, `onSnapshotDiff`, or `toSnapshot`), subsequent calls return the cached value unless a reactive dependency changes.

During normal application updates, the snapshot cache is invalidated by:

1. **Reassigning** the Model snapshot field itself.
2. **Mutating observable containers** (`observable()`) or **signals** (`signal()`) stored in the field.

**Rule for mutable application state:** Initialize Model arrays/objects/collections
with `observable()` and mutate them directly in place. Plain field values are not
auto-wrapped: mutating them in place leaves the snapshot cache stale—`onSnapshot`
won't fire and `toSnapshot` returns the old cached value. Fix the initialization,
not the mutation semantics; do not introduce copy-and-reassign merely to pass lint.

```ts
class M extends Model {
	tags: string[] = [];

	// ❌ In-place mutation — snapshot cache goes stale
	addTagBroken(tag: string) {
		this.tags.push(tag);
	}
}

class MutableTags extends Model {
	// ✅ Wrap the mutable container; preserve push and its identity.
	tags: string[] = observable([]);

	addTag(tag: string) {
		this.tags.push(tag); // onSnapshot fires
	}
}
```

Whole-field replacement is still valid for intentionally immutable value models.
Such plain values must not be mutated in place; this is a data-model choice, not an
alternative lint repair for mutable state. Copies are also appropriate at genuine
ownership, snapshot, or transport boundaries.

```ts
class ImmutableTags extends Model {
	tags: readonly string[] = [];

	replaceTags(tags: readonly string[]) {
		this.tags = [...tags]; // Own a copy of the incoming immutable value.
	}
}
```

Signals also invalidate snapshot caches when their `.value` changes:

```ts
class Counter extends Model {
	// ✅ signal() — .value updates invalidate cache
	count = signal(0);

	increment() {
		this.count.value++; // onSnapshot fires
	}
}
```

### Snapshots and persistence

- Model snapshots capture ordinary Model fields and durable domain trees. Store
  snapshots capture explicit `@snapshot` session/view fields and keyed reactive children.
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

### Model creation and named factories

`Model.create()` accepts a canonical snapshot. For defaults, identifier generation, normalization, migrations, or external API formats, use a named static factory that prepares the input before calling `create()`:

```ts
class TodoModel extends Model {
	@id id = "";
	title = "";

	static new(title = "Untitled") {
		return this.create({
			id: crypto.randomUUID(),
			title: title.trim(),
		});
	}

	static fromApi(input: ApiTodo) {
		return this.create({
			id: input.todo_id,
			title: input.name.trim(),
		});
	}
}

const todo = TodoModel.new("  Write documentation  ");
todo.title; // "Write documentation"
```

This keeps snapshot hydration predictable: `create(snapshot)` and `applySnapshot(model, snapshot)` both consume the same canonical shape. Named factories make non-canonical inputs and generated values explicit and independently typed. Nested snapshots must already be canonical.

### Model attachment and disposal

Models are inert state trees: creating or attaching one does not start reactions or effects. The public `parent` relationship remains reactive, so an external owner may observe it explicitly when needed:

```ts
const stop = reaction(
	() => todo.parent,
	(parent, previousParent) => {
		if (previousParent) console.log("detached", previousParent);
		if (parent) console.log("attached", parent);
	}
);
```

The external caller owns `stop`. Detachment is reversible. `model[Symbol.dispose]()` is terminal and recursively disposes owned child models, but never model refs.

### Model configuration

Recommended: configure model properties with decorators.

Fallback: if you can't or don't want to use decorators, use `static types`.

```ts
import { Model, id, child, modelRef } from "r-state-tree";

class MetadataModel extends Model {
	note = "";
}

class TagModel extends Model {
	label = "";
}

class User extends Model {
	@id id = 0;
	name = "";
}

class TodoModel extends Model {
	@id id = 0;
	title = "";
	@modelRef(User) assignee?: User; // Reference to another model by ID
	@child(MetadataModel) metadata = MetadataModel.create(); // Nested child model
	@child(TagModel) tags: TagModel[] = []; // Array of child models
}
```

Fallback (no decorators) using `static types`:

```ts
import { Model, id, child, modelRef } from "r-state-tree";

class User extends Model {
	id = 0;
	name = "";
	static types = { id };
}

class TodoModel extends Model {
	id = 0;
	title = "";
	assignee?: User;
	metadata = MetadataModel.create();
	tags: TagModel[] = [];

	static types = {
		id,
		assignee: modelRef(User),
		metadata: child(MetadataModel),
		tags: child(TagModel),
	};
}
```

The `child` and `modelRef` helpers support both single values and arrays. A Model child constructor is required when loading that property from snapshots: use `@child(ChildType)` or `child(ChildType)` in `static types`. Bare `@child` can attach already-created Models, but TypeScript annotations do not supply a runtime constructor.

```ts
class TodoModel extends Model {
	@child(TagModel) tags: TagModel[] = []; // Type-safe array of child models
	@child(TagModel) primaryTag: TagModel | null = null;
}
```

### Model references

Reference models by ID using `@modelRef(ModelType)` (or `modelRef(ModelType)` in `static types`). Assign a model of the exact configured class, not a subclass: identifiers are namespaced by exact runtime class.

```ts
import { child, id, Model, modelRef } from "r-state-tree";

class User extends Model {
	@id id = 0;
	name = "";
}

class ProjectModel extends Model {
	@id id = 0;
	@child(User) users: User[] = [];
	@modelRef(User) owner?: User; // Single reference
	@modelRef(User) assignees: readonly User[] = []; // Read-only resolved membership

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
project.assignees = [project.users[0], project.users[1]]; // Replace all assignees
project[Symbol.dispose]();
```

A reference array is a read-only list of the models that currently resolve in
the tree. Its elements are the actual live models; only the array is frozen.
In-place membership changes such as `push`, `splice` and index writes no longer
work. Repeated reads reuse the list while its dependencies are unchanged.

If you used in-place edits on a reference array, use whole-field assignment
when you intend to replace **all** assignees. Unresolved IDs are omitted from the
resolved list, but stay in snapshots and can resolve later. Building a
replacement from the resolved list will drop any omitted IDs.

#### Mutable membership with explicit IDs

For in-place edits, keep the IDs in an ordinary observable array and resolve
each ID explicitly with `findModelById`. Adding Ada doesn't remove the ID of an
assignee who isn't attached yet:

```ts
import { child, findModelById, id, Model, observable } from "r-state-tree";

class User extends Model {
	@id id = "";
}

class Task extends Model {
	assigneeIds = observable<string[]>([]);
}

class Project extends Model {
	@child(User) users: User[] = [];
	@child(Task) task = Task.create();
}

const project = Project.create({
	users: [{ id: "ada" }],
	task: { assigneeIds: ["missing"] },
});
const { task } = project;
const ada = findModelById(task, User, "ada");
if (ada) task.assigneeIds.push(ada.id);
// "missing" is still stored, though findModelById(task, User, "missing") is undefined.
```

These are different JSON shapes for `JSON.stringify(toSnapshot(task))`:

- `@modelRef(User) assignees`: `{"assignees":[{"id":"missing"},{"id":"ada"}]}`
- Observable `assigneeIds`: `{"assigneeIds":["missing","ada"]}`

Existing reference snapshots and hydration keep their original shape. If you
switch a persisted field to explicit IDs, migrate the saved data before
loading it with the new model. Read IDs from the saved reference objects (not
the resolved list) and write them in order under the new field name, including
any unresolved IDs.

#### Switching between single values and arrays

Both `@child` and `@modelRef` support runtime type switching between single values and arrays:

```ts
class ItemModel extends Model {
	@id id = 0;
	value = 0;
}

class ContainerModel extends Model {
	@child(ItemModel) items: ItemModel | ItemModel[] = []; // Can be single or array

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

## Mutability rules

- Ordinary Store/Model fields track assignment, but do not auto-wrap values. Mutable arrays, objects, Maps, and Sets must be initialized with `observable()` and mutated directly in place (`push`, `shift`, `splice`, index/property writes, `set`, etc.). Wrap nested mutable values explicitly or initialize with `toObservableTree()`. Observable mutations also invalidate Model snapshot caches.
- Do not rewrite mutable operations into spread/`slice()` copy-and-reassign updates merely to satisfy lint. Whole-field replacement remains valid for intentionally immutable value models; copies are also appropriate at genuine ownership, snapshot, or transport boundaries.
- Plain derived/read-only collections need not be observable. Keep getters/computeds pure: never mutate observable or other existing/external state, including shared elements in shallow copies. Constructing and mutating fresh local results is valid.

### `Observable` base class

For class instances that need to be reactive, extending the `Observable` base class is the supported pattern. This ensures compatibility with ES `#private` fields and built-in brand checks because the observable is created in the base constructor, allowing derived field initializers (including `#private`) to run on the observable.

```ts
import { Observable, effect } from "r-state-tree";

class Counter extends Observable {
	count = 0; // Public fields are automatically reactive
	#internal = 0; // Supported, but private fields are not independently reactive

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
const url = observable(new URL("https://example.com"));

// ✅ Composition - wrap a container instead
const state = observable({ url: new URL("https://example.com") });
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
tree.user = { name: "Carol", tags: ["reader"] };
isObservable(tree.user); // false — not wrapped

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

## React integration

See the [React quick start](../README.md#react-quick-start) for installation and
a complete provider example. Import the adapter from `r-state-tree/react`.

### `observer(Component)`

Wraps a function component and rerenders it when an r-state-tree/Preact Signal
read during rendering changes. The result uses React's default `memo` behavior,
so unchanged props do not cause a parent-driven rerender.

`observer` only manages reactive rendering. It does not inspect Store-valued
props, provide Stores, mount Stores, or dispose Stores. Use `StoreProvider`
explicitly at every React lookup boundary.

### `StoreProvider`

Makes one realized Store available to descendants by its exact runtime class.
Providers can be nested, and the nearest provider for the requested class wins.
A subclass provider does not satisfy a lookup for its base Store class.

React provider ancestry is only a view lookup mechanism. It does not change the
r-state-tree ownership parent, mount state, or lifetime of the Store. Unmounting
a provider does not dispose its Store.

### `useStore(StoreType)` and `useOptionalStore(StoreType)`

`useStore(StoreType)` returns the nearest Store provided for that exact class and
throws a descriptive error when none exists. `useOptionalStore(StoreType)` uses
the same lookup but returns `null` when no matching provider exists.

The React adapter is not loaded when importing only `r-state-tree`. Preact
applications can use this entry point through `preact/compat`; native Preact
integration without React compatibility aliases is not currently provided.

### Lazy children, rendering, and SSR

**Store ownership, not React commitment, controls activation.** Reading an
unrealized `@child` on a mounted Store realizes and mounts that child and starts
its owned effects. This can happen during render, before React commits anything.
Neither `observer` nor `StoreProvider` defers activation until commitment or rolls
it back when rendering throws, suspends, or is abandoned.

Consequently, lazy reads during render can acquire resources or start I/O,
including during SSR. Those resources can outlive a view that never committed;
they remain owned by the Store tree until the child is removed/replaced or its
owner is disposed. Strict Mode replay and Suspense retries reuse the same child
while its type and key remain stable; React unmount does not dispose it.

Accept read-triggered activation only when that lifetime is appropriate. If a
resource must start only after a view commits, gate it explicitly through an
application-controlled start/stop boundary, such as a React effect calling Store
methods. If it must not run on the server, supply server-safe dependencies or
disable it explicitly. Lazy realization alone is not a resource-activation guard.

For SSR, create a separate Store root per request and dispose it in `finally`,
including when rendering fails:

```tsx
const store = mount(createStore(RequestStore));
try {
	return renderToString(
		<StoreProvider store={store}>
			<App />
		</StoreProvider>
	);
} finally {
	store[Symbol.dispose]();
}
```

For streaming SSR, retain the root for the stream's lifetime and dispose it on
completion, error, or cancellation—not immediately after creating the stream.

## API surface

- Stores
  - `Store`, `createStore`, `mount`, `updateStore`
- Models
  - `Model`, `Model.create()`
  - Model configuration: ordinary fields are snapshotted; use `@transient`, `@id`, `@child`, and `@modelRef` (or their `static types` equivalents)
- Store configuration
  - decorator `@child` or `static types` with `child`
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

- `@id` values are unique per exact runtime Model class within a tree. Different Model classes may use the same id; subclasses have their own identifier namespace. IDs cannot be cleared to `undefined` after assignment.
- Identifiers are mutable and can be reassigned (including in snapshots) as long as the new id is unused by that exact Model class. A failed reassignment preserves the old id and its references.
- Use `@modelRef(ModelType)` or `modelRef(ModelType)` when ids can overlap across Model classes; references resolve only within the declared Model class.
- `@modelRef(ModelType)` requires an explicit model constructor. The referenced model must have an id and be attached to the tree; the ref becomes `undefined` when the model detaches.
- When a model is re-attached to the same tree, compatible refs restore automatically; attaching to a different root does not restore prior refs.
- `@modelRef` and `@child` can switch between single and array at runtime; reactions observe the property itself rather than internal array mutations.

Use `findModelById` for an optional, typed lookup within a model tree:

```ts
const user = findModelById(root, User, 1); // User | undefined
```

The lookup searches descendants of the current tree root, excluding the tree root itself. You can pass any model in the tree; passing an attached descendant still searches the entire tree, including that descendant. The lookup is reactive inside an effect or computed value, including the first identified child attachment and changes to the supplied model's ancestry. It returns `undefined` when the matching model changes its id, detaches, or is disposed.

### Snapshot diffs

Use `onSnapshotDiff` to receive compact undo/redo payloads. Unchanged fields are omitted. Children are matched by their configured `@id` (or static `id` configuration), not by array position:

- Surviving children carry their identifier plus changed fields; unchanged array children carry only their identifier. Arrays describe the target membership and order.
- Children absent from the other state carry complete snapshots, so undo can recreate a deleted child without losing persisted data. The same applies to inserted and replaced children.
- Children without an established identifier, and transitions between single/array/null shapes, use complete snapshots where recreation may be required.

For a child with `@id id`, deleting `{ id: 1, value: 10 }` from `[ { id: 1, value: 10 }, { id: 2, value: 10 } ]` produces:

```ts
const diff = {
	undo: { items: [{ id: 1, value: 10 }, { id: 2 }] },
	redo: { items: [{ id: 2 }] },
};
```

Record and apply these payloads with the existing snapshot API:

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

## Common pitfalls

- Forgetting stable keys for `@child` arrays causes identity churn.
- Assuming **deep** reactivity: nested plain objects/arrays are not reactive unless you explicitly wrap them (or use `toObservableTree` for initial hydration).
- Mutating plain arrays/objects held in Model fields (`push`, `obj.x = 1`) and expecting snapshots to update. Snapshots are memoized; initialize mutable fields with `observable()` and keep the in-place operations. Do not switch to copy-and-reassign merely to pass lint; reserve whole-field replacement for intentionally immutable values or genuine ownership/snapshot/transport boundaries.
- Passing observables to third‑party APIs that expect cloneable/serializable values (e.g. `structuredClone`). Use `source(value)` to get the backing value. It will be observable-free for values written via r-state-tree’s observable APIs (unwrap-on-write), but `source(...)` is **not** guaranteed observable-free if you manually seed observables into backing sources.
- Creating child stores in constructors: `@child` must be on getters so identity and lifecycle can be managed by the framework.
- Passing props back into child stores during mount can create a recursive mount loop. Break the ownership cycle rather than wiring parent dependencies back through a child during mount.

### Circular store creation

When child stores are created during mount with props that point back into the parent, it is easy to trigger an endless mount loop. The runtime guards this with a descriptive circular-creation error. Break the cycle so dependencies are produced independently of the child mount.
