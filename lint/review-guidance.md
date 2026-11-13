# Review and runtime tests beyond lint

The first four rules check construction, derivation mutation, and declaration-based collection handling. `no-discarded-child-read` adds one opt-in suggestion about lazy Store initialization. None proves correct ownership, cancellation, dependency placement, or concurrency policy. A clean lint run is not a substitute for the tests below.

## Candidate decisions

These seven findings came from review of the R95/live-inspector examples. The enforceable subset is narrower than the architectural issue that motivated it.

| Finding                                       | Static decision                                                                                                                                                              | Concrete review/runtime check                                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State commits after disposal or replacement   | **Deferred.** No post-`await` rule. Guard spelling alone cannot establish lifetime or operation policy.                                                                      | Suspend the operation, dispose or supersede its owner, then resolve **and reject** it. Assert no stale success/error commits to Store or held Model state.                                                                        |
| Eager presentation reads widen dependencies   | **Advisory.** Eager reads may be required for membership, filtering, sorting, or availability.                                                                               | Observe row IDs/identity only, change a title/status, and assert that observer does not rerun. Observe the title itself and assert that it does update.                                                                           |
| Monitoring materializes lazy services         | **Partial.** `no-discarded-child-read` warns only on standalone direct reads of locally known lazy Store child getters. A consumed `disk.jobs.jobs` needs intent/provenance. | Render the monitor and switch tabs; assert the lazy queue stays uninitialized when the monitor should read shared job Models only (the reviewed inspector tests use `getStoreAdm(disk).peekInspectionChild("jobs").initialized`). |
| Broad React observer boundaries               | **Advisory.** JSX mapping and large components are not intrinsically wrong.                                                                                                  | Count renders: clock/status changes must not rerender desktop layout or unrelated task titles; one title edit must not rerender other tasks. Unmounting must not dispose an externally owned Store.                               |
| One-shot registration tracks incidental reads | **Advisory.** Unknown `register` helpers do not establish one-shot intent; reactive effects are valid.                                                                       | Change a document/context prop after registration. Assert no repeated consume/register/dispose cycle for a one-shot resource; assert intentionally reactive effects still rerun.                                                  |
| Startup lacks in-flight sharing               | **Advisory.** Independent parallel commands are legitimate.                                                                                                                  | Hold repository startup read pending, call `restore()` twice, and assert one read and one recovered-window set. On failure, test the intended retry policy.                                                                       |
| Expensive derivations repeat                  | **Advisory.** Pass-through getters can be cheap/useful; memoization changes tracking and evaluation semantics.                                                               | Count matching/sorting executions while reading selection/count/availability. Assert unrelated content does not recompute but membership/sort-key changes do.                                                                     |

## Why post-await commit lint is deferred

Even the narrow pattern `async run() { await work(); this.count += 1; }` is insufficient to infer a bug. It can be a disposed-owner write, or an authorized independent additive command whose semantic state outlives the initiating Store. An assignment to `this.model.value` has the same problem: the held Model's owner and lifetime are not established by its spelling or an initializer. An operation signal may or may not be linked to the Store; a revision check can enforce take-latest without encoding lifetime. A helper may check both, neither, or throw.

Restricting to straight-line methods does not solve those policy ambiguities. Recognizing only `this.signal.aborted` would still warn on valid helper/controller-based policies; treating any guard-like call as sufficient would silently miss unsafe continuations. The shared syntax analysis has no async control-flow/lifetime proof. It should not be repurposed into one by scanning for a preceding guard token or any `await` in a subtree. **No async rule, guard insertion, or claim of stale-write detection ships.**

The representative example code reinforces this decision:

- Live-inspector `Counter.add` rechecks `this.signal.aborted` immediately after its await.
- `FileSystemStore.load` combines Store lifetime, an operation controller, revision equality, guarded success/error writes, and listener cleanup in `finally`.
- `SessionStore.flush` uses a nested async queue loop, guarded success/error writes, and a deferred `.finally()` that clears its in-flight handle and may restart queued work.

These examples were inspected as external review evidence, not imported into the plugin or asserted as runtime/browser tests here. The fixtures in `tests/lint.test.ts` exercise all of the following syntax in the real Oxlint host; absence of diagnostics only locks down the deliberate policy boundary:

| Continuation                                                   | Required review/test distinction                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `if (this.signal.aborted) return` **after** await              | Protects that continuation when this signal is the intended lifetime. Test disposal while suspended.                                |
| The same guard **before** await                                | Does not protect resumption. Dispose during the wait, then resolve/reject.                                                          |
| Operation signal/controller or immutable signal/`this` aliases | Establish linkage/ownership; test external cancellation and replacement independently of disposal.                                  |
| Late success and catch/error commits                           | Resolve and reject separately after disposal/replacement; a guard on the success path does not cover `catch`.                       |
| Branch-local guard                                             | Verify every path reaching each commit. A guard on one branch does not protect a join.                                              |
| Loop condition checked before an await                         | Revalidate after suspension inside the loop; checking at the next iteration is too late.                                            |
| Multiple awaits                                                | Revalidate after later awaits too; an earlier successful check cannot protect a later continuation.                                 |
| `finally` or deferred `.finally()` cleanup                     | Resource release and in-flight-handle clearing may remain necessary after cancellation; do not automatically return before cleanup. |
| Independent additive operations                                | Test both completion orders; do not impose take-latest or a global in-flight lock by default.                                       |
| Store/held Model state through aliases                         | Resolve the actual owner and permitted commit policy, not just the target's syntax.                                                 |
| Import aliases, shadowed/unrelated classes                     | Resolve bindings before identifying Store methods; names alone establish nothing.                                                   |
| Nested/deferred functions                                      | An enclosing await does not locate suspension in a later callback. Test the callback's own lifetime/timing.                         |

For a take-latest, lifetime-bound command, this is a **review example**, not a universal rewrite:

```ts
const revision = ++this.revision;
try {
	const result = await fetchResult();
	if (this.signal.aborted || revision !== this.revision) return;
	this.result = result;
} catch (error) {
	if (this.signal.aborted || revision !== this.revision) return;
	this.error = error;
} finally {
	releaseResource(); // Cleanup may still be required after cancellation.
}
```

Adding a second await before either commit requires another check. Passing a signal to `fetchResult` alone is not a guarantee: dependencies may complete despite cancellation. Conversely, cleanup and deliberately independent commands must not be rejected merely because they happen after an await.

A useful runtime test uses a manually controlled Promise: begin the command, wait until the dependency is pending, dispose/supersede the owner, snapshot the relevant Store/Model fields, resolve or reject, await completion, and compare the semantic state. Assert cleanup separately so the test does not reward leaking resources just to avoid writes. Repeat with two commands finishing in both orders, according to the explicitly chosen independent/take-latest/shared-startup policy.

## Late presentation reads versus semantic reads

A projection like `rows.map(window => ({ id: window.model.id, title: window.taskTitle }))` reads every title while building the rows, even if the consumer only asks for IDs. Retaining `window`/`model` references or exposing a late `title` getter can move presentation reads to a row-sized observer. Test both dependency isolation and display updates; changing only the projection shape is not evidence that React observers are correctly placed.

Do **not** defer a title read that determines `filter(window => window.taskTitle.includes(query))` membership or title sorting. Those reads define the result. Likewise, a cheap `get model() { return this.props.model; }` need not become computed just because an expensive matching/sorting derivation benefits from caching. Test execution counts and invalidation dependencies rather than requiring `computed` on every getter.

## Lazy services and one-shot setup

A monitor that only displays existing jobs should usually consume the shared job Models rather than create a queue/runner Store through `disk.jobs.jobs`. A descriptor/render consumer, command that actually needs the runner, or explicitly reviewed startup warmup can legitimately initialize a child. The lint warning therefore says **may initialize**, not “unused read is a bug,” and supports ordinary scoped suppression with an intent comment.

When a setup effect is intentionally one-shot, review the whole consume → props → register path for incidental tracking, not just the final register call. `untracked(() => { /* complete one-shot registration */ })` can be appropriate. Do not apply that wrapper to genuinely reactive effects: test that their intended dependencies still cause reruns. The lint plugin cannot infer which kind a custom helper implements.
