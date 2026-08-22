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
- Put serializable domain state and invariants in Models. Ordinary Model fields are snapshotted by default; mark runtime-only fields `@transient`. Put workflow/session state, I/O coordination, timers, and mounted resources in Stores; opt individual Store fields into snapshots with `@snapshot`.
- Treat Store props as reactive. Update realized Store props with `updateStore()`.
- Use Store Context from `createContext()` only within the Store ownership tree. Do not confuse it with React Context.
- Register mount-scoped synchronization with `this.reaction()` and resources/setup with `this.effect()` in the constructor. Reactions skip their initial callback.
- Use `this.signal` for terminal Store-lifetime cancellation. Use separate operation controllers or revisions for take-latest, retries, queues, or user cancellation.
- Prefer direct consequences at authoritative methods/callbacks over assigning state and adding a reaction merely to rediscover the same event.
- Keep transport mechanics behind an adapter boundary. Workflow Stores depend on intent-level ports such as `startImport()` or `saveDraft()`, not generic `request()`, `invoke()`, `dispatch()`, or `fetch()` clients and their RPC/IPC/HTTP DTOs. A Store may own raw protocol details only when transport integration is its explicit behavioral responsibility.
- Treat Store classes as reusable stateful component definitions. Create independent instances with `createStore()`, compose them with `@child`, and prefer configuration and composition over application Store inheritance. Let parent Stores coordinate workflows while child Stores retain ownership of their reusable behavior and lifecycle.
- Treat root, application, shell, page, and window Stores as composition boundaries, not default owners for everything in their scope. Scope names describe lifetime or placement, not a cohesive behavioral responsibility. Give independently evolving product surfaces focused Stores, just as independently evolving UI surfaces receive focused components.
- Place new state in the nearest cohesive owner, not merely the nearest existing Store. Existing concentration of unrelated state is a refactoring signal, not precedent for adding another field, effect, or command there.
- Keep command preconditions with the Store that owns the command. Across Store boundaries, call an intent method such as `tryExitFocusMode()` instead of reading `isFocusMode` and then calling `exitFocusMode()` yourself.
- Do not read lazy child getters only to start their effects. Move always-on work to the parent owner or let a real consumer materialize the child.
- Keep observable collections observable and mutate them in place. Once a field holds an `observable()` array, object, `Map`, or `Set`, do not replace it with a copied container such as `{ ...field }`, `[...field]`, `field.slice()`, `field.filter(...)`, or `field.map(...)`; mutate the existing observable container instead. Copy only when producing a plain derived value or crossing a snapshot, persistence, or transport boundary. `observable()` is shallow unless nested values are wrapped explicitly or initialized with `toObservableTree()`.
- Every Store/Model field is observable at the assignment level only. A field declared or assigned a plain array or object (for example `ids: string[] = []`) is an inert value: in-place `push`/`splice`/index/property writes on it notify no one. Initialize collections with `observable()` and mutate them in place, or reassign the whole field (`this.ids = [...this.ids, id]`). Never call `push` or `splice` on a collection that was not wrapped with `observable()`.
- Dispose terminal Store and Model roots with `[Symbol.dispose]()` when their owner ends.

## React rules

- Import `observer`, `StoreProvider`, `useStore`, and `useOptionalStore` from `r-state-tree/react`.
- `observer()` only subscribes to reactive reads and memoizes the function component. It does not provide, mount, reparent, or dispose Stores.
- Establish every React lookup scope explicitly with `<StoreProvider store={store}>`.
- `useStore(StoreType)` performs exact-class lookup and throws when missing. `useOptionalStore(StoreType)` returns `null` when missing.
- React provider ancestry never changes r-state-tree Store ownership.
- Tracking follows reactive reads across boundaries: reading one Store's state through another Store's props subscribes the observer to the held Store, materializing a lazy `@child` getter during a render is safe, and `createStore` with the same key reconciles to the existing child instance.
- Preact may use the React adapter through `preact/compat`; native Preact integration is a separate design concern.

Read [references/react.md](references/react.md) for React implementation and migration work.

## Select references

- Read [references/core-api.md](references/core-api.md) when creating Stores, Models, child trees, Context, snapshots, or observables.
- Read [references/lifecycle-and-async.md](references/lifecycle-and-async.md) for effects, reactions, disposal, polling, async commands, hydration, or external resources.
- Read [references/react.md](references/react.md) for React/Preact wiring, provider boundaries, SSR, Strict Mode, or adapter migration.
- Read [references/architecture-and-refactoring.md](references/architecture-and-refactoring.md) for state placement, Store decomposition, architecture reviews, or large refactors.

## Completion check

- Confirm Models contain persisted domain state and Stores contain session/orchestration state.
- Confirm each named workflow or product surface has a cohesive Store owner, and that no root or shell Store has absorbed unrelated surfaces merely because they share its lifetime.
- Confirm Store/Model creation uses the supported factories.
- Confirm lazy children are not eagerly materialized as hidden startup services.
- Confirm async work has both a Store-lifetime policy and an operation concurrency policy.
- Confirm workflow Stores call intent-level external-system ports and do not construct transport envelopes, command discriminants, or correlation DTOs.
- Confirm every observable collection retains its identity: reject assignments that replace an observable-backed field with a spread, `slice`, `filter`, `map`, or another newly allocated container. Require in-place mutation through the observable wrapper; allow copies only as outbound plain values.
- Confirm no in-place mutation (`push`, `splice`, index write, property write) targets a plain array or object held in a Store/Model field; such values are inert and must either be wrapped with `observable()` or reassigned wholesale.
- Confirm persistence cannot overwrite hydrated state with constructor defaults.
- Confirm React lookup scopes are explicit and provider unmount does not dispose Stores.
- Run the repository's focused tests, type checks, and build in proportion to the change.
