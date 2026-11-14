# React integration

Use this reference for `r-state-tree/react`, provider design, SSR, Strict Mode, Preact compatibility, or migration from a local adapter.

## Install and import

Install the optional peers:

```bash
pnpm add react @preact/signals-react
```

Import framework integration only from the subpath:

```ts
import {
	observer,
	StoreProvider,
	useOptionalStore,
	useStore,
} from "r-state-tree/react";
```

Importing only `r-state-tree` does not load React.

## Explicit provider boundary

`observer()` subscribes a function component to r-state-tree/Preact Signal reads during rendering and applies React's default memo behavior. It does not inspect Store props or create providers.

Establish lookup scope explicitly:

```tsx
function WorkspaceBoundary({ store }: { store: WorkspaceStore }) {
	return (
		<StoreProvider store={store}>
			<Workspace />
		</StoreProvider>
	);
}

const Workspace = observer(function Workspace() {
	const store = useStore(WorkspaceStore);
	return <button onClick={() => store.refresh()}>{store.title}</button>;
});
```

If the boundary itself reads reactive Store fields, observe it and use its prop directly. The provider becomes visible only to descendants:

```tsx
const WorkspaceBoundary = observer(function WorkspaceBoundary({
	store,
}: {
	store: WorkspaceStore;
}) {
	return (
		<StoreProvider store={store}>
			<h1>{store.title}</h1>
			<WorkspaceBody />
		</StoreProvider>
	);
});
```

Prefer splitting a boundary wrapper and observed content when that makes one lookup style consistent across the feature.

## Tracking boundaries

Tracking follows reactive reads, not component or Store boundaries:

- **Store-to-Store props.** Store `props` are observable. When a Store holds another Store as a prop, reads through that prop (for example `this.props.catalog.projectSessions(path)`) subscribe the rendering observer to the held Store's state. Mutations in the held Store re-render observers that read through the chain.
- **Lazy children during render.** The first read constructs (or reconciles) the child and tracks reads of its state. On a mounted parent this also mounts the child and starts its effects, even before React commits or during SSR. Activation is not rolled back when rendering throws, suspends, or is abandoned; accept this only when Store-tree lifetime is appropriate, or gate resource startup explicitly.
- **Descriptors and keyed reconciliation.** Every `createStore(ChildStore, { key })` call returns a fresh descriptor, even though its public TypeScript return type is the Store class. It is not a lookup or a usable instance. The `@child` wrapper reconciles descriptors into realized children, preserving matching keys and compatible Store types within that parent's child property. A key does not share instances across parents or properties; removing a child disposes it, so re-adding its key creates a new instance. Child getters that map over observable arrays are tracked through the array read.

Keep presentation reads in their actual observed consumer; shared getters and child descriptors should not eagerly read unrelated loading/error fields. Preserve eager semantic dependencies and computed caching. See [reactive dependency placement](../SKILL.md#read-reactive-state-at-the-consumer) for helper, spread, and callback pitfalls.

If a consumer still sees stale UI, suspect an untracked read (an inert plain collection or a value captured outside the render) before suspecting these boundaries.

## Lookup semantics

- `useStore(StoreType)` returns the nearest provider for the exact runtime class and throws descriptively when absent.
- `useOptionalStore(StoreType)` returns `null` when absent.
- Nested same-class providers shadow outer providers naturally.
- A subclass provider does not satisfy lookup for its base class.
- A provider accepts one realized Store.
- Provider unmount does not dispose, mount, reparent, or otherwise own the Store.

React Context ancestry is a view lookup mechanism. r-state-tree ownership comes only from the Store tree created through root `mount()` and `@child` relationships.

## Component design

Use framework-local state and effects for local view concerns such as focus, measurement, browser event listeners, animation, or isolated drafts. Move shared session state, business orchestration, persistence, and cross-component workflows into Stores.

Use explicit providers when descendants need class-based lookup, or pass Stores and presentation values as ordinary props. A component may read several Stores; do not add a forwarding Store just to combine reads. Store ownership need not mirror the component tree.

`observer()` supports function components. Keep reactive reads inside the observed render path. Do not rely on module-global flags to identify observed rendering.

## Migration from a local adapter

When replacing an adapter that automatically provided Store-valued props:

1. Replace imports with `r-state-tree/react`.
2. Find observed components that receive a Store prop and whose descendants call `useStore()` for that class.
3. Add an explicit `StoreProvider` at each actual feature boundary.
4. Add providers to standalone tests and stories that previously depended on implicit behavior.
5. Delete runtime prop inspection, `instanceof Store` discovery, implicit provider ordering, and observed-boundary globals.
6. Verify missing-provider errors reveal any overlooked boundary.

Do not preserve automatic provisioning in a compatibility wrapper unless the application explicitly requires that separate legacy behavior.

## SSR, Strict Mode, and multiple instances

The adapter delegates tracking to `@preact/signals-react/runtime`. SSR tracking works without browser globals, but lazy child reads can still activate Store-owned effects and I/O. Create a separate root per request and dispose it in `finally`, including failed renders. For streaming SSR, retain the root until completion, error, or cancellation. Use server-safe dependencies or explicit startup gating when effects must not run on the server. Test server rendering with `react-dom/server`.

Under Strict Mode, assert observable behavior and cleanup rather than exact development render counts. Verify provider unmount leaves the Store alive unless its external owner disposes it.

When rendering several instances, update one Store and verify unrelated component instances do not rerender.

## Preact compatibility

Use `r-state-tree/react` in Preact applications through `preact/compat` aliases for `react`, `react-dom`, and JSX runtime imports. This is compatibility mode, not a native Preact API. Do not claim native `r-state-tree/preact` support unless that entry point exists and is separately tested.
