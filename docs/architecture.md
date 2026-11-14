# Architecture guidance

[Quick start](../README.md#quick-start) · [API reference](reference.md)

These are design defaults, not runtime constraints. Choose boundaries by behavior
and lifetime rather than enforcing a Store count or mirroring the component tree.

## State placement and behavioral ownership

| Concern | Typical owner |
| --- | --- |
| Domain data, invariants, identifiers, references | Model |
| Session state, async orchestration, timers, subscriptions | Store |
| Focus, measurement, hover, isolated input drafts | UI framework |

Models support snapshots; ordinary fields participate by default. Stores can also
persist selected session/view fields with `@snapshot`. Being persistent is not,
by itself, a reason to move view state into a domain Model.

A Store should own a cohesive behavior: its state, intent methods, async policy,
and cleanup. Extract a child when a subsystem gains an independent lifetime,
policy, or reusable behavior. A shell Store can coordinate children without
absorbing every workflow merely because they share its lifetime.

Do not introduce a Store that only forwards all of another Store's or Model's
fields and methods. A view can read a Model directly, or use several Stores.
One Store may serve a header, body, and sidebar; a route need not have its own
Store if it has no behavior to own. Introduce a coordinator when there is actual
coordination, not merely to satisfy a one-Store-per-component convention.

The Store ownership tree governs child identity and disposal. React providers
govern lookup only; neither tree needs to mirror the rendered component tree.
Multiple independently owned root Stores are also valid.

## Props versus Store Context

Use typed props for explicit, local dependencies, including Models, other Stores,
intent-level ports, and callbacks. Props make reusable Store inputs visible.

Store Context is useful for an ambient capability shared across a subtree, or
when descendants need a scoped override without plumbing through intermediaries.
It is reactive and follows Store ownership ancestry, not React provider ancestry.
Models cannot consume Store Context.

Neither is universally preferable. A callback such as `getError()` can deliberately
defer a reactive read; it is not inherently a sign that Context is missing. Avoid
having both props and Context silently compete as sources for the same dependency.
An explicit bridge between scopes is reasonable when it has a clear purpose.

## Events and reactions

When an intent method or external callback already knows an event occurred,
perform its consequences there. Do not set a flag and add a reaction solely to
rediscover that event. Domain invariants belong in domain mutations rather than
in reactions that repair the Model afterward.

Use reactions to synchronize genuinely independent reactive sources. Register
mount-scoped behavior with `this.reaction()` and resources with `this.effect()`;
return cleanup from effects. Reactions skip their initial callback.

Child Stores are lazy. Do not read a child getter solely to start background work;
put always-on work with its actual lifetime owner. Constructor registrations
activate on mount, so resource acquisition belongs inside the effect callback,
not directly in the constructor.

## Intent-level external-system ports

Workflow Stores should depend on application operations such as `saveDraft()` or
`startImport()`. Keep HTTP paths, RPC discriminants, serialization envelopes, and
transport-specific errors in adapters behind those ports.

A Store whose actual responsibility is transport integration may own those details.
The goal is a meaningful boundary, not wrapping every single network call in an
otherwise empty service class.

Keep command preconditions with the command owner. A coordinator can call
`viewer.tryExitFocusMode()` instead of duplicating the viewer's preconditions.
Semantic queries remain appropriate when the caller genuinely needs information.

## Terminal cancellation and operation concurrency

`store.signal` aborts when terminal Store disposal begins. It does not implement
take-latest, retries, queues, user cancellation, or error/loading state.

Choose an operation policy explicitly: allow overlap, serialize, reject duplicates,
or cancel/supersede previous work. Use separate operation controllers or revisions,
and guard late commits after uncancellable work. A terminal signal check alone
does not prevent an older operation from overwriting a newer result while the
Store is still alive. Abort requests also do not guarantee remote rollback.

See [Store lifetime](reference.md#store-lifetime-and-owned-effects) and the
[async skill reference](../skills/r-state-tree/references/lifecycle-and-async.md).

## Reactive dependency placement

Tracking follows reads through getters and helper calls, not Store or component
boundaries. Let a presentation consumer read its own loading/error fields rather
than eagerly reading them while building descriptors used by unrelated consumers.
Pass a Model/reference or a callback when it narrows those dependencies.

Keep eager reads that determine identity, membership, availability, or invariants.
Use computed caching for repeated expensive derivation; deferring reads does not
replace caching. Mutable Store/Model collections must use `observable()` and direct
in-place mutation in authoritative methods/callbacks, not getters/computeds. Do not
rewrite mutations into copy-and-reassign updates merely to satisfy lint. Whole-field
replacement remains valid for intentionally immutable value models; copies are also
appropriate at genuine ownership, snapshot, or transport boundaries. Plain derived/
read-only collections need not be observable. Keep getters/computeds pure: building
a fresh result must not mutate existing state or shared elements of shallow copies.
