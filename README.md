# r-state-tree

Reactive state management featuring store trees, computed child stores, and snapshot utilities backed by `@preact/signals-core`.

## Installation

```bash
pnpm add r-state-tree
```

## Stores

Stores describe reactive state containers composed into a tree.

```ts
import Store, { createStore, mount } from "r-state-tree";
import { child } from "r-state-tree/decorators";

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
import Model from "r-state-tree/model/Model";
import {
	applySnapshot,
	onSnapshot,
	onSnapshotDiff,
	toSnapshot,
} from "r-state-tree";

class TodoModel extends Model {
	static types = {
		title: stateType,
		assignee: modelRefType,
	};

	title = "";
}

const todo = new TodoModel();

const stop = onSnapshot(todo, (snapshot) => {
	console.log(snapshot.title);
});

applySnapshot(todo, { title: "Learn signals" });
stop();
```

### Snapshot diffs

Use `onSnapshotDiff` to receive undo/redo payloads.

```ts
const off = onSnapshotDiff(todo, ({ undo, redo }) => {
	// undo and redo contain patch-like snapshots
});
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
