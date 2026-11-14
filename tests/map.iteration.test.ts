import { observable, reaction } from "../src";

const map = <K = any, V = any>(obj: Map<K, V> = new Map()): Map<K, V> => {
	return observable(obj) as Map<K, V>;
};

const keys = (map: Map<any, any>): any[] => {
	return Array.from(map.keys());
};

const values = (map: Map<any, any>): any[] => {
	return keys(map).map((key) => map.get(key));
};

function iteratorToArray(it: any) {
	const res = [];
	while (true) {
		const r = it.next();
		if (!r.done) {
			res.push(r.value);
		} else {
			break;
		}
	}
	return res;
}

test("[mobx-test] can iterate maps", () => {
	const x = map();
	const y = [];
	const d = reaction(
		() => Array.from(x),
		(items) => y.push(items)
	);

	y.push(Array.from(x));
	x.set("a", "A");
	x.set("b", "B");
	expect(y).toEqual([
		[],
		[["a", "A"]],
		[
			["a", "A"],
			["b", "B"],
		],
	]);
	d();
});

test("[mobx-test] can iterate map - entries", () => {
	const x = map();
	const y = [];
	const d = reaction(
		() => iteratorToArray(x.entries()),
		(items) => y.push(items)
	);

	y.push(iteratorToArray(x.entries()));
	x.set("a", "A");
	x.set("b", "B");
	expect(y).toEqual([
		[],
		[["a", "A"]],
		[
			["a", "A"],
			["b", "B"],
		],
	]);
	d();
});

test("[mobx-test] can iterate map - keys", () => {
	const x = map();
	const y = [];
	const d = reaction(
		() => iteratorToArray(x.keys()),
		(items) => y.push(items)
	);

	y.push(iteratorToArray(x.keys()));
	x.set("a", "A");
	x.set("b", "B");
	expect(y).toEqual([[], ["a"], ["a", "b"]]);
	d();
});

test("[mobx-test] can iterate map - values", () => {
	const x = map();
	const y = [];
	const d = reaction(
		() => iteratorToArray(x.values()),
		(items) => y.push(items)
	);

	y.push(iteratorToArray(x.values()));
	x.set("a", "A");
	x.set("b", "B");
	expect(y).toEqual([[], ["A"], ["A", "B"]]);
	d();
});

test("[mobx-test] maps.values, keys and maps.entries are iterables", () => {
	const x = map(new Map(Object.entries({ x: 1, y: 2 })));
	expect(Array.from(x.entries())).toEqual([
		["x", 1],
		["y", 2],
	]);
	expect(Array.from(x.values())).toEqual([1, 2]);
	expect(Array.from(x.keys())).toEqual(["x", "y"]);
});

test("[mobx-test] iterators should be resilient to concurrent delete operation", () => {
	function testIterator(method: any) {
		const m = map(
			new Map([
				[1, 1],
				[2, 2],
				[3, 3],
			])
		);
		const expectedMap = map(
			new Map([
				[1, 1],
				[2, 2],
				[3, 3],
			])
		);
		for (const entry of (m as any)[method]()) {
			const key = Array.isArray(entry) ? entry[0] : entry;
			const deleted1 = m.delete(key);
			const deleted2 = expectedMap.delete(key);
			expect(deleted1).toBe(true);
			expect(deleted2).toBe(true);
			expect(m.size).toBe(expectedMap.size);
			expect(Array.from(m)).toEqual(Array.from(expectedMap));
		}
	}

	testIterator("keys");
	testIterator("values");
	testIterator("entries");
});

test("iterator reflects mutations during iteration (Map)", () => {
	const m = map(new Map([["a", 1]]));
	const iterator = m.keys();
	m.set("b", 2);
	expect(iterator.next().value).toBe("a");
	expect(iterator.next().value).toBe("b");
	expect(iterator.next().done).toBe(true);
});

test("iterator reflect deletions during iteration (Map)", () => {
	const m = map(
		new Map([
			["a", 1],
			["b", 2],
		])
	);
	const iterator = m.keys();
	expect(iterator.next().value).toBe("a");
	m.delete("b");
	expect(iterator.next().done).toBe(true);
});

describe("Uninstrumented collection methods (Branding check safety)", () => {
	test("Map properties that are functions should not throw incompatible receiver", () => {
		const m = map(new Map([["a", 1]]));

		// Mock a native-like method on Map prototype
		(Map.prototype as any).someNewMapMethod = function () {
			if (!(this instanceof Map)) {
				throw new TypeError(
					"Method Map.prototype.someNewMapMethod called on incompatible receiver"
				);
			}
			return Array.from(this.entries());
		};

		try {
			let result;
			expect(() => {
				result = (m as any).someNewMapMethod();
			}).not.toThrow();
			expect(result).toEqual([["a", 1]]);
		} finally {
			delete (Map.prototype as any).someNewMapMethod;
		}
	});

	test("Fluent uninstrumented Map methods should return the proxy", () => {
		const m = map(new Map());

		(Map.prototype as any).fluentMapMethod = function () {
			return this;
		};

		try {
			const result = (m as any).fluentMapMethod();
			expect(result).toBe(m);
		} finally {
			delete (Map.prototype as any).fluentMapMethod;
		}
	});
});
