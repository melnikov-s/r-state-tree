const assert = require("node:assert/strict");

for (const peer of [
	"react",
	"@preact/signals-react",
	"@modelcontextprotocol/sdk",
	"ws",
	"@types/node",
]) {
	assert.throws(() => require.resolve(peer), { code: "MODULE_NOT_FOUND" });
}
require("./core.cjs");
assert.ok(
	!Object.keys(require.cache).some((path) =>
		/node_modules\/(react|@preact\/signals-react)\//.test(path)
	)
);
