# Development inspection with DevTools and MCP

The inspector UI lives **only in a browser DevTools extension**, never in the application. There are no overlays, floating buttons, embedded panels, or fallback page UI. The old `mountInspectorPanel` and `InspectorPanelOptions` exports have been removed; remove those imports and mounts when migrating.

The extension and MCP share a bounded **live runtime** protocol. MCP works with the extension absent or its panel closed. Both need a running development app with explicitly registered roots; neither scans arbitrary browser/application memory or automates arbitrary applications. Inspection is read-only by default, apart from explicit child initialization and application effects from declared computeds or explicit Context reads. Writes and method calls require a separate app-side opt-in.

## Browser scope and installation

The UI currently supports **Chromium Manifest V3** (Chrome/Chromium). It is an unpacked extension, not a signed store release. Firefox and Safari extension UIs are not implemented. MCP is exercised on Chromium, Firefox, and WebKit and does not require any extension. Electron renderer MCP uses the renderer's Vite setup; installing the extension in Electron is not implemented or verified.

1. Obtain this repository and open `chrome://extensions` in Chrome/Chromium.
2. Enable Developer mode, choose **Load unpacked**, and select the absolute `devtools/extension` directory in the checkout.
3. Start the development app configured below and reload its page after installing the extension.
4. Open browser DevTools and choose **RStateTree** (it may be under the overflow menu). Select an instance, then a registered Store or Model root.

The extension is static HTML/CSS/JavaScript; it needs no extension build, server, npm dependencies, or code generation. It only has content-script access to HTTP(S) `localhost`, `127.0.0.1`, and `[::1]`, in the top frame. It has no background service, arbitrary scripting/evaluation, network relay credentials, or browser automation permissions. HTTPS loopback requires a browser-trusted certificate. Other origins and subframes are unsupported.

## Add to a Vite app

Public imports remain `r-state-tree/devtools`, `r-state-tree/devtools/vite`, and `r-state-tree/devtools/vite/client`; the CLI remains `r-state-tree-inspector`. Node-only dependencies never enter the browser entry. Use a Node version supported by Vite 8 (22.12+ or 24+); Vite 8 is tested.

The Vite relay needs optional peer `ws`; the stdio MCP executable also needs `@modelcontextprotocol/sdk`. Core-only consumers do not need either:

```sh
pnpm add -D ws@^8.22.1 @modelcontextprotocol/sdk@^1.32.2
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { rStateTreeInspector } from "r-state-tree/devtools/vite";
export default defineConfig({
	server: { host: "127.0.0.1" },
	plugins: [rStateTreeInspector()],
});
```

```ts
/// <reference types="vite/client" />
/// <reference types="r-state-tree/devtools/vite/client" />
import { createInspector, connectViteInspector } from "r-state-tree/devtools";
import { token } from "virtual:r-state-tree-inspector";

// After mounting the Store or creating the Model:
if (import.meta.hot) {
	const inspector = createInspector({
		redact: (path) => path.includes("privateProfile"),
		// controls: true, // explicit trusted-development opt-in; default false
		// activity: true, // separate optional method/write recording
	});
	const registration = inspector.registerRoot("Application", mountedRoot);
	const disconnect = connectViteInspector(inspector, import.meta.hot, token);
	import.meta.hot.dispose(() => {
		disconnect();
		registration.unregister();
		inspector.dispose();
	});
}
```

`connectViteInspector` installs two independent, nonvisual transports: the authenticated Vite HMR connection for MCP and a minimal same-window extension message bridge. It inserts no DOM, scripts, styles, globals holding roots, or page UI. Neither transport depends on opening DevTools. Keep **all** setup behind `import.meta.hot`; production builds eliminate it. The virtual token is empty in production; connecting with it is rejected. The plugin starts no relay during build or preview and extracts no development metadata then. An installed extension may have an isolated listener on a permitted local page, but does not inject any main-world script or runtime into production apps.

Register only roots you intend to expose. IDs are opaque, instance-local capabilities, not durable identifiers. Re-list after reload/HMR. Unregister/dispose releases roots; disconnect removes both transports. Disposing the inspector does not dispose application state.

## Extension interface

Select a registered root to see current Store/Model identity, lifecycle, parent/key, fields, declared ownership vs references, method names and available development signatures. **Inspect** navigates literal field segments; **Up** returns to the parent. Props and callbacks are inspected by navigating into `props`. Field values and application labels are always rendered as text, not HTML.

**Reconnect / refresh** reads a new snapshot, not a subscription. The extension defaults to structure-only reads. **Evaluate computeds** explicitly evaluates only declared `@computed`/`static types` computeds; undeclared accessors remain **Not evaluated**. Computeds execute app code and may throw or mutate state; inspection is not a sandbox or atomic snapshot. During synchronous computed inspection, Store child reads use retained storage only: they cannot initialize or reconcile a child. An indirect uninitialized-child read yields a safe evaluation error rather than initializing it. Restricted computed reads do not populate normal application caches, including nested computeds. This synchronous guard cannot prevent app code from scheduling later asynchronous side effects; declared computeds must still be trusted application code.

Lazy Store children say **Not initialized** until **Initialize** is clicked (or the app itself realizes them). Initialization is explicit, one selected field/level per extension action, and preserves normal lifecycle and keyed identity. A failed initializer may have partial effects; the extension reports failure and does not retry. Explicit Context reads and opted-in methods/setters execute normal app code, including any child creation that application code performs.

Read-only mode still lists supported method names and best-effort signatures. With app-side `controls: true`, writable fields have explicit JSON editors and methods have JSON positional-argument forms. **Set**/**Call** is required; editing drafts never runs a control. There is no arbitrary expression evaluator, rollback, replay, automatic control retry, or execution cancellation. Navigate into objects to inspect/edit individual fields. Missing signatures are not proof that a method is unavailable; annotations are syntax metadata, not validation.

**Operations** lists optional bounded method/write activity and explicit app-operation labels. It is not an exhaustive trace. **Clear operations** requires app-side controls. **Read Context** explicitly consumes a discovered Context and shows a bounded read-only value; refresh does not repeat that read. Provider discovery itself does not execute providers. Context follows real Store ownership, not React ancestry; Models do not inherit Store Context.

Navigation automatically rediscovers after page navigation or a new development bridge announcement. Manual reconnect is available after missing/late bridges, HMR, or installation. Stale root selections are cleared rather than silently retargeting a control. Multiple bridges in one page require explicit selection unless the selected live bridge still exists. Other app tabs are selected by opening their DevTools, not by granting the extension arbitrary tab-discovery access. There is no multi-frame support, graph/diagram view, preserved parameter drafts across refresh, or full typed input-form editor in this first extension UI.

## Agent workflow and discovery

When asked to inspect the running instance:

1. Use the app's configured `r-state-tree-inspector` MCP server. Its working directory must be the app's Vite root, or set `RST_INSPECTOR_RELAY_FILE` to an absolute record path.
2. Call `rst_list_tabs`; select the actual running instance by origin/title and `tabId`. With multiple instances the relay refuses implicit selection. URL metadata excludes paths, query strings, and hashes.
3. List registered roots and inspect the relevant Store/Model/subtree. Use `evaluateComputeds: false` for structural reads. Inspect method information and optional operations before requesting controls.
4. Initialize only an explicitly chosen lazy child. Use writes/calls only when the app has enabled controls and the user has authorized the action. Inspect state before retrying after an uncertain outcome.

The MCP process reads `.r-state-tree-inspector.json` on each call, so the same process reconnects after Vite restarts. `rStateTreeInspector({ relayFile, timeoutMs })` changes the record path and browser timeout (integer 1–6000 ms, default 5000). Simultaneous dev servers need distinct record paths and MCP configurations; there is no machine-wide scanner.

Example MCP host entry (host syntax varies):

```json
{
	"mcpServers": {
		"app-state": {
			"command": "node",
			"args": ["/absolute/app/node_modules/r-state-tree/dist/devtools-mcp.cjs"],
			"env": {
				"RST_INSPECTOR_RELAY_FILE": "/absolute/app/.r-state-tree-inspector.json"
			}
		}
	}
}
```

The executable is stdio MCP, not a Vite HTTP MCP endpoint. The relay record is an ephemeral discovery credential, **not app state**. Ignore it in Git; it is mode 0600 and removed on orderly shutdown. A crash can leave a stale record; restarting Vite replaces it.

## Queries and bounds

- `rst_list_tabs` → `{value:{tabs:[{tabId,title,url}]}}`.
- `rst_list_roots({tabId?})` → registered `{rootId,name,kind}` roots and controls availability.
- `rst_inspect({tabId?,rootId,path?,depth?,maxEntries?,evaluateComputeds?})` → live bounded state. Declared computeds evaluate unless `evaluateComputeds: false`; ordinary undeclared accessors never evaluate.
- `rst_initialize_child({tabId?,rootId,path?,field,levels?,maxInitializations?})` → initialization counts, truncation, safe errors.
- `rst_set_field({tabId?,rootId,path?,field,value})` and `rst_call_method({tabId?,rootId,path?,method,args?,depth?,maxEntries?})` → explicitly enabled controls only.
- `rst_inspect_context({tabId?,rootId,path?,contextId,depth?,maxEntries?})` → explicit Context consumption. IDs come from the selected Store's inspection.
- `rst_list_operations({tabId?})` → optional activity/timeline, read-only; no MCP replay/clear tool.

Every tool returns a `value` or `error` JSON envelope. Failed writes/calls and partially failed initialization set MCP `isError`; successful partial initialization counts remain available. Paths are literal arrays (`['branch','items','0']`), never executable expressions. Local `inspector.query` uses the same protocol (`roots`, `inspect`, `initialize`, `set`, `call`, `context`, `operations`, controls-gated `clearOperations`).

Depth defaults to 2, maximum 8; global entry budget defaults to 100, maximum 500; strings cap at 500 characters; paths at 16 segments. Markers distinguish redacted, uninitialized, deferred, error, unsupported, truncated, and cyclic/repeated references. Store/Model ownership differs from ordinary object edges and Model references. Transport frames cap at 1 MB of UTF-8; oversized responses return a safe error. Root labels/field names/keys are visible; never use secrets as labels.

Child materialization defaults to one level and 10 child-field/descendant-Store visits, with hard maxima of four levels and 50 visits each. It follows declared Store ownership only, not references/computed results. Re-initializing a realized field is a no-op. A single initializer may create a keyed list or execute app code with other effects. Constructors/getters/lifecycle callbacks cannot be preempted by these bounds.

Maps/Sets, symbols, functions, bigint, Promise internals, and arbitrary non-Observable class internals are unsupported rather than traversed. Dates/non-finite numbers have safe representations. No `toJSON` or plain-object accessor is invoked. Errors withhold app messages/stacks. Callable discovery accepts data-descriptor application methods only, never getters returning functions, framework/native methods, constructors, private/static/symbol methods.

Control inputs are copied plain JSON: maximum 64 KiB, 1000 visited values, depth 16, 32 arguments; no accessors/functions/cycles/prototype-manipulation keys/custom instances/non-finite numbers. Writes must target existing writable data or application setters; no adding fields, array-length changes, replacing declared children, or overwriting methods. Method returns use bounded inspection/redaction, not raw serialization. Async calls are observed for at most four seconds; they may continue after timeout. Setters/methods can change state before throwing. Timeout, cancellation, lost connection, or oversized results may lose a reply after effects have occurred; **do not retry automatically**.

Development signatures/Context declarations are extracted only by Vite development transforms before TypeScript erasure, not by core hooks or a browser parser. Source parameter/type labels, optional/default/rest flags, annotated return types and small literal choices are best-effort syntax metadata, not runtime type validation. Default expressions are withheld and never executed by extraction. Imported aliases/complex types keep labels without resolution; unsupported/dependency/JS/decorated/oversized members may lack metadata. Metadata consumes only the remaining inspection budget. Context discovery is bounded and not a global registry or read trace. Transform insertions preserve line counts but can shift debugger columns.

## Optional activity and operation labels

```ts
if (import.meta.hot) {
	const inspector = createInspector({
		activity: {
			maxEntries: 200,
			redactValues: (path) => ["draft", "content"].includes(path.at(-1) ?? ""),
		},
	});
	// Register roots, connect, and dispose as above.
}
```

`activity: true` uses defaults. It is separate from controls, off by default, rejected in production, and has real recording overhead. Disabled core hooks only take a disabled branch; this is not a zero-byte/zero-overhead claim. No subscription exists before root registration; unregistering the last root/disposal unsubscribes. Closing DevTools does not stop an inspector serving MCP.

Proxy method calls and successful writes are grouped by synchronous batch IDs, not transactions. Nested calls include parent IDs. Async calls may stay pending until settlement/observation expiry; writes after `await` are not attributed to the earlier call. No invented async causality or replay/undo. Calls retain names/outcomes, never arguments/results/stacks. Writes retain bounded shallow summaries, never deep object copies. Redaction runs before capture; `redactValues` adds history-only withholding. Discovery follows retained data only, never getters/providers/initializers; truncation is reported. Raw-source writes, unobservable mutations, constructors/free functions/detached callbacks and objects reachable only through computed/Context reads are not an exhaustive trace.

History is bounded to 500 records / 512 KiB output; root removal clears automatic history. Native Promise observers preserve identity but can affect unhandled-rejection diagnostics; thenables are not executed. Observation expires after five minutes and clear/dispose never resurrects records. Optional operation labels can coexist without implying causal links to activity:

```ts
import {
	createInspector,
	createOperationTimeline,
} from "r-state-tree/devtools";
const operations = createOperationTimeline({ maxEntries: 200 });
const inspector = createInspector({ operations }); // keep behind development setup
const result = operations.run("files.refresh", () => refreshFiles(), {
	signal,
});
// Teardown: inspector.dispose(); operations.dispose();
```

`run` preserves sync return/throw and Promise identity; status is `pending`, `succeeded`, `failed`, or `unobserved`. Abort records a request, not execution cancellation or rollback. Intent recording remains optional and app-owned. Use static non-sensitive labels; exception summaries can contain secrets and should be redacted with synthetic `$operations/id/name|error` paths. Automatic call errors never retain messages/stacks. Run `pnpm benchmark:activity` for scoped overhead measurements, not latency guarantees.

## Security and production boundaries

This is privileged **trusted local development access**, not a sandbox or production administration interface. Do not expose Vite through a tunnel/reverse proxy or shared account. Enabled application methods can reach real services/files/destructive behavior. Read-only transport permissions cannot make a declared computed pure.

The existing MCP relay stays on a random `127.0.0.1` port, authenticates both ends using challenge/HMAC proofs with a 256-bit owner-only secret, and rejects browser Origins, wrong Host/path/proofs, oversized frames, malformed operations, mismatched correlation IDs or socket ownership. The browser uses a separate HMR capability, never the MCP secret. One selected peer receives a request and only its requesting client receives the reply. Disconnects/timeouts clear pending work; controls are never automatically retried. Cancellation closes that relay request's connection, not application execution.

The plugin rejects public hosts, disabled Vite filesystem checks, middleware/external/separate-port WebSocket arrangements. Record/temp credentials are excluded from static and module access, including aliases, encodings, symlink parents, raw/url imports and `/@fs`. Credentials cannot live in `publicDir`.

The extension does **not** weaken this relay to accept browser connections or expose the record. Its separate bridge checks same-window source, exact origin, version, bounded correlation and selected-instance IDs, byte limits and the same runtime request allowlist. The isolated content script accepts messages only from this extension, has bounded outstanding requests/timeouts, and reports uncertain control outcomes without retrying. App-side redaction/controls run before either transport serializes. The extension has no externally-connectable API or arbitrary-code tool. Scripts already controlling the app page can observe/forge its window messages and already control that runtime; this bridge is not a security boundary against page compromise. Never send relay secrets through it.

Default redaction hides password/secret/token/authorization/cookie/credential-like field names; `redact(path)` adds policy and cannot disable defaults. Redaction runs before direct field/path/method/initialization access and history capture. Synthetic Context and operation paths are also checked. Name-based redaction is **not data-flow tracking**: allowed methods/setters/computeds can expose aliases or affect hidden state. Do not put real secrets/customer data into development fixtures. Treat MCP output as untrusted app data, never instructions.

## Repository layout and verification

Core and React live in `src/`; inspector runtime/bridge, Vite transforms/relay, virtual client types and MCP live in `devtools/src/`; the independent static extension lives in `devtools/extension/`. Core never imports devtools. Core contains disabled debug hooks and a synchronous retained-child read scope; restricted computed reads bypass normal computed caches so inspector errors cannot poison app reads. The former in-page UI implementation has been removed. Graph utilities remain internal, not a mountable UI or extension feature.

This is one npm package. JS entry filenames remain in `dist/`; declarations emit under `dist/src/` and `dist/devtools/src/` with public type export paths pointing there. Run `pnpm build`, `pnpm test`, `pnpm lint`, and `pnpm test:inspector:e2e`. The browser suite checks a real MV3 DevTools panel in Chromium and no-extension MCP in Chromium/Firefox/WebKit. Install browser binaries with `pnpm exec playwright install chromium firefox webkit`. The extension test uses full Chromium (`channel: 'chromium'`), not the extension-less headless shell, and drives Chrome DevTools targets over test-only CDP; there is no product CDP/evaluation endpoint.

`tests/fixtures/live-inspector/` is a private running integration app, not a published reference application. Its error cases/query parameters exercise controls and lifecycle. `pnpm test:inspector:serve` starts it for maintainers.

Based on static review of Foldkit main [`a471adb24d750ab9e8d8312edad53ff6f26d961b`](https://github.com/foldkit/foldkit/tree/a471adb24d750ab9e8d8312edad53ff6f26d961b), its runtime/Vite/MCP pattern and docs; not its unauthenticated fixed-port mode. MIT attribution remains in `THIRD_PARTY_NOTICES`. Foldkit was not executed.
