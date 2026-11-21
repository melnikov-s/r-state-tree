# Runtime performance benchmarks

Run these from the repository root with Node.js 24, pnpm, Git, `tar`, and the lockfile's installed dependencies. For a local pnpm store that already has the dependencies:

```sh
pnpm install --offline --frozen-lockfile
pnpm benchmark:baseline --smoke
pnpm benchmark:baseline --json node_modules/.cache/runtime-baseline.json
```

`pnpm benchmark:baseline --help` lists options. Smoke checks every case with one warmup, three samples, and 1% of the full iteration counts, rounded up. Its timings are not suitable for comparison. The default full run uses four warmups and nine measured samples per case. The table reports elapsed wall microseconds per operation, the median, interquartile range (p25–p75), and min–max. The optional JSON adds operation definitions, sizes, environment, and verified **per-sample** counters. There are no timing thresholds or benchmark runs in unit CI.

## Workloads and timing boundaries

Only the operation loop is timed. Every sample starts from the same deterministic input and is disposed before the next one. Verification is outside the timer except for lightweight counters, checksums, and identity/lifecycle probes counted as part of the operation. Fresh cases measure newly created instances or the first operation on a prepared instance, **not** process startup or a cold CPU/JIT. Steady cases start with materialized data and the indicated subscriptions already installed. Each case has its own Node worker process; compilation, startup, warmups, teardown (except when explicitly timed), and report writing are excluded. The timer includes any GC and scheduling delays during the operation loop.

| Cases | One timed operation |
| --- | --- |
| `observable.write.*` | One object field, one array index, and one Map entry write. Compare no observer, three direct reactions, or one observed computed aggregate over 16 array slots plus the field and Map value, with or without a batch. |
| `model.create.*` | Create from a full 256-document snapshot, flat or nested in eight folders. Snapshot inputs are prepared outside the timer. |
| `model.apply.nested` | Apply an alternating full snapshot to the existing 256-document tree, verifying keyed document identity. |
| `model.lookup.nested` | Look up one ID in the already-built tree and read the document value. IDs cycle through all 256 entries in a fixed order. |
| `model.transfer.branch` | Detach a 32-document branch, then attach it to the other root; observe both parent transitions and verify ownership/ID lookup. |
| `store.children.*` | Mount a root with an unopened 128-key list; read the list once after mounting; traverse the warmed list with repeated getter/index reads; reverse keys; switch to a disjoint key set; or dispose a realized root. Fresh cases retain results until verification; reorder/replacement are on the same root. Counts distinguish list getter runs, child construction, cleanup, and verified identity reuse. |
| `persistence.edit.*` | Four writes to one document in a 256-document tree. Compare synchronous `onSnapshot` plus `JSON.stringify` on that leaf, on the root, or on the root with the four edits grouped in a `batch`. Callback count, JSON payload, and bytes are checked or reported. |
| `workspace.editor.cycle` | Mount a saved workspace with a prepared 64-document catalog, first-read eight keyed editors and restore their drafts, reverse/reuse them, edit a draft and a document, save both snapshots as JSON, close one editor, then dispose the workspace. Inspired by `tests/workspace.publicWorkflow.test.ts`. Document changes after close and after disposal probe for stale editor subscriptions over repeated cycles on the same catalog. |

These workloads use the public runtime entry, with no inspection recording or React. The workflow's subscription starts, cleanups, peak active count and post-disposal callback probes track subscriptions owned by this fixture; they do not establish heap retention, memory footprint, or GC behavior. JSON persistence here is in memory, not storage I/O. These are Node results, not browser rendering, SSR, or end-user latency.

The suite leaves two specialized commands intact: `pnpm benchmark:snapshot-diff` measures plain diff generation and Model snapshot/diff notifications across sizes and mutation patterns (with optional historical source comparison or regression verification). `pnpm benchmark:activity` measures inspection recording disabled vs active (and optionally against a pre-hook revision), using CPU time. The runtime suite does not reproduce the diff engine or enable the activity recorder; don't compare timings across these commands as if they shared operations or clocks.

## Compare two runtime revisions

Run both on the same machine, in the same harness checkout with the same installed dependencies and Node version, while other work is quiet. Leave `NODE_OPTIONS` unset. `--runtime` accepts a local Git ref (use full SHAs for records) and defaults to committed `HEAD`. It compiles the selected commit's `src/` with the harness's esbuild configuration and dependencies; local changes to `src/` are never measured. It does not check out either revision, rebuild a published package, or use the selected commit's lockfile. Commit candidate source before benchmarking it.

```sh
base=6d5a7ce3c375ea8184cc58287a26bebe80b6155d
candidate=$(git rev-parse HEAD)  # Or set this to the candidate's local commit SHA.
pnpm benchmark:baseline --runtime "$base" --json node_modules/.cache/before.json
pnpm benchmark:baseline --runtime "$candidate" --json node_modules/.cache/after.json
pnpm benchmark:baseline --compare node_modules/.cache/before.json node_modules/.cache/after.json
```

The helper checks harness source hash, reported environment, measurement options, case definitions and counters before comparing median and spread by case ID. Hardware labels are not proof of identical machines. Positive percent change means slower. Repeat the pair in reverse run order to check small deltas against local variation; a timing change near run-to-run spread is inconclusive. If a runtime intentionally changes workload semantics, adjust and re-run both revisions with a version of the harness that verifies the intended behavior rather than timing unequal work. Don't compare a fresh run on your machine against the absolute numbers checked in here.
