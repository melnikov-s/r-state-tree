# Architecture and refactoring

Use this reference for feature state placement, Store decomposition, architecture reviews, and large refactors.

## Classify feature state

Before substantial feature work, record:

- feature surface and user workflow;
- persisted domain entities and their owning Models;
- persistence/hydration boundary;
- session/workflow state and its owning Stores;
- local framework state and why it remains local;
- external resources and their lifecycle owner.

Place state in the nearest cohesive owner. Do not use the nearest existing Store merely because it is convenient or already large. If a feature introduces a named product surface, an independent workflow, its own async policy, or its own lifecycle, create or use the focused Store that represents that boundary.

## Stores as behavioral components

A Store owns a behavioral surface:

- state and derived state;
- owned effects and reactions;
- timers, subscriptions, and async commands;
- child Stores;
- an intent-level public API.

Root, application, shell, page, and window Stores are composition and coordination boundaries. Their broad scope describes lifetime or placement; it does not make every workflow in that scope one behavioral surface. They may own true cross-cutting event routing or lifecycle work, but named product surfaces should retain their own state, effects, async policy, and intent API in focused Stores.

Extract a focused Store when a Store accumulates unrelated reaction groups, independent async workflows, separate loading/error states, distinct modes, or cleanup for one coherent subsystem. Do this as soon as the boundary is clear; do not wait for a file-size threshold or a second feature request. Existing concentration of unrelated behavior is a refactoring signal, not precedent for placing the next feature there.

File length is only a prompt to inspect boundaries. Do not split a Store merely to reduce line count.

## Child boundary test

A child Store should own at least one meaningful combination of state, lifecycle, orchestration, or a coherent UI/workflow subsystem.

Do not create:

- thin wrappers that only forward Model fields and methods;
- registries that merely reshuffle parent state;
- action-named child Stores for one small command and a loading flag;
- mechanical façades that reproduce another child Store's complete API.

Keep a small command on its existing owner. Extract it when it gains independent policy, lifecycle, reuse, multiple coordinated operations, or a real UI surface.

## Constructor audit

Treat the constructor as a compact summary of mounted resources and genuine synchronization.

For each reaction ask:

1. Who writes every tracked value?
2. Is there an authoritative method or callback that already receives the event?
3. Is the callback repairing a Model invariant that belongs in the Model mutation?
4. Are tracked sources intentionally independent?
5. Does the reaction own private bookkeeping, async sequencing, cancellation, timers, or cleanup that indicates a separate workflow?

Several unrelated registrations are evidence that the Store owns several behavioral surfaces, not an automatic error.

## Reuse through composition

Think of a Store class like a stateful component definition. The class describes one behavioral unit; each `createStore()` call creates an independent instance with its own state, identity, child tree, effects, and lifetime. Reuse the same Store class anywhere that behavior is needed, including multiple times beneath one parent.

```ts
class SelectionStore extends Store<{items: Item[]}> {
  selectedId: string | null = null

  select(id: string) {
    if (this.props.items.some((item) => item.id === id)) {
      this.selectedId = id
    }
  }
}

class WorkspaceStore extends Store<{
  primaryItems: Item[]
  secondaryItems: Item[]
}> {
  @child get primarySelection() {
    return createStore(SelectionStore, {
      key: 'primary',
      items: this.props.primaryItems,
    })
  }

  @child get secondarySelection() {
    return createStore(SelectionStore, {
      key: 'secondary',
      items: this.props.secondaryItems,
    })
  }
}
```

Prefer composing Store instances over inheriting one application Store from another. Application Store inheritance couples specializations to internal fields, lifecycle registrations, and implementation details. Extend the framework's `Store<Props>` base class, then express variation through reactive props, Context dependencies, callback capabilities, or intent-level methods.

A parent Store may own a larger workflow while a child Store owns one reusable subsystem. The parent decides when and why to invoke the child; the child retains its state, invariants, resources, effects, async policy, and cleanup. Do not copy that behavior into the parent merely because the surrounding workflow is specialized.

When a reusable Store lacks a legitimate variation point, add the narrowest stable configuration seam instead of forking its implementation. During architecture review, compare Stores that manage similar resources: repeated state fields, effects, transport setup, persistence, retry logic, or cleanup usually indicate a missed composition boundary.

## Public API design

Expose intent-level methods such as `startQuiz()`, `retryLoad()`, or `selectItem(id)`. Components should not assemble application workflows themselves.

Expose semantic queries such as `canSubmit`, `hasAttachments`, or `nextAction` when they hide representation details. This is different from mechanically forwarding every child collection and setter.

Apply “tell, don't ask” across Store boundaries. Keep a command's preconditions with the Store that owns the command; do not read another Store's state solely to decide whether to invoke its method.

```ts
// Avoid: the coordinator leaks the viewer's exit precondition.
if (this.viewerShellStore.isFocusMode) {
  this.viewerShellStore.exitFocusMode()
  return true
}

// Prefer: the owning Store checks its state and reports whether it acted.
return this.viewerShellStore.tryExitFocusMode()
```

```ts
tryExitFocusMode(): boolean {
  if (!this.isFocusMode) return false
  this.exitFocusMode()
  return true
}
```

The coordinating Store still decides when to attempt the operation; the owning Store decides whether the operation is valid and how to perform it. Also use semantic queries such as `canSubmit`, `hasAttachments`, or `nextAction` when callers genuinely need information rather than an operation.

Pass narrow callback capabilities to external strategies and adapters. Do not hand an entire mutable Store to code that needs only one value and one intent callback.

An external-system adapter owns its complete synchronization contract: subscription, observable updates, completion signaling, error behavior, and cleanup. Do not leak tick counters or manual invalidation signals to consumers.

## External-system and transport boundaries

Workflow Stores should name application intent, while an adapter at the external-system boundary owns transport mechanics. Do not inject a generic RPC, IPC, HTTP, connector, or persistence client into a workflow Store and make the Store construct command discriminants, endpoint paths, serialization envelopes, correlation fields, or transport-shaped response unions.

```ts
// Avoid: workflow state knows the IPC protocol.
await this.props.api.request({
  type: "start-import",
  requestId,
  sourcePath,
})

// Prefer: the Store depends on an application port.
await this.props.importClient.startImport({ operationId, sourcePath })
```

The adapter implements the intent-level port and privately maps it to the transport:

```ts
interface ImportClient {
  startImport(input: { operationId: string; sourcePath: string }): Promise<void>
  cancelImport(operationId: string): Promise<void>
  subscribe(listener: (event: ImportEvent) => void): () => void
}

const importClient: ImportClient = {
  async startImport(input) {
    await ipc.invoke("import:request", {
      type: "start",
      requestId: input.operationId,
      sourcePath: input.sourcePath,
    })
  },
  // ...
}
```

This is more than renaming `request()` to `client`: the port must remove transport-only choices from the Store and expose stable application semantics. Keep protocol schemas and validation at the process or network boundary. Translate transport errors and events into application-owned results before they reach ordinary workflow Stores.

Pass a port used by one owner through typed Store props. If multiple descendants need the same ambient capability, provide one narrowly named Store Context at their common Store ancestor and consume it directly; do not alternate between props and Context for the same dependency. A Store whose explicit behavioral purpose is transport integration may own raw protocol details, but application workflow Stores should not.

## Cross-Store coordination

Parent Stores compose children and may coordinate multi-child workflows. Avoid computed traversal that materializes unrelated lazy children solely to observe them.

Prefer:

- direct Model access for domain invariants;
- reactive child props for child-owned inputs;
- Store Context for one narrowly named ambient dependency;
- intent-level callbacks for later cross-boundary events;
- moving always-on work to the parent that actually owns it.

Use one dependency source end-to-end. Do not consume Context in an intermediary merely to spread the same values into a generic prop bag.

## Extraction recipe

1. Name one coherent subsystem.
2. Move its state, derived getters, registrations, timers, async methods, and cleanup together.
3. Pass Models and ordinary dependencies through typed Store props, or consume one narrow Store Context.
4. Keep the parent responsible for composition and true cross-workflow coordination.
5. Give the child an intent-level API.
6. Remove parent methods that only forward one-for-one to the child.
7. Verify the parent can mount without materializing optional child subsystems.
8. Test the extracted Store independently and through its real consumer.

## Review checklist

- Domain state and invariants live with Models.
- Workflow/session state and resources live with Stores.
- Named product surfaces and independently evolving workflows have focused Store owners.
- Root and shell Stores remain composition, lifecycle, event-routing, and genuine cross-workflow coordination boundaries rather than collections of unrelated feature state.
- New state was placed by behavioral cohesion, not by choosing whichever existing Store was closest or largest.
- Local UI state is genuinely local.
- Observable collections are initialized as observable before in-place mutation.
- Reactions coordinate independent sources rather than hide an existing event boundary.
- Lazy child getters are not startup calls.
- Async commands declare concurrency and late-commit policy.
- Persistence waits for hydration.
- Parent APIs add semantics or orchestration instead of mechanically forwarding children.
- Workflow Stores use intent-level external-system ports; transport envelopes and protocol response unions stay in boundary adapters.
- React provider topology is explicit and separate from Store ownership.
