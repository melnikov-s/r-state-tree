const assert = require("node:assert/strict");

exports.core = function core({ Store, createStore, mount, Model, toSnapshot }) {
	assert.equal(typeof Symbol.metadata, "symbol");
	class Counter extends Store {
		count = 0;
	}
	const store = mount(createStore(Counter));
	const seen = [];
	store.effect(() => seen.push(store.count));
	store.count++;
	assert.deepEqual(seen, [0, 1]);
	store[Symbol.dispose]();
	store.count++;
	assert.deepEqual(seen, [0, 1]);
	class Item extends Model {
		value = "packed";
	}
	assert.deepEqual(toSnapshot(Item.create()), { value: "packed" });
};

exports.react = function react(core, adapter, React, server) {
	exports.core(core);
	const { Store, createStore, mount } = core;
	const { observer, StoreProvider, useStore } = adapter;
	class Counter extends Store {
		count = 42;
	}
	const store = mount(createStore(Counter));
	const View = observer(() =>
		React.createElement("span", null, useStore(Counter).count)
	);
	assert.equal(
		server.renderToString(
			React.createElement(StoreProvider, { store }, React.createElement(View))
		),
		"<span>42</span>"
	);
	store[Symbol.dispose]();
};
