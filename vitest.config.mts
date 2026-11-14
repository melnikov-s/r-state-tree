import { defineConfig } from "vitest/config";
import { transform } from "esbuild";

export default defineConfig({
	plugins: [
		{
			name: "standard-decorators",
			enforce: "pre",
			async transform(code, id) {
				if (!id.endsWith(".ts") || !code.includes("@")) return;
				// Vite 8's Oxc transform supports legacy decorators, not the
				// standard decorators used by our API and its regression tests.
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
	test: {
		globals: true,
		environment: "node",
		// Focused suites use <subject>.test<Type>.ts; helpers stay undiscovered.
		include: ["tests/**/*.test.ts", "tests/**/*.test[A-Z]*.ts"],
		setupFiles: ["@tsmetadata/polyfill", "./tests/setup.ts"],
		coverage: {
			provider: "v8",
		},
	},
});
