---
name: r-state-tree
description: Build, review, debug, or refactor applications that use r-state-tree Stores, Models, observables, snapshots, child trees, lifecycle reactions/effects, Store Context, or the first-party React adapter. Use for state-placement decisions, Store/Model design, async ownership, persistence, reactive collection bugs, React observer/StoreProvider wiring, migrations from local adapters, and architecture reviews of r-state-tree code.
---

# r-state-tree

Use the public API documented by the installed package or repository version. When working in the r-state-tree repository, treat `README.md`, `src/`, and tests as authoritative if this skill and the code disagree.

## Workflow

1. Inspect the package version, local project instructions, and existing Store/Model boundaries.
2. Classify changed state before editing:
   - persisted domain data and invariants → `Model`
   - application/session orchestration and owned resources → `Store`
   - tiny local DOM, focus, hover, measurement, or isolated input-draft state → framework-local state
3. Identify ownership and causality:
   - who creates and disposes the root Store;
   - which Store owns each async operation, reaction, timer, or subscription;
   - which method or external callback is the authoritative event boundary;
   - whether a child Store represents a real subsystem rather than a forwarding layer.
4. Implement using public APIs. Do not invent lifecycle hooks, Store constructors, model injection decorators, or framework integration helpers.
5. Verify focused behavior, type declarations, and lifecycle cleanup. For React changes, also verify Strict Mode and SSR when relevant.

## Core rules

- Create root Stores with `mount(createStore(StoreType, props))`; never instantiate a Store with `new`.
- Define child Stores with `@child` getters that return `createStore(...)` descriptors. Give Store arrays stable, unique keys.
- Create Models with `ModelType.create(snapshot?)`; never instantiate a Model with `new`.
- Put serializable domain state and invariants in Models. Put workflow/session state, I/O coordination, timers, and mounted resources in Stores.
- Treat Store props as reactive. Update realized Store props with `updateStore()`.
- Use Store Context from `createContext()` only within the Store ownership tree. Do not confuse it with React Context.
- Register mount-scoped synchronization with `this.reaction()` and resources/setup with `this.effect()` in the constructor. Reactions skip their initial callback.
- Use `this.signal` for terminal Store-lifetime cancellation. Use separate operation controllers or revisions for take-latest, retries, queues, or user cancellation.
- Prefer direct consequences at authoritative methods/callbacks over assigning state and adding a reaction merely to rediscover the same event.
- Do not read lazy child getters only to start their effects. Move always-on work to the parent owner or let a real consumer materialize the child.
- Keep observable collections observable and mutate them in place. `observable()` is shallow unless nested values are wrapped explicitly or initialized with `toObservableTree()`.
- Dispose terminal Store and Model roots with `[Symbol.dispose]()` when their owner ends.

## React rules

- Import `observer`, `StoreProvider`, `useStore`, and `useOptionalStore` from `r-state-tree/react`.
- `observer()` only subscribes to reactive reads and memoizes the function component. It does not provide, mount, reparent, or dispose Stores.
- Establish every React lookup scope explicitly with `<StoreProvider store={store}>`.
- `useStore(StoreType)` performs exact-class lookup and throws when missing. `useOptionalStore(StoreType)` returns `null` when missing.
- React provider ancestry never changes r-state-tree Store ownership.
- Preact may use the React adapter through `preact/compat`; native Preact integration is a separate design concern.

Read [references/react.md](references/react.md) for React implementation and migration work.

## Select references

- Read [references/core-api.md](references/core-api.md) when creating Stores, Models, child trees, Context, snapshots, or observables.
- Read [references/lifecycle-and-async.md](references/lifecycle-and-async.md) for effects, reactions, disposal, polling, async commands, hydration, or external resources.
- Read [references/react.md](references/react.md) for React/Preact wiring, provider boundaries, SSR, Strict Mode, or adapter migration.
- Read [references/architecture-and-refactoring.md](references/architecture-and-refactoring.md) for state placement, Store decomposition, architecture reviews, or large refactors.

## Completion check

- Confirm Models contain persisted domain state and Stores contain session/orchestration state.
- Confirm Store/Model creation uses the supported factories.
- Confirm lazy children are not eagerly materialized as hidden startup services.
- Confirm async work has both a Store-lifetime policy and an operation concurrency policy.
- Confirm persistence cannot overwrite hydrated state with constructor defaults.
- Confirm React lookup scopes are explicit and provider unmount does not dispose Stores.
- Run the repository's focused tests, type checks, and build in proportion to the change.
