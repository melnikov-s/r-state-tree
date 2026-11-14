# r-state-tree lint rules

Opt-in, syntax-only rules shipped at `r-state-tree/lint`. The plugin is plain ESM JavaScript, imports no application/runtime code, and adds no dependencies. It runs in Oxlint's JavaScript-plugin host (verified with Oxlint **1.87.0**, Node **24.9.0**). Oxlint's JS-plugin API is still alpha; pin/test runner upgrades. The rules use ESLint-compatible `create(context)` / `context.sourceCode` APIs, but ESLint is not required or independently tested here.

Nothing enables these rules in a consuming application automatically. This repository explicitly applies all five rules to its test fixtures with `pnpm lint:fixtures`, also included in `pnpm lint`. There are no autofixes: wrapping state, changing factories, or moving a mutation can change behavior.

## Install and adopt explicitly

In an application already using `r-state-tree`:

```sh
pnpm add -D oxlint@1.87.0
```

Use a release of `r-state-tree` containing the `./lint` export. For an isolated strict setup, create `r-state-tree.oxlint.json` in **your application**, and enable all five rules at `error`:

```json
{
	"plugins": [],
	"categories": { "correctness": "off" },
	"jsPlugins": [{ "name": "r-state-tree", "specifier": "r-state-tree/lint" }],
	"rules": {
		"r-state-tree/no-computed-mutation": "error",
		"r-state-tree/no-direct-construction": "error",
		"r-state-tree/no-plain-collection-mutation": "error",
		"r-state-tree/no-observable-collection-replacement": "error",
		"r-state-tree/no-discarded-child-read": "error"
	}
}
```

```sh
pnpm exec oxlint --config r-state-tree.oxlint.json --deny-warnings src
```

This isolated example disables default built-in rules; it does not replace your normal lint invocation. Alternatively, add `jsPlugins` and the selected `rules` entries to your existing Oxlint configuration to keep your existing rules. `--type-aware` may still be used for built-in rules; these plugin rules need no type services or tsconfig changes.

For a checkout before publication, replace the plugin specifier with the **absolute path** to `lint/index.mjs`. A relative plugin path is resolved from the configuration file. Run only selected files during adoption. Rule severities support `off`, `warn`, and `error`; all five rules accept **no options**. Use ordinary `oxlint-disable-next-line r-state-tree/no-computed-mutation` suppression comments for reviewed exceptions, explaining the reason.

## no-computed-mutation

Prohibits recognizable writes to existing/external state during derivation:

- All instance getters declared on recognizable Store/Model subclasses, including `@child` descriptor getters.
- Getters marked with the imported `@computed` decorator or literal `static types = { field: computed }`, including on other classes.
- Inline callbacks, immutable `const` function callbacks, and named function declarations passed to the imported `computed()` function.

**Runtime distinction:** ordinary Store/Model getters currently pass through rather than being automatically memoized (`getPropertyType()` in `src/observables/internal/utils.ts`). Reads inside them can participate in the caller's tracking. This rule deliberately treats them as queries/derivations too. `@computed` getters are memoized. Store `@child` getters are computed descriptor producers (`StoreAdministration.getComputedGetter()`); creating descriptors and attaching deferred event callbacks is valid, but changing existing state while producing them is not.

Recognized writes include assignment (including compound/destructuring assignments), updates, `delete`, array mutators (`push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`), Map `set/delete/clear`, Set `add/delete/clear`, and direct global `Object.assign/defineProperty/defineProperties` or `Reflect.set/deleteProperty/defineProperty` target writes. Collection methods require a recognized collection receiver, not just a matching method name on an arbitrary service.

```ts
class Results extends Store {
	rows = observable([]);

	// Invalid: const does not make an alias into a copy.
	get sorted() {
		const result = this.rows;
		return result.sort();
	}

	// Valid: only the fresh container changes.
	get sortedCopy() {
		const result = [...this.rows];
		result.sort();
		return result;
	}

	// Invalid: the shallow copy still contains existing objects.
	get changedRows() {
		const result = this.rows.slice();
		result.forEach((row) => (row.title = "changed"));
		return result;
	}
}
```

Local allocations (`{}`, `[]`, global `new Array/Map/Set`) and local scalar counters can be mutated. Fresh result construction through shallow copies is distinguished from reference aliases. Known properties/elements of local containers retain external provenance: `{ row: this.row }` does not make `row` fresh. Object spreads and `Object.assign` merge possibly overwritten properties in source order: `{ item: {}, ...this.data }` may share `item`, whereas `{ ...this.data, item: {} }` overrides it with a fresh object. Array `concat` includes both receiver elements and argument provenance: array arguments contribute their elements, and ordinary non-array arguments contribute themselves. These copies remain shallow; mutating a copied container is allowed, but mutating its shared objects is not. Parameters may be rebound locally, but their existing objects must not be changed. Captured bindings/objects are existing state even when their declaration uses `const` or a literal initializer outside the derivation.

The analysis follows simple aliases, destructuring, reassignment, branches, collection element callbacks, `for...of`, IIFEs, and bounded direct local function calls (including helpers passed as callbacks). It enters array iteration/search/reduce/sort callbacks on recognized arrays, Map/Set `forEach`, and imported `batch` / `untracked` callbacks. `untracked` is not permission to mutate during a derivation. Merely defining, saving, returning, or passing a function to an unknown helper does **not** execute its body. Calling a generator or async generator initializes its parameters but does not enter its body; generator iteration effects (`next()`, `for...of`, spread, etc.) are not checked. Timers and Promise continuations are not entered. A callback independently passed to `computed()` is checked as its own derivation.

Direct local helper calls distinguish omitted arguments, unshadowed `undefined`, `void` expressions, and known missing properties of fresh literals from defined values. Defaults (including destructuring defaults) run for known undefined values and are skipped for known defined literals, fresh containers, and function values. For unknown or externally sourced arguments/properties, both the supplied-value and default paths are conservatively included: a default's potential external writes may be reported even if the actual argument is defined. Unknown spread arguments also leave parameter/default selection uncertain. An unknown argument is not itself proof of external mutation; a derivation's own parameters remain externally supplied.

### Analysis limits

This is a targeted bug detector, **not a proof of purity**:

- No type-checker, module graph, whole-program call graph, or arbitrary helper effect inference. Unknown calls such as `this.updateState()` or `helper(this.state)` are not certified pure and do not produce speculative diagnostics. Helpers declared outside a derivation are not followed, except a function directly supplied as the computed callback itself.
- Collection kinds come from literal/container initializers, immutable aliases, initialized fields (including locally known inherited fields), and simple Array/Map/Set parameter/variable annotations. Nested property types, generic Store props, factory return types, arbitrary classes, overloaded methods, and custom collection-like services are not inferred. `this.props.rows.map(...)` may therefore be outside the supported callback/mutator analysis; direct assignments to `this.props.rows` or its objects are still detected.
- Only imports from the exact public `r-state-tree` module are recognized, including named import aliases, namespaces, and simple immutable identifier aliases. Re-exports, CommonJS require, cross-file subclass imports, and dynamically computed names are not resolved. Shadowed names and unrelated classes are not matched by spelling.
- Local call tracking is limited to eight nested calls and 10,000 analysis steps per derivation; recursive cycles are not expanded. Beyond those bounds analysis stops without claiming purity.
- Branches/loops are approximated, not executed. There is no full control-flow, reachability, exception, async timing, object escape, dynamic property, destructured method, or prototype analysis. Complex joins (bounded to eight levels), escaping closures, nested collection shapes, Map constructor entries, helper returns, and alias changes across iterations can lose provenance. Statically visible potential writes can be reported even on a branch that never runs. Unknown getters/setters, proxy traps, getters in copied objects, or mutations hidden behind other APIs are not analyzed.
- Freshness is shallow. This follows common direct construction/copy patterns, not every identity-preserving/allocating library operation. Copied/concatenated arrays summarize possible element provenance, not exact output indexes; mixed fresh/external elements can therefore produce conservative reports. Native methods are interpreted according to their built-in contracts on recognized collection receivers; monkey-patched methods, `Symbol.isConcatSpreadable`, custom iterators, and custom species are not modeled.

## no-direct-construction

Require `createStore(Type, props)` and `ModelType.create(snapshot)` instead of `new` for imported Store/Model bases and locally recognizable subclasses. Local inheritance, class expressions, import aliases, namespaces, and immutable constructor aliases are supported. Names ending in `Store` or `Model` mean nothing without a recognized base. Imported application subclasses with an unknown base are deliberately skipped. No unsafe factory rewrite is offered.

## no-plain-collection-mutation

Detect in-place mutation of known **unwrapped** Store/Model collection fields initialized with array/object literals or global `new Array/Map/Set`. Includes native mutator calls on the field and index/property assignments, updates, or deletion under it. Direct `const` aliases, simple object destructuring, `this` aliases, and locally inherited fields are recognized; ordinary nested functions with their own `this` and static methods are excluded.

For mutable Store/Model arrays, objects, Maps, and Sets, initialize with `observable()` (or `toObservableTree()` for initial nested wrapping) and retain direct in-place mutations in authoritative methods/callbacks, **not in getters/computeds**. Do not rewrite `push`, `shift`, `splice`, index writes, or property writes into spread/`slice()` copy-and-reassign updates merely to pass lint. No autofix is offered: changing mutation semantics is not a safe lint repair.

Whole-field replacement remains legitimate for intentionally immutable value models; this rule does not report it. Plain derived/read-only collections need not be observable, and copies are appropriate at genuine ownership, snapshot, or transport boundaries. These are separate design choices, not interchangeable fixes for mutable state. Getters/computeds must remain pure; constructing fresh local results does not permit mutating shared elements.

`@child` / literal `static types` children and `@modelRef` arrays are excluded because their administrations handle them specially. Unknown initializers are skipped. Wrapping is shallow; this rule does not claim that items inside an observable container are observable.

## no-observable-collection-replacement

Detect assignments replacing a field initialized with imported `observable()` / `toObservableTree()` around a known collection, when the replacement is a literal, new container, immutable local alias of one, wrapped fresh container, or recognized array copy (`slice/filter/map/flatMap/concat/toSorted/toReversed/toSpliced/with`). Keep the observable container and mutate it in authoritative command methods, **not in computed getters**. Derived copies returned as plain results are allowed. Unknown helper-return replacements are skipped.

Both field rules are declaration-based, not instance-state dataflow: only inline initializers and literal decorator/static configuration are classified. They do not infer constructor-only initialization, later wrapping, runtime configuration, cross-file bases, or reassignment through mutable aliases. If a field intentionally changes between wrapped/unwrapped identities, review it manually or suppress the specific rule. They do not enforce arbitrary read placement: read reactive data at the intended tracking boundary, but a blanket “late reads” lint would be too noisy.

## no-discarded-child-read

An opt-in **problem** rule, recommended at `error`: report a standalone `this.worker;` or `void this.worker;` when `worker` is a locally known lazy **Store** child getter. Reading a Store child can initialize/mount it even when the value is discarded. Eager initialization solely for effects is a design error, including intentional startup warmup. Remove the discarded read and let an actual consumer initialize the child when it needs the value. If startup requires this read, revisit ownership and lifecycle design rather than suppressing the diagnostic. There is no autofix or automatic initialization rewrite.

```ts
class Workspace extends Store {
	@child get worker() {
		return createStore(Worker);
	}

	inspect() {
		this.worker; // Invalid: reads the lazy child solely for effects.
	}

	start() {
		void this.worker; // Also invalid: intentional warmup is not an exception.
	}

	runJob() {
		this.worker.runJob(); // Actual consumer: initialize when work is needed.
	}

	get currentWorker() {
		return this.worker;
	} // Consumed read: not reported.
}
```

The recognized subset is deliberately small:

- Exact public imports, aliases, namespaces, and locally resolved Store inheritance use the shared scope-aware analysis. Model-owned `@child` values are **not** lazy Store children and are excluded, as are unrelated/shadowed imports and unknown cross-file bases.
- Getter configuration must be recognizable as `@child`, `@child(Type)`, or a literal `static types = { worker: child }` / `{ worker: child(Type) }`. Locally inherited getters/configuration and known overrides are resolved. An effective non-getter or non-child configuration is excluded.
- Direct `this` member reads only, including fixed string/number keys (`this["worker"]`) and TypeScript wrappers. Dynamic keys and template-literal keys are skipped, not guessed. Immutable `this` aliases and destructured reads are outside this rule.
- Only whole expression statements are checked, optionally wrapped in `void`. Return values, assignments, call arguments, conditions, sequences, nested property reads, and child method calls are not reported. This is **not** unused-value dataflow or a general child-read ban.
- Method/getter bodies and their lexical arrows are checked, including deferred arrows: the diagnostic describes the read **if executed**, not whether it runs now. Ordinary nested functions have their own `this`. Static contexts, constructors, and instance-field initializers (including arrows capturing their raw `this`) are excluded.
- Ambiguous configurations are skipped conservatively: nonliteral/static-accessor `types`, spreads/accessors/methods/unknown keys in literal maps, static blocks, dynamic class member names, class decorators, and unknown/multiple decorators on the target. Runtime configuration changes, monkey-patching, arbitrary decorator effects, and manually invoking methods with a different receiver are not modeled.

The real monitoring pattern `disk.jobs.jobs` consumes its intermediate child and needs ownership/intent knowledge. This rule intentionally does **not** flag it. See [review and runtime-test guidance](review-guidance.md) for that case and all seven reviewed candidates, including why no post-`await` commit warning ships.

## Repository fixture adoption

`pnpm lint:fixtures` checks every TypeScript/JavaScript source in `tests/fixtures/` with all five rules at error severity, without suppressions. It is also part of `pnpm lint`.

The test fixtures import this checkout's `src/index` rather than a built package. Since the plugin intentionally recognizes only public `r-state-tree` imports, `scripts/lint-fixtures.mjs` checks a temporary source mirror with just those module specifiers normalized. No runtime code or project settings change; diagnostics retain original file paths and line numbers. The runner deletes the mirror afterward. A CLI regression checks that relative-source imports produce diagnostics for all five rules, preventing a silently ineffective check.

## Repository verification

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run tests/lint.
pnpm run test:types
pnpm run build
pnpm exec oxlint --type-aware lint tests/lint.*.test.ts tests/helpers/lint.ts
pnpm exec oxfmt --check lint tests/lint.*.test.ts tests/helpers/lint.ts
```

The regression fixtures live in the focused `tests/lint.*.test.ts` suites, with shared CLI setup in `tests/helpers/lint.ts`. They invoke the **actual Oxlint CLI** against temporary TypeScript fixtures and temporary isolated configurations, checking diagnostic counts/rules/ranges. An all-rule invocation asserts five diagnostics and exit code 1 for invalid code, and no diagnostics with exit code 0 for valid code. Intentional warmup via a discarded read is reported too; meaningful consumed reads remain unflagged. A helper call or unused local can conceal eager initialization from this narrow check; absence of a diagnostic does not endorse that design. Async-policy scope fixtures include both deliberately unsafe and legitimate continuations; they assert that no speculative async diagnostic is shipped, **not** that those continuations are safe. No project/editor/tsconfig settings are changed.
