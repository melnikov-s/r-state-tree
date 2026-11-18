import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as esm from "r-state-tree";

const require = createRequire(import.meta.url);
const cjs = require("r-state-tree");

assert.notEqual(esm.Store, cjs.Store);
assert.notEqual(esm.Model, cjs.Model);
for (const [runtime, other] of [
	[esm, cjs],
	[cjs, esm],
]) {
	class Draft extends runtime.Store {
		static types = { text: runtime.snapshot };
		text = "draft";
	}
	class Document extends runtime.Model {
		text = "published";
	}
	const store = runtime.mount(runtime.createStore(Draft));
	const document = Document.create();
	try {
		assert.deepEqual(runtime.toSnapshot(store), { state: { text: "draft" } });
		assert.deepEqual(runtime.toSnapshot(document), { text: "published" });
		for (const value of [store, document]) {
			assert.equal(runtime.isObservable(value), true);
			assert.equal(other.isObservable(value), false);
			assert.throws(() => other.toSnapshot(value), TypeError);
		}
	} finally {
		store[Symbol.dispose]();
		document[Symbol.dispose]();
	}
}
