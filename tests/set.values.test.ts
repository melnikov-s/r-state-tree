import { effect, isObservable, observable, source } from "../src";

const set = <T>(obj: Set<T> = new Set()) => {
	return observable(obj);
};

const keys = <T>(set: Set<T>): T[] => {
	return Array.from(set.keys());
};

test("set forEach returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const s = set();
	s.add(target);

	s.forEach((t) => {
		ran = true;
		// Shallow behavior: items are NOT wrapped
		expect(isObservable(t)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("set keys returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const s = set();
	s.add(target);

	Array.from(s.keys()).forEach((t) => {
		ran = true;
		// Shallow behavior: items are NOT wrapped
		expect(isObservable(t)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("set values returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const s = set();
	s.add(target);

	Array.from(s.values()).forEach((t) => {
		ran = true;
		// Shallow behavior: items are NOT wrapped
		expect(isObservable(t)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("set entries returns raw (non-observable) items", () => {
	const target = {};
	let ran = false;
	const s = set();
	s.add(target);

	Array.from(s.entries()).forEach(([k, v]) => {
		ran = true;
		// Shallow behavior: items are NOT wrapped
		expect(isObservable(k)).toBe(false);
		expect(isObservable(v)).toBe(false);
	});

	expect(ran).toBe(true);
});

test("set equality for observed and target objects", () => {
	let target = {};
	let s = set();
	s.add(target);
	let o = observable(target);
	expect(s.has(o)).toBe(true);

	s = set();
	target = {};
	o = observable(target);
	s.add(o);
	expect(s.has(target)).toBe(true);
	s.add(target);
	expect(s.size).toBe(1);

	s.delete(target);
	expect(s.size).toBe(0);
});

test("set can store and find observable values", () => {
	const o1 = observable({});
	const o2 = observable({});
	const plain = {};

	const s = set(new Set([o1, o2, plain]));
	expect(s.has(o1)).toBe(true);
	expect(s.has(o2)).toBe(true);
	expect(s.has(plain)).toBe(true);
	expect(s.size).toBe(3);

	s.delete(o1);
	expect(s.size).toBe(2);
	s.delete(o2);
	expect(s.size).toBe(1);
	s.delete(plain);
	expect(s.size).toBe(0);
});

test("instanceof Set", () => {
	const s = set();
	expect(s instanceof Set).toBe(true);
});

test("does not trigger a change when same observable is set on set initialized with observable values", () => {
	const o1 = observable({ prop: 1 });
	const o2 = observable({ prop: 2 });

	const s = set(new Set([o1, o2].map(source)));

	let count = 0;
	effect(() => {
		s.forEach(() => {});
		count++;
	});
	expect(count).toBe(1);
	s.add(o1);
	expect(s.size).toBe(2);
	expect(count).toBe(1);
	s.add(source(o1));
	expect(s.size).toBe(2);
	expect(count).toBe(1);
	s.delete(o2);
	expect(s.size).toBe(1);
	expect(count).toBe(2);
});

test("[mobx-test] set should support iterable ", () => {
	const a = set(new Set([1, 2]));

	function leech(iter: IterableIterator<any>) {
		const values = [];
		let v;
		do {
			v = iter.next();
			if (!v.done) values.push(v.value);
		} while (!v.done);
		return values;
	}

	expect(leech(a.entries())).toEqual([
		[1, 1],
		[2, 2],
	]);

	expect(leech(a.keys())).toEqual([1, 2]);
	expect(leech(a.values())).toEqual([1, 2]);
});

test("[mobx-test] toStringTag", () => {
	const x = set();
	expect(x[Symbol.toStringTag]).toBe("Set");
	expect(Object.prototype.toString.call(x)).toBe("[object Set]");
});
