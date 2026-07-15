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

Prefer the nearest existing owner for a first implementation. Extract only when a coherent boundary appears.

## Stores as behavioral components

A Store owns a behavioral surface:

- state and derived state;
- owned effects and reactions;
- timers, subscriptions, and async commands;
- child Stores;
- an intent-level public API.

Consider extracting a child Store when a Store accumulates unrelated reaction groups, independent async workflows, separate loading/error states, distinct modes, or cleanup for one coherent subsystem.

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

## Public API design

Expose intent-level methods such as `startQuiz()`, `retryLoad()`, or `selectItem(id)`. Components should not assemble application workflows themselves.

Expose semantic queries such as `canSubmit`, `hasAttachments`, or `nextAction` when they hide representation details. This is different from mechanically forwarding every child collection and setter.

Apply “tell, don't ask” across Store boundaries when consumers repeatedly reconstruct a concept from several internal flags or collections.

Pass narrow callback capabilities to external strategies and adapters. Do not hand an entire mutable Store to code that needs only one value and one intent callback.

An external-system adapter owns its complete synchronization contract: subscription, observable updates, completion signaling, error behavior, and cleanup. Do not leak tick counters or manual invalidation signals to consumers.

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
- Local UI state is genuinely local.
- Observable collections are initialized as observable before in-place mutation.
- Reactions coordinate independent sources rather than hide an existing event boundary.
- Lazy child getters are not startup calls.
- Async commands declare concurrency and late-commit policy.
- Persistence waits for hydration.
- Parent APIs add semantics or orchestration instead of mechanically forwarding children.
- React provider topology is explicit and separate from Store ownership.
