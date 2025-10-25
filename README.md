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

Use `@child` for single child stores and `@children` for arrays.

```ts
import { child, children } from "r-state-tree";

class ListStore extends Store {
	items = ["Buy milk", "Walk dog"];

	@children get todos() {
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
		this.createReaction(
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

`runInBatch` groups updates to avoid redundant reactions.

```ts
import { runInBatch } from "r-state-tree";

runInBatch(() => {
	app.todo.props.title = "Refactor";
});
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

### Model decorators

Use decorators to configure model properties:

```ts
import {
	Model,
	state,
	identifier,
	child,
	children,
	modelRef,
	modelRefs,
} from "r-state-tree";

class User extends Model {
	@identifier id = 0;
	@state name = "";
}

class TodoModel extends Model {
	@identifier id = 0;
	@state title = "";
	@modelRef assignee?: User; // Reference to another model by ID
	@child metadata = MetadataModel.create(); // Nested child model
	@children tags: TagModel[] = []; // Array of child models
}
```

### Model references

Reference models by ID using `@modelRef` and `@modelRefs`:

```ts
class ProjectModel extends Model {
	@identifier id = 0;
	@children users: User[] = [];
	@modelRef owner?: User;

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
