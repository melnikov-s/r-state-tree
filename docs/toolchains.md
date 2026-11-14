# Decorators and toolchains

[Quick start](../README.md#quick-start) · [API reference](reference.md)

r-state-tree supports standard (Stage 3) decorators and a decorator-free
`static types` alternative. TypeScript annotations do not provide runtime child
constructors: Model snapshot hydration needs `@child(User)` or `child(User)`.

## Tested repository configurations

These are the combinations configured in this repository, not an exhaustive
compatibility matrix or a claim that every application pipeline has been tested.
Versions below are pinned in `package.json` / `pnpm-lock.yaml`.

| Path | Toolchain | What it exercises |
| --- | --- | --- |
| Runtime tests (`vitest.config.mts`) | Node 24, Vitest 5.0.3 / Vite 8.3.4, esbuild 0.28.2 pre-transform | Standard decorators in `.ts` tests and source; `experimentalDecorators: false`, define-style class fields, ES2022 output |
| Type checks and declarations (`tsconfig.json`, `tests/tsconfig.json`) | TypeScript 7.0.2 | Standard-decorator typing and declaration emission, not a `tsc`-emitted application runtime |
| Library bundles (`vite.config.mts`) | Vite 8.3.4 / Rolldown | ESM and CJS library output; does not establish support for decorated application source through the default Vite transform |
| Browser inspector fixture (`tests/fixtures/live-inspector/vite.config.mts`) | Vite 8.3.4 plus inspector plugin | Live-inspector integration; not evidence of a general standard-decorator application transform |

The runtime test configuration explicitly uses esbuild because Vite 8's default
Oxc transform supports legacy decorators rather than the standard decorators this
API uses. Setting `target: "es2022"` alone does not select standard-decorator
semantics. The older Vite `esbuild.target` snippet is not a complete Vite 8 setup.

## TypeScript settings

Standard decorators require TypeScript 5.0 or later. That is the syntax minimum,
not the version matrix tested here. A starting point for an application is:

```json
{
	"compilerOptions": {
		"target": "es2022",
		"module": "esnext",
		"moduleResolution": "bundler",
		"strict": true,
		"experimentalDecorators": false,
		"useDefineForClassFields": true,
		"lib": ["es2022", "esnext.disposable", "dom"],
		"jsx": "react-jsx",
		"noEmit": true
	}
}
```

These settings guide TypeScript; the tool that transforms the application must
also implement standard decorators and decorator metadata. Legacy
`experimentalDecorators: true` / `emitDecoratorMetadata` is not a substitute.

The library entry point imports a `Symbol.metadata` polyfill. This does not
transform decorators or polyfill every runtime API. Explicit resource management
(`using` / `Symbol.dispose`) and optional APIs such as `AbortSignal.any()` also
need an appropriate runtime or application-provided polyfill.

## The tested decorator transform

The repository's Vitest plugin uses this pre-transform. It handles decorated
`.ts` files, not TSX or every possible module/query suffix:

```ts
import { transform } from "esbuild";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		{
			name: "standard-decorators",
			enforce: "pre",
			async transform(code, id) {
				if (!id.endsWith(".ts") || !code.includes("@")) return;
				return transform(code, {
					loader: "ts",
					target: "es2022",
					sourcefile: id,
					sourcemap: true,
					tsconfigRaw: {
						compilerOptions: {
							experimentalDecorators: false,
							useDefineForClassFields: true,
						},
					},
				});
			},
		},
	],
});
```

Compare with the actual [test configuration](../vitest.config.mts), which also
sets up the test environment. For a Vite application, integrate an equivalent
standard-decorator transform into its own plugin chain and verify both development
and production builds. TSX needs a TSX loader and appropriate JSX handling;
React plugins, SSR, dependency transforms, and plugin ordering need their own
checks. This repository does not certify those combinations merely because its
`.ts` test transform works.

To avoid that dependency on the application compiler, use `static types`:

```ts
import { child, id, Model } from "r-state-tree";

class User extends Model {
	id = 0;
	name = "";
	static types = { id };
}

class Project extends Model {
	users: User[] = [];
	static types = { users: child(User) };
}

const project = Project.create({ users: [{ id: 1, name: "Ada" }] });
project[Symbol.dispose]();
```
