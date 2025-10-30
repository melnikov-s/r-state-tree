# r-state-tree

Reactive state management featuring store trees, computed child stores, and snapshot utilities backed by `@preact/signals-core`.

## Installation

```bash
pnpm add r-state-tree
```

### Requirements

This library uses [TC39 Stage 3 Decorators](https://github.com/tc39/proposal-decorators) and requires TypeScript 5.0+ with `target: "es2022"` or higher.

The library includes a decorator metadata polyfill for runtimes that don't yet natively support `Symbol.metadata`.

## Stores

Stores describe reactive state containers composed into a tree.

```ts
import { Store, createStore, mount, child } from "r-state-tree";

class TodoStore extends Store {
	props = { title: "" };

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

Plain objects wrapped with `observable()` use implicit reactivity for backward compatibility:

```ts
import { observable, effect } from "r-state-tree";

const state = observable({ count: 0 });

effect(() => {
	console.log(state.count); // All properties are reactive
});

state.count++; // Triggers the effect
```

## Models and snapshots

Models capture persistent state with snapshot utilities.

```ts
import {
	Model,
	state,
	identifier,
	applySnapshot,
	onSnapshot,
	toSnapshot,
} from "r-state-tree";

class TodoModel extends Model {
	@identifier id = 0;
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

### Model decorators

Use decorators to configure model properties:

```ts
import { Model, state, identifier, child, modelRef } from "r-state-tree";

class User extends Model {
	@identifier id = 0;
	@state name = "";
}

class TodoModel extends Model {
	@identifier id = 0;
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
	@identifier id = 0;
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
	@identifier id = 0;
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
