# r-state-tree

Reactive state management for applications with domain data, workflows, and owned resources.

- **Models** hold domain state and invariants, with snapshots, identifiers, and references.
- **Stores** own application/session behavior, child Stores, and mounted resources.
- **Views** read reactive state and call intent-level methods. Small local UI state can stay in the UI framework.

## Installation

```bash
pnpm add r-state-tree
```

The quick start uses `static types` and needs no decorator transform. If you prefer
`@child`, `@id`, or other decorators, use standard (Stage 3) decorators, not legacy
`experimentalDecorators`. See [tested toolchains and configuration](docs/toolchains.md);
a TypeScript target setting alone does not configure every bundler's decorator pipeline.

TypeScript consumers need TypeScript 5.2+ and `ESNext.Disposable` in
`compilerOptions.lib` because Store/Model expose `Disposable` and `Symbol.dispose`,
even without decorators. Include `DOM` for `AbortSignal` (or equivalent host types).

Runtimes need ES2022, `AbortController`, and `Symbol.dispose`; provide a disposal
polyfill if your runtime lacks it. The library includes a `Symbol.metadata`
polyfill, not a disposal polyfill. Core does not require React.

Use one copy and module format of r-state-tree for code that shares Stores,
Models, or observables. Node can load both the ESM and CommonJS exports in the
same process, but they have separate constructors and runtime registries. A
Model or Store made with `import` is not recognized by APIs such as `toSnapshot`
loaded with `require`, or vice versa. Use a single module format across your
integration, or pass plain data instead of live instances at the boundary.

## Quick start

Create a Model for domain state and a Store for view behavior. This example is
self-contained TypeScript and uses no decorators:

```ts
import { Model, Store, createStore, id, mount, toSnapshot } from "r-state-tree";

class CounterModel extends Model {
	id = "counter";
	count = 0;
	static types = { id };

	increment() {
		this.count++;
	}
}

class CounterStore extends Store<{ counter: CounterModel }> {
	get label() {
		return `Count: ${this.props.counter.count}`;
	}

	increment() {
		this.props.counter.increment();
	}
}

const counter = CounterModel.create({ id: "main", count: 0 });
const store = mount(createStore(CounterStore, { counter }));
store.increment();
console.log(store.label); // "Count: 1"
console.log(toSnapshot(counter)); // { id: "main", count: 1 }

store[Symbol.dispose]();
counter[Symbol.dispose](); // Model passed through props is not owned by the Store
```

A Model is optional when a feature only needs session state. A Store is optional
when a view can render a Model directly without orchestration or owned resources.

### Descriptors and realized Stores

`createStore(Type, props)` returns a **descriptor**, not a usable Store instance.
Its TypeScript return type is the Store class for child-getter ergonomics; do not
read state, call methods, or dispose it before realization.

- `mount(descriptor)` realizes and mounts a root Store.
- A Store's `@child` getter (or `static types = { childName: child }`) returns
  descriptors; the framework exposes realized children to the getter's caller.
- Reconciliation preserves children with matching keys and compatible Store types
  **within the same parent's child property**. Keys are not a global cache, and
  repeated `createStore()` calls do not return the same object.
- Use stable, unique keys for child arrays. Removing a child disposes it; adding
  its key again later creates a new instance.

See [child Stores and identity](docs/reference.md#child-store-keys-and-identity).

## React quick start

Install the optional React peers:

```bash
pnpm add react @preact/signals-react
```

This independent TSX example takes an externally owned, mounted Store:

```tsx
import { Store } from "r-state-tree";
import { observer, StoreProvider, useStore } from "r-state-tree/react";

export class CounterStore extends Store {
	count = 0;

	increment() {
		this.count++;
	}
}

const Counter = observer(function Counter() {
	const store = useStore(CounterStore);
	return <button onClick={() => store.increment()}>{store.count}</button>;
});

export function App({ store }: { store: CounterStore }) {
	return (
		<StoreProvider store={store}>
			<Counter />
		</StoreProvider>
	);
}
```

The application owner creates the Store with `mount(createStore(CounterStore))`
and disposes it when its lifetime ends. Do not mount it during React rendering.
`observer` tracks render-time reads; `StoreProvider` only supplies exact-class
lookup. Neither mounts, reparents, nor disposes Stores. A component may read
multiple Stores; no adapter Store is required just to combine reads.

Reading a lazy child on a mounted Store can start effects during rendering,
including SSR; React commitment does not control activation or roll it back.
See [lazy children, rendering, and SSR](docs/reference.md#lazy-children-rendering-and-ssr)
for lifetime gating and request-root cleanup, and the
[React reference](docs/reference.md#react-integration) for lookup and Preact compatibility.

## Learning path

1. [Architecture guidance](docs/architecture.md): state placement, behavioral ownership, props versus Context, and async policy.
2. [Store reference](docs/reference.md#stores): props, children, snapshots, mounted effects, and disposal.
3. [Models and snapshots](docs/reference.md#models-and-snapshots): hydration, identifiers, references, and persistence contracts.
4. [Reactivity and mutability](docs/reference.md#mutability-rules): shallow tracking, observable containers, and signals.
5. [API surface](docs/reference.md#api-surface): exported helpers and advanced snapshot diffs.

Store and Model fields track assignment, not arbitrary nested mutation. Mutable
arrays, objects, Maps, and Sets must use `observable()` containers and be mutated
directly in place outside getters/computeds. Do not rewrite mutations as
copy-and-reassign merely to satisfy lint. Whole-field replacement is valid for
intentionally immutable value models; copies also belong at genuine ownership,
snapshot, or transport boundaries. Plain derived/read-only collections need not
be observable. Getters/computeds must not mutate existing state or shared elements
of copies. For Model children hydrated from snapshots, supply a runtime
constructor such as `@child(User)` or `static types = { users: child(User) }`.

## Development tools

- [Live inspection](docs/inspection.md): opt-in Chromium DevTools and a local Vite-to-MCP bridge, with separate controls and activity recording options.
- [Lint rules](lint/README.md): opt-in Oxlint rules for factories, getter purity, and collection reactivity.
- [Agent skill](skills/r-state-tree/SKILL.md): architecture, lifecycle, React, and review guidance. Also shipped at `node_modules/r-state-tree/skills/r-state-tree`.

## Repository development

Use Node.js 24 LTS and pnpm. The repository pins TypeScript 7, Vite 8, and Vitest 5;
see [the toolchain table](docs/toolchains.md#tested-repository-configurations) for decorator handling.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
```

`pnpm test` runs Vitest and type checks. `pnpm lint` checks Oxlint rules, lint
fixtures, and formatting; `pnpm format` applies formatting.

The package uses `"type": "module"`: ESM bundles and shared chunks use `.js`,
while CommonJS bundles and shared chunks use `.cjs`. Builds emit both formats
and declarations under `dist/`. Package exports select the appropriate format.
Declarations use explicit `.js` import paths for Node-style TypeScript resolution
and retain public API comments.

```bash
pnpm test:package
```

This is a clean-package smoke test using the current Node process and the
repository's installed TypeScript and React versions. It packs the library,
extracts the archive with `tar` to check relative documentation file links,
and installs the tarball outside the checkout. The consumers check CJS and ESM
separately, the mixed-format runtime boundary, strict declarations, core without
optional peers, and React SSR. No alternate runtimes or compilers are downloaded.

Registry access is required for the clean consumer installs. After building,
`node scripts/package-consumers.js --local` runs the archive and consumer checks
without network or installs, using links to the checkout's installed dependencies.
This does not test registry or npm peer resolution. Temporary consumers are removed;
set `KEEP_PACKAGE_CONSUMERS=1` to retain them for debugging.
`prepublishOnly` runs the unit/type tests and this smoke test before publishing.
The declaration build uses `moduleDetection: legacy` so the virtual inspector
module declaration remains an ambient declaration rather than an augmentation.

## License

MIT
