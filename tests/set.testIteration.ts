import { effect, isObservable, observable } from "../src";

const set = <T>(obj: Set<T> = new Set()) => {
	return observable(obj);
};

test("iterator reflects mutations during iteration (Set)", () => {
	const s = set(new Set(["a"]));
	const iterator = s.values();
	s.add("b");
	expect(iterator.next().value).toBe("a");
	expect(iterator.next().value).toBe("b");
	expect(iterator.next().done).toBe(true);
});

test("iterator reflect deletions during iteration (Set)", () => {
	const s = set(new Set(["a", "b"]));
	const iterator = s.values();
	expect(iterator.next().value).toBe("a");
	s.delete("b");
	expect(iterator.next().done).toBe(true);
});

describe("Uninstrumented collection methods (Branding check safety)", () => {
	test("Set.prototype.union (or other new methods) should not throw incompatible receiver", () => {
		const s1 = set(new Set([1, 2]));
		const s2 = new Set([2, 3]);

		if (typeof (Set.prototype as any).union === "function") {
			expect(() => {
				(s1 as any).union(s2);
			}).not.toThrow();
		} else {
			(Set.prototype as any).someNonExistentMethod = function () {
				if (!(this instanceof Set)) {
					throw new TypeError(
						"Method Set.prototype.someNonExistentMethod called on incompatible receiver"
					);
				}
				return this;
			};

			try {
				expect(() => {
					(s1 as any).someNonExistentMethod();
				}).not.toThrow();
			} finally {
				delete (Set.prototype as any).someNonExistentMethod;
			}
		}
	});

	test("Fluent uninstrumented methods should return the proxy", () => {
		const s = set(new Set([1]));

		(Set.prototype as any).fluentMethod = function () {
			return this;
		};

		try {
			const result = (s as any).fluentMethod();
			expect(result).toBe(s);
		} finally {
			delete (Set.prototype as any).fluentMethod;
		}
	});

	test("New Set methods should be reactive and return observables", () => {
		if (typeof (Set.prototype as any).union !== "function") return;

		const s1 = set(new Set([1]));
		const s2 = set(new Set([2]));
		let count = 0;
		let union;

		effect(() => {
			union = (s1 as any).union(s2);
			count++;
		});

		expect(count).toBe(1);
		expect(isObservable(union)).toBe(false);
		expect(Array.from(union as any)).toEqual([1, 2]);

		s1.add(3);
		expect(count).toBe(2);
		expect(new Set(Array.from(union as any))).toEqual(new Set([1, 2, 3]));

		s2.add(4);
		expect(count).toBe(3);
		expect(new Set(Array.from(union as any))).toEqual(new Set([1, 2, 3, 4]));
	});

	test("Intersection should be reactive and return observables", () => {
		if (typeof (Set.prototype as any).intersection !== "function") return;

		const s1 = set(new Set([1, 2]));
		const s2 = set(new Set([2, 3]));
		let count = 0;
		let intersection;

		effect(() => {
			intersection = (s1 as any).intersection(s2);
			count++;
		});

		expect(count).toBe(1);
		expect(new Set(Array.from(intersection as any))).toEqual(new Set([2]));

		s1.add(3);
		expect(count).toBe(2);
		expect(new Set(Array.from(intersection as any))).toEqual(new Set([2, 3]));

		s2.delete(2);
		expect(count).toBe(3);
		expect(new Set(Array.from(intersection as any))).toEqual(new Set([3]));
	});

	test("Difference should be reactive and return observables", () => {
		if (typeof (Set.prototype as any).difference !== "function") return;

		const s1 = set(new Set([1, 2, 3]));
		const s2 = set(new Set([2, 4]));
		let count = 0;
		let diff;

		effect(() => {
			diff = (s1 as any).difference(s2);
			count++;
		});

		expect(count).toBe(1);
		expect(new Set(Array.from(diff as any))).toEqual(new Set([1, 3]));

		s1.add(5);
		expect(count).toBe(2);
		expect(new Set(Array.from(diff as any))).toEqual(new Set([1, 3, 5]));

		s2.add(1);
		expect(count).toBe(3);
		expect(new Set(Array.from(diff as any))).toEqual(new Set([3, 5]));
	});

	test("Boolean ES Set methods (isSubsetOf, etc) should be reactive", () => {
		if (typeof (Set.prototype as any).isSubsetOf !== "function") return;

		const s1 = set(new Set([1, 2]));
		const s2 = set(new Set([1, 2, 3]));
		let count = 0;
		let isSubset = false;

		effect(() => {
			isSubset = (s1 as any).isSubsetOf(s2);
			count++;
		});

		expect(count).toBe(1);
		expect(isSubset).toBe(true);

		s1.add(4);
		expect(count).toBe(2);
		expect(isSubset).toBe(false);

		s2.add(4);
		expect(count).toBe(3);
		expect(isSubset).toBe(true);
	});

	test("isDisjointFrom should be reactive", () => {
		if (typeof (Set.prototype as any).isDisjointFrom !== "function") return;

		const s1 = set(new Set([1]));
		const s2 = set(new Set([2]));
		let count = 0;
		let disjoint = false;

		effect(() => {
			disjoint = (s1 as any).isDisjointFrom(s2);
			count++;
		});

		expect(count).toBe(1);
		expect(disjoint).toBe(true);

		s2.add(1);
		expect(count).toBe(2);
		expect(disjoint).toBe(false);

		s1.delete(1);
		expect(count).toBe(3);
		expect(disjoint).toBe(true);
	});
});
