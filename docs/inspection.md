# Opt-in live inspection

The in-page panel and MCP tools share the same bounded **live runtime** API. Inspection is read-only by default, apart from explicit child initialization and possible computed-getter/Context-provider effects. Consumers can separately enable field writes and application method calls. Both interfaces work independently; MCP needs a Vite dev server **and an open app page**. No browser extension, snapshot replay, or arbitrary JavaScript evaluation. Automatic method/write activity is a separate development-only opt-in.

## Inspector interface

After registering your app's roots and mounting the panel, open the inspector and select a root in the tree. The fixed-size workspace keeps navigation on the left and a grouped object overview on the right: **Props**, **Available Context**, **State**, **Computed**, **Children**, and **Methods**. The Props section lists actual values and callbacks directly, without a redundant `props → Observable` container row. Callback props use the same named-parameter forms as Store methods; they are counted with props, not duplicated among the Store's own methods. A compact overview index shows member names/counts at a glance and jumps to each section. Method names/signatures are discoverable in read-only mode; invoking them still requires controls. Expand branches to explore Models, Stores, arrays, and ordinary objects; breadcrumbs or Up return to a parent. Tree expansion and independent scroll positions survive navigation and refresh. Ownership/reference labels and concrete runtime class names help explain the structure; cycles remain selectable but cannot expand endlessly. Leaf objects remain selectable without an expansion icon; structure-only reads check for children before offering expansion in either view. Internal IDs and transport metadata stay out of the panel.

Interact with your app, then choose **Refresh** to read current state. Reading is manual-refresh, not a subscription. Lazy Store children say **Not initialized** until you explicitly click **Initialize**; expanding the tree does not directly initialize children. Computed reads can still cause indirect initialization or other app effects. Initialization failures display safe errors without exposing exception messages. Tree rendering is limited to 250 object nodes and 40 uncached subtree reads per render; collapse branches to explore other areas.

Enable `controls: true` explicitly in your development setup to allow field edits and method calls. Writable scalar fields are inputs in place: Enter or blur saves, Escape cancels, and booleans use checkboxes. Computeds, children, redacted values, and truncated/unsupported values are not editable. Navigate into objects to edit their fields rather than replacing entire objects from the panel.

Expand a method to see its named parameters and type labels. Strings/numbers have direct inputs, booleans and literal unions have dropdowns, and complex/unknown arguments use individual JSON inputs. Optional parameters have an explicit supply checkbox; omitted trailing parameters use the app's normal defaults. Omitted middle arguments cannot precede supplied ones because the transport accepts JSON, not `undefined`. Rest arguments accept a JSON array (blank means none). Without signature metadata, add/remove positional arguments individually. Arguments survive navigation and refresh; only **Run** invokes the method. Method failures can follow partial state changes; they do not roll back the application.

### Diagram and Context

Choose **Diagram**, then **Stores** or **Models**. These are separate ownership diagrams; roots and references from the other kind are not mixed in. Each keeps its own selection, expansion, pan, and zoom state. Selecting a Store/Model in the outline also picks the corresponding diagram. An unregistered category is shown as empty rather than borrowing roots from the other one. Cards show field names, runtime classes, lifecycle state, and member/Context counts. Solid branches are declared Store/Model ownership (including child arrays); ordinary references never become ownership. Expand/collapse cards, drag the background to pan, use +/− or Ctrl/Cmd+wheel to zoom, and Fit for the full forest. Selection shares the existing overview and breadcrumbs. Each diagram's pan/zoom survives tab switches, refresh, and ordinary selection changes; a viewport resize keeps a clipped selection visible.

The graph uses custom SVG connectors and DOM cards, with no diagram dependency. It reads retained children with `evaluateComputeds: false`, so drawing it does not evaluate ordinary computed getters or Store keys. Selecting a card still opens the normal details view, whose computed reads can execute application code. Diagram projection is bounded to 160 nodes and 40 subtree reads; a limit message explains when to collapse branches. Optional references connect already-visible objects. **Context routes**, available only in the Stores diagram, show the nearest available provider for the selected Store, not a trace of actual consumption.

Available Context lists provider names/types, whether each is provided here, inherited, defaulted, unavailable, or redacted, and its source-declared use where known. Listing Context does not run providers. **Read value** explicitly uses normal Context consumption and displays a bounded read-only result; it does not grant navigation or control over the returned service. Providers may have side effects and Context's normal computed caching still applies. Refresh clears displayed Context values without automatically reading them again.

Names/declarations come from the dev-only Vite transform: named r-state-tree `createContext` calls, `[NamedContext.provide]` methods, and statically resolvable direct consumption. Discovery follows real Store ownership, not React ancestry or arbitrary props. It is best-effort, not an exhaustive global registry or read trace: helper-only default Contexts, dependency modules, unsupported expressions, and unavailable metadata may not be discoverable. Models do not inherit Store Context. No core Context/Store/Model hooks or extra consumer annotations are needed.

## Add to a Vite app

The package exposes `r-state-tree/devtools`, `r-state-tree/devtools/vite`, and the `r-state-tree-inspector` stdio executable. Node-only dependencies never enter the browser entry point. Use a current Node supported by Vite 8 (22.12+ or 24+); the integration is tested with Vite 8.

The browser inspector and panel need no additional packages. The Vite relay needs the optional peer `ws`; the stdio MCP executable needs both `ws` and `@modelcontextprotocol/sdk`. Install them in your app only when using those tools:

```sh
# Vite relay only:
pnpm add -D ws@^8.22.1
# Full Vite + MCP setup:
pnpm add -D ws@^8.22.1 @modelcontextprotocol/sdk@^1.32.2
```

They are development dependencies in this repository for integration tests. They are not installed for consumers who only use the core library or browser inspector.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { rStateTreeInspector } from 'r-state-tree/devtools/vite';
export default defineConfig({
  server: { host: '127.0.0.1' },
  plugins: [rStateTreeInspector()],
});
```

```ts
// App startup, after mounting your Store or creating your Model
import { createInspector, connectViteInspector, mountInspectorPanel } from 'r-state-tree/devtools';
import { token } from 'virtual:r-state-tree-inspector';

if (import.meta.hot) {
  const inspector = createInspector({
    redact: path => path.includes('privateProfile'),
  });
  const registration = inspector.registerRoot('Application', mountedRoot);
  const disconnect = connectViteInspector(inspector, import.meta.hot, token);
  const removePanel = mountInspectorPanel(inspector); // optional: MCP works without it
  import.meta.hot.dispose(() => {
    disconnect(); removePanel(); registration.unregister(); inspector.dispose();
  });
}
```

Add `/// <reference types="r-state-tree/devtools/vite/client" />` alongside your `vite/client` reference for the virtual module declaration. The virtual module exports an empty token in production builds; keep all setup behind `import.meta.hot`. The plugin never starts a relay during build or preview. Remove the imports/plugin entirely when inspection is not wanted.

For Electron, add the plugin to the **renderer’s** Vite configuration and register roots in that renderer. An open Electron window counts as an app page. This does not expose Stores in Electron’s main process. Electron itself has not been exercised by the browser tests.

For a normal app the MCP configuration can simply run `r-state-tree-inspector` with the **app's Vite root as cwd**. It reads `.r-state-tree-inspector.json` there on each tool call, including after a dev-server restart. Set `RST_INSPECTOR_RELAY_FILE` to an absolute path when cwd differs. `rStateTreeInspector({ relayFile, timeoutMs })` customizes the record path and browser-response timeout (default 5 seconds). The browser-response timeout accepts integer milliseconds from 1 through 6000 (default 5000), below the relay client\'s 7-second timeout. Cancelling an MCP call closes that call\'s relay connection instead of retaining it until timeout.

The relay record is a small generated discovery/credential file, **not app state**. It contains a random loopback address and authentication secret so the MCP process can find the current dev server without hardcoded ports. For an installed package, an MCP host using `mcpServers` can use:

```json
{
  "mcpServers": {
    "app-state": {
      "command": "node",
      "args": ["/absolute/path/to/app/node_modules/r-state-tree/dist/devtools-mcp.cjs"],
      "env": {
        "RST_INSPECTOR_RELAY_FILE": "/absolute/path/to/app/.r-state-tree-inspector.json"
      }
    }
  }
}
```

Adjust the relay path to the renderer's Vite root (or the configured `relayFile`), not necessarily the Electron project root. The MCP host launches this separate stdio process; Vite exposes the relay, not an HTTP MCP endpoint. Host configuration syntax varies.

**Ignore the relay record in Git.** It is an ephemeral credential file, mode 0600, removed on orderly shutdown. A crash may leave a stale record; restart Vite to replace it. Only one relay record per path is supported: give simultaneous dev servers distinct `relayFile` paths and explicit MCP configurations.

## Panel layout

The Vite plugin and MCP connection do not render a UI. `mountInspectorPanel` adds a shadow-DOM panel and returns its cleanup function; it needs no React rendering. Choose its initial layout:

```ts
mountInspectorPanel(inspector); // floating, initially collapsed
mountInspectorPanel(inspector, { open: true }); // floating, initially open
mountInspectorPanel(inspector, { fullscreen: true }); // initially fills the app viewport

const removePanel = mountInspectorPanel(inspector, {
  container: document.querySelector<HTMLElement>('#inspector-pane')!,
  layout: 'embedded', // fills this container, initially open
  // fullscreen: true, // optionally start fullscreen, then restore into this pane
});
```

Choose **one** mount for each view. The options type is exported as `InspectorPanelOptions`. The old `mountInspectorPanel(inspector, container)` signature still works and retains the floating layout. Give an embedded container a real height, for example `height: 600px`, or stretch it in your app's flex/grid layout with `min-height: 0`.

Every open panel has a **Fullscreen / Exit fullscreen** button. Fullscreen temporarily moves the same panel to the document body to escape clipped/transformed containers, then returns it to the exact original slot. Selection, expansion, parameter drafts, and diagram state stay in the same UI; canvas resizing can recenter a clipped selection without resetting zoom. **Escape** restores the prior layout, unless an editable field consumes Escape to cancel its edit first. Focus stays inside the fullscreen inspector and page scrolling is restored on exit or cleanup. Fullscreen always opens the panel, even if `open: false` was supplied.

For React, let the normal layout decide where the container belongs:

```tsx
import { useEffect, useRef } from 'react';
import { mountInspectorPanel, type Inspector } from 'r-state-tree/devtools';

function InspectorPane({ inspector }: { inspector: Inspector }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    return mountInspectorPanel(inspector, {
      container: container.current,
      layout: 'embedded',
    });
  }, [inspector]);
  return <div ref={container} style={{ height: 600, minWidth: 0 }} />;
}
```

These layouts work within the same browser/Electron renderer as the inspector. Fullscreen fills the current app viewport, **not OS/native browser fullscreen**; it needs no fullscreen permission or user gesture. It does not create another Electron `BrowserWindow`, and rendering an inspector for another renderer's state in a separate window would need a visual remote adapter, which is not currently provided. MCP can already target separate registered app pages.

## Queries and tools

1. `rst_list_tabs` → `{value:{tabs:[{tabId,title,url}]}}` (URL contains the origin only, no path/query/hash).
2. `rst_list_roots({tabId?})` → explicitly registered `{rootId,name,kind}` entries.
3. `rst_inspect({tabId?,rootId,path?,depth?,maxEntries?,evaluateComputeds?})` → live root/tree/subtree; `evaluateComputeds: false` defers ordinary getters and Store key evaluation for structure-only reads.
4. `rst_initialize_child({tabId?,rootId,path?,field,levels?,maxInitializations?})` → `{initialized,visited,storesVisited,truncated,errors}` inside `value`.
5. `rst_set_field({tabId?,rootId,path?,field,value})` → `{ok:true}` or `{ok:false,error}` inside `value`. Requires controls opt-in.
6. `rst_call_method({tabId?,rootId,path?,method,args?,depth?,maxEntries?})` → `{ok:true,result}` or `{ok:false,error}` inside `value`. Requires controls opt-in; `result` is a bounded inspection, not raw serialization.
7. `rst_inspect_context({tabId?,rootId,path?,contextId,depth?,maxEntries?})` → explicit Context consumption with a bounded `{ok:true,result}` or safe failure inside `value`. Use a `contextId` discovered on that selected Store; no controls opt-in required.
8. `rst_list_operations({tabId?})` → opt-in automatic method/write activity for registered roots, plus any explicitly attached application-operation timeline. Reading does not require controls.

Every tool returns JSON text with a `value` or `error` envelope. Errors set MCP `isError`, including failed writes/calls and a partially failed initialization: its `value` retains successful counts and the `errors` array. The panel also displays initialization failures explicitly. Target selection is implicit only when exactly one tab is connected; otherwise `tabId` is required. IDs are opaque and page-local, not durable identifiers. Refresh IDs after reload. Subtree navigation uses an array of literal field segments (`['branch','items','0']`), never executable expressions. Property names containing dots are unambiguous.

Local equivalents:

```ts
const { rootId, unregister } = inspector.registerRoot('Root', mountedRoot);
inspector.query({ op: 'roots' });
inspector.query({ op: 'inspect', rootId, path: [], depth: 2, maxEntries: 100 });
inspector.query({ op: 'initialize', rootId, path: ['branch'], field: 'lazy' });
// Deliberate selected-subtree materialization:
inspector.query({ op: 'initialize', rootId, field: 'branch', levels: 3, maxInitializations: 10 });
unregister();
```

Depth defaults to 2 (maximum 8); the shared global entry budget defaults to 100 (maximum 500), strings to 500 characters, and paths to 16 segments. Markers distinguish redacted, unsupported, error, uninitialized, truncated, and repeated/cyclic references. Depth-limited objects retain an ID for recognition and can be expanded by selecting their path. Store keys and runtime parent IDs are included. Declared Store/Model children have `ownership` edges; Model refs have `reference` edges; arbitrary object fields are **not** treated as ownership. Array elements sit under their declared ownership/reference container. Field names/root labels themselves are visible; do not use secrets as labels or keys. Source and proxy aliases share identity.

## Automatic method and write activity

Enable activity **only in the development/debug experience**, behind `import.meta.hot`. It is off by default, independent of `controls`, and rejected when `NODE_ENV` is `production`:

```ts
if (import.meta.hot) {
  const inspector = createInspector({
    activity: {
      maxEntries: 200, // default 200; integer 1–500, including batch records
      // Optional: retain edit events, but never their document text.
      redactValues: path => ['draft', 'content'].includes(path.at(-1) ?? ''),
    },
  });
  inspector.registerRoot('Stores', mountedRoot);
  inspector.registerRoot('Models', appModel);
  // Connect/mount as above. HMR teardown must call inspector.dispose().
}
```

`activity: true` uses the defaults. Consumers do **not** need to wrap individual methods or repositories. Small core hooks report calls through observable action wrappers and successful mutations; the devtools recorder filters them to registered, retained objects. No reads are logged. Outside recording, hooks take a disabled branch: no event allocation, history collection, value copying/serialization, clocks, timers, or root discovery. The normal runtime still contains the hook checks; this is not a claim of zero overhead or zero added bundle bytes. No subscription is installed until a root is registered, and removing the last root/disposal removes it. Closing only the panel does not stop an inspector that is still serving MCP.

Open **Operations**, then **Refresh**, or use `rst_list_operations`. Calls and writes share synchronous batch IDs; nested calls also carry parent IDs. Batches are observational groups, **not transactions**: a failed call may already have changed state. Public `batch()` calls and existing automatic action batches are grouped; private notification batches are not separate user activities. An async method is pending until its native Promise settles (or observation expires after five minutes). **Writes after `await` are not attributed to the earlier call/batch**; overlapping asynchronous work must not be given invented causality. There is no retry, replay, rollback, or execution cancellation.

Write entries include the owning `rootId`, root label, capture-time property `path`, operation, and shallow `before`/`after` summaries. Scalars are retained (strings capped at 160 characters); objects, arrays, and functions are markers, not deep copies or retained app references. Array bulk operations record one mutation with counts/markers, not every internal index shift or a copied array. Calls contain method names/outcomes, **never arguments, results, error messages, or stacks**. `succeeded` means JavaScript returned/resolved normally, not that a business operation succeeded (a method returning `false` still succeeded at returning). Native Promises are observed without replacing their identity; arbitrary thenables are not executed and remain `unobserved`. Observing rejection attaches a handler and can affect unhandled-rejection diagnostics. Promise observers cannot be detached, but cleared/disposed records are not resurrected.

Limits and security:

- Only calls through observable proxies with an inspectable receiver are captured. Raw-source writes, plain non-observable object mutations, constructors/static/free-function calls, detached callbacks with no observable receiver, framework/symbol methods, and objects reachable only through computed/Context reads are not an exhaustive execution trace. Store/Model reference and snapshot-update paths have explicit mutation hooks as well.
- Discovery reads retained data descriptors and already-realized children, never initializes children or evaluates getters/providers. It is bounded to 10,000 queued objects, 1,000 fields per object, and 16 path segments. It does not traverse Map/Set entries; mutations of an observable Map/Set itself are recorded for string/number keys. Object/symbol collection keys are omitted because they have no safe policy path. `activity.discoveryTruncated` and a panel notice flag discovery limits; register smaller roots when needed.
- Normal field/ancestor redaction runs **before capture**. `redactValues` is additional history-only protection: the write is retained with `[redacted]` values while live state remains inspectable. Use this to withhold document content and drafts while retaining change events. Names and paths are still development information; name-based redaction is not data-flow tracking. Synthetic `$operations` policies also hide the whole history or individual records/names.
- History is bounded; old records and pending-observation timers are evicted. Clear does not cancel app work. Unregistering a root clears automatic history (preventing stale root capabilities) and cached discovery; disposal also unsubscribes. Multiple inspectors record independently.
- Output combines automatic activity and optional app labels, newest first, limited to 500 records and 512 KiB before the relay envelope; `truncated: true` indicates partial output. Paths describe where an object was **when the event happened**, not a durable navigation capability after reorders/deletion.
- Recording has real overhead from path resolution, redaction, summaries, and bounded history maintenance. Keep it out of production. Run `pnpm benchmark:activity` for repeatable disabled/enabled CPU microbenchmarks. To also compare a compatible historical revision, set `ACTIVITY_BASELINE=<git-revision>`; no historical application commit is required by default. These are not browser latency guarantees. One Node 24.9 run measured 50,000 field writes at 37.5 ms before hooks, 36.6 ms disabled, and 106.0 ms recording; 25,000 two-write method calls were 64.1 / 70.2 / 263.6 ms. Disabled array push/pop was about 11% above baseline in that run. Results are noisy; rerun rather than assuming zero inactive overhead or that active tracing is cheap.

## Optional application-operation labels

Explicit operation recording remains useful for **intent** such as “save file,” including I/O that changes no observable state. It can coexist with automatic activity via `createInspector({ activity: true, operations })`; there is no automatic causal link between these labels and async batches. This instrumentation is optional—not required for method/write recording, event sourcing, undo, or replay.

```ts
import { createInspector, createOperationTimeline } from 'r-state-tree/devtools';

const operations = createOperationTimeline({ maxEntries: 200 });
const inspector = createInspector({ operations }); // still read-only

// In an existing application command or external-service adapter:
const result = operations.run('files.refresh', () => refreshFiles(), { signal });

// During teardown, dispose both independently:
inspector.dispose();
operations.dispose();
```

Keep development instrumentation behind `import.meta.hot` so it is excluded from production. Keep application instrumentation behind a small app-owned interface with a production passthrough rather than importing devtools into feature Stores. Use static non-sensitive labels; **arguments, return values, work closures, stack traces, and error causes are not recorded**. Error summaries are bounded own data-message strings (or thrown strings), not arbitrary object stringification. Messages can still contain secrets: redact synthetic paths `['$operations']`, `['$operations', id]`, or `['$operations', id, 'name' | 'error']` using the inspector's existing redaction policy.

Choose **Operations** in the panel, then **Refresh** for current observations. Switching views does not recreate the outline/diagrams or discard their selection, expansion, viewport, or parameter drafts. The panel does not poll. Read-only inspectors can list operations; **Clear operations** requires `controls: true`. Clearing history does not cancel work. MCP exposes `rst_list_operations({tabId?})` as read-only JSON/structured content, with `{enabled, canClear, records}`; it provides no retry/replay/clear tool. Direct queries are `{op:'operations'}` and controls-gated `{op:'clearOperations'}`.

`run<T>(name, work, {signal?}): T` calls work once, preserves synchronous return/throw behavior and native Promise identity, and observes settlement without changing the receiver supplied by the caller's closure. Native/cross-realm Promises are observed. Custom thenables are deliberately not assimilated; return `Promise.resolve(thenable)` from the application wrapper if native Promise observation is wanted.

Records contain `id`, `name`, `startedAt`, `durationMs`, `status`, `abortRequested`, and optionally `error`. Status is `pending`, `succeeded`, `failed`, or `unobserved`. Aborting the supplied signal only records a request—it does not prove the operation stopped or rolled back, and does not skip work. Observation expires after five minutes as `unobserved`, not cancelled; late completion does not resurrect evicted/cleared records. Capacity is an integer from 1 through 500 (default 100); names are limited to 200 characters and errors to 500. Eviction, expiry, settlement, clear, and disposal release timers/signal listeners. A disposed timeline runs work as passthrough. The supplied timeline remains app-owned when an inspector is disposed.

## Optional writes and method calls

Enable control only in trusted local development:

```ts
if (import.meta.hot) {
  const inspector = createInspector({
    controls: true, // default: false; applies to both panel and MCP
    redact: path => path.includes('privateProfile'),
  });
  const { rootId } = inspector.registerRoot('Application', mountedRoot);
  // Connect the Vite bridge / optional panel and register cleanup as above.

  inspector.query({ op: 'set', rootId, field: 'selectedProjectId', value: 'demo' });
  const outcome = await inspector.query({
    op: 'call', rootId, method: 'selectProject', args: ['demo'],
  });
}
```

- `roots` reports whether controls are enabled. `inspect` exposes a bounded `methods: [{name, parameters?, returnType?}]` list in either mode, so an agent can discover method names and development-time signatures. Only control-enabled inspection includes writable capabilities, and writes/calls remain rejected in read-only mode. Read-only method discovery uses the budget left after live state; missing metadata is not proof of no methods.
- Writes target existing writable data fields or application setters, including nested plain/observable objects and existing array indices. They use the normal proxy/setter path, so normal reactions and validations run. Adding properties, replacing declared children, changing array length, overwriting functions, and writing getter-only fields are rejected. Prefer application methods when a change requires invariants or in-place collection updates.
- Calls target own or inherited **application** methods, including arrow functions, with their normal `this` receiver. A callback prop is a method on the props object: use `path: ['props']` (or the selected Store path followed by `'props'`), not the Store itself. The panel handles that scope automatically, preserves the normal props receiver, and requires the same controls opt-in. Framework/native prototype methods, constructors, symbol methods, and getters that return functions are not callable through this API. Navigation does not initialize lazy children; initialize them explicitly first.
- Inputs are copied plain JSON, not expressions or references to other runtime objects. They are limited to 64 KiB, 1000 visited values, depth 16, and 32 method arguments. Prototype-manipulation keys, accessors, functions, cycles, non-finite numbers, and custom instances are rejected.
- Method returns use the same bounded inspection and redaction policy, at the method's path. `undefined`, cycles, errors, and unsupported values have the usual markers. Async methods are awaited for up to four seconds. Runtime exception messages/stacks remain hidden.
- **There is no rollback or execution cancellation.** Setters and methods can modify state before throwing. Timeout, disconnect, oversized results, or MCP cancellation can lose a reply after the operation has already run; the method can still finish later. Inspect current state before retrying. Synchronous application code cannot be preempted. Never automatically retry controls.
- **This is not a sandbox.** Enabled methods can reach real services, files, or destructive app behaviors. Redaction blocks direct field/method/path access before execution; it does not prevent an allowed method or setter from changing hidden state, replacing a container that held hidden data, or returning sensitive data under another name. Expose only roots you trust the agent to control; keep credentials and real customer data out of fixtures.

### Development TypeScript method signatures

During Vite **development serving**, the inspector plugin runs before TypeScript erasure and preserves method parameter names, source type labels, optional/default/rest flags, and annotated return types. With controls enabled, allowed methods can include `parameters` and `returnType` alongside `name`. Primitive annotations and small literal unions have input-friendly kinds/choices; arrays and object literals use JSON. Imported aliases and complex types keep their source labels with an `unknown` fallback: this is syntax extraction, not a type checker or runtime validation.

Class methods, arrow properties, fresh object-literal callback functions/methods, inheritance, overrides, and class expressions are supported. Callback metadata stays on the actual function so copying props or renaming an alias preserves its signature. Unknown referenced/bound functions keep the positional fallback rather than guessing. Overloads use the implementation signature, not a guessed overload. Arrow metadata stays on the actual function without wrapping its invocation or changing `this`, name, or arity. Runtime replacements without metadata remain unavailable. Destructured arguments use positional names. Decorated members, computed/private/protected/static methods, getters, JavaScript, dependency modules, and oversized signatures do not receive metadata; callers can still use JSON arguments for allowed methods whose signature is unavailable.

Default expressions are never evaluated or copied into metadata: `defaultValue: '[withheld]'` indicates only that a default exists. Method redaction runs before signature lookup/serialization. Metadata uses only the inspection entry budget left after all live values and method names, so signatures never displace state fields. A signature is omitted rather than partially described when the remaining budget is insufficient. Source labels/choices remain development information, not a security boundary against scripts already controlling the page. Production builds (including development-mode builds) and production-mode serving do not extract signatures. The browser/core entries do not import a parser; extraction uses the existing Node-only Vite 8 parser. The transform preserves original line numbers, but it does not generate an insertion source map, so debugging columns can shift at metadata insertion sites.

## Read semantics and bounds

- Store results may include bounded `contexts: [{contextId,name,type?,status,providerId?,providerClass?,declared?}]`. Metadata discovery follows the nearest effective provider and checks the selected Context policy path plus discoverable ownership/provider paths before exposing identities or reading values. Context redaction uses synthetic `[..., '$context', contextName]` paths; secret-like Context names are hidden by default. Inherited defaults/overrides follow normal Context semantics, not a separate inspector resolver for values.

- Store-child enumeration reads only retained metadata and **already-realized child storage**, never its public getter. That getter also reconciles, so even initialized children are inspected without invoking it. An uninitialized/null-returning child is distinguishable from an initialized child whose value is null.
- Ordinary Store/Model/Observable and observable-object computed/getter fields **are evaluated**. Their object results are depth-bounded; deeper expansion is explicit. Getters can throw, mutate state, or indirectly initialize children. **Inspection is not side-effect-free or atomic.** Output follows traversal order; if a later computed initializes an earlier child, refresh to observe that child. Bounds may stop evaluation before later fields.
- Explicit child initialization uses the existing public child getter and normal lifecycle machinery: creation, mount effects/reactions, keyed identity, and disposal are not redesigned. Re-initializing an already-realized field is a no-op. Subtree materialization follows only declared Store ownership, not arbitrary references or ordinary computed results.
- Materialization defaults to one level and at most 10 child-field visits and 10 descendant Store visits, with hard maxima of four levels and 50 visits of each kind (including already-initialized fields). `initialized` counts successful new child fields, `visited` counts attempted field visits, and `storesVisited` bounds walking large realized lists. One child getter may create an entire keyed list or initialize other children indirectly. JavaScript getter execution, enumeration cost, constructors, and lifecycle callbacks **cannot be preempted or strictly time-bounded** by these limits. Do not materialize recursive factories in an untrusted app.
- Non-observable plain-object accessors are not invoked. Maps/Sets, functions, symbols, bigint, arbitrary non-Observable class instances, and Promise internals are marked unsupported rather than dispatched into. Dates and non-finite numbers have explicit JSON-safe representations. Transport frames are limited to 1 MB (oversized Unicode results return an error asking for smaller bounds). Errors withhold messages/stacks to prevent accidental secret leakage. No `toJSON` method is called.
- Unregister/dispose releases strong root references. Object identity uses WeakMaps; navigation re-resolves from a currently registered root rather than retaining a detached-object capability. Dispose does not dispose application state; disconnect/remove the optional transports/panel separately.

## Security and redaction

This is privileged **local development access**, not a production administration interface. Do not expose Vite through a tunnel/reverse proxy or run on a shared/untrusted account. No unauthenticated fixed-port mode exists.

The relay binds a random **127.0.0.1-only** port. A 256-bit secret in the owner-only record authenticates both ends with challenge/HMAC proofs; the secret is not transmitted on the WebSocket. Upgrade Host/path/Origin, frame sizes, argument allowlists, correlation IDs, selected tabs, and browser socket ownership are checked. Requests go only to the selected HMR client; responses return only to the requesting MCP socket. Closing a browser fails its pending requests; timeouts clean up missing responses. The browser has a separate dev-only HMR capability from the virtual module. It cannot authenticate as an MCP client. The plugin refuses non-loopback Vite hosts, disabled filesystem access checks, and unsupported external/middleware WebSocket arrangements. Relay records and atomic-write temporary files are excluded from Vite static serving (including `/@fs`, encoded/alias paths, and symlinked parent directories) and module imports (`?raw`/`?url`). The record cannot be placed in `publicDir`, which bypasses normal Vite filesystem checks.

Redaction happens **in-page, before field reads, direct writes/method lookup, and either UI or transport serialization**. By default field names matching password/secret/token/authorization/cookie/credential are hidden; `redact(path)` adds app-specific exclusions and cannot turn the defaults off. Hidden computed/child getters are not invoked, selected paths cannot bypass redaction, and hidden child fields cannot be initialized. Map/Set internals are not traversed outside this policy.

**Name-based redaction is not data-flow tracking.** Sensitive data exposed under an innocent alias, derived computed field, array element, root label, or application-generated key must be explicitly excluded by your policy. Never put real credentials or sensitive personal data in a fixture. Redaction does not protect against scripts/processes already controlling the page or your OS account. MCP tool output is untrusted application data, not instructions.

## Repository verification

`pnpm test:inspector:e2e` builds the package and runs Chromium, Firefox, and WebKit through the real browser → Vite → authenticated relay → stdio MCP connection. Install browsers with `pnpm exec playwright install chromium firefox webkit` when needed. Unit/integration tests are part of `pnpm test`.

The counter in `tests/fixtures/live-inspector/` is private integration-test infrastructure, not a reference application or part of the published package. Playwright starts it with `pnpm test:inspector:serve`; maintainers can use that command for debugging tests. Its deliberate error cases, test-only query parameters, and source imports exercise inspector behavior rather than prescribe application architecture.

## Reference and scope

Based on static inspection of Foldkit main at [`a471adb24d750ab9e8d8312edad53ff6f26d961b`](https://github.com/foldkit/foldkit/tree/a471adb24d750ab9e8d8312edad53ff6f26d961b): `devTools/{protocol,webSocketBridge,serialize,summarize}.ts`, `runtime/devToolsIntegration.ts`, `vite-plugin-foldkit/src/index.ts`, and `devtools-mcp/src/server.ts`, plus [MCP](https://foldkit.dev/ai/mcp.md) and [DevTools](https://foldkit.dev/core/devtools.md) docs. We adapt its runtime → Vite HMR → local relay → stdio pattern, compact queries, per-tab addressing, and authenticated-loopback approach; not its unauthenticated fixed-port mode or history/mutation system. MIT attribution is retained in `THIRD_PARTY_NOTICES`. Foldkit itself was not executed during verification.
