const typescript = require("rollup-plugin-typescript2");
const { name } = require("./package.json");

module.exports = {
	input: "src/index.ts",
	plugins: [typescript()],
	output: [
		{
			file: "lib/r-state-tree.js",
			format: "umd",
			name: "r-state-tree",
			sourcemap: true
		},
		{
			file: "lib/r-state-tree.module.js",
			format: "es",
			name: "r-state-tree",
			sourcemap: true
		}
	]
};
