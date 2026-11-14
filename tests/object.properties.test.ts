import {
	effect,
	observable,
	source,
	reportChanged,
	isObservable,
} from "../src";

function object<T extends object>(obj: T = {} as T): Record<string, any> {
	return observable(obj);
}

test("observables can be stored and retrieved", () => {
	const target = { prop: undefined };
	const o = object(target);
	const oTarget = { prop: "value" };
	const c = observable(oTarget);

	o.prop = c;
	expect(o.prop).toBe(c);
});

test("does not overwrite observable values", () => {
	const o1 = observable({});

	const o = object({ o1 });
	o.o1 = o1;

	// If the user seeded the source object with a proxy, it must be preserved.
	expect(source(o).o1).toBe(o1);
});

test("dnyamic property keys are observable", () => {
	const o1 = observable({});
	let count = 0;
	effect(() => {
		count++;
		(o1 as any).value;
	});
	expect(count).toBe(1);

	(o1 as any).value = 1;
	expect(count).toBe(2);
});

// With shallow behavior, nested objects are NOT wrapped automatically
test("observable values can be assigned via Object.assign", () => {
	const target = { prop: undefined };
	const o = object(target);
	const oTarget = { prop: "value" };
	const c = observable(oTarget);

	Object.assign(o, { prop: c });
	expect(o.prop).toBe(c);
});

test("getters are observable but not auto-computed", () => {
	let count = 0;
	const o = observable({
		prop: 1,
		get comp() {
			count++;
			return this.prop * 2;
		},
	});

	// Effects should re-run when dependencies change
	let effectCount = 0;
	effect(() => {
		o.comp;
		effectCount++;
	});
	expect(effectCount).toBe(1);

	// Changing prop triggers effect re-run (getter is still observable)
	o.prop++;
	expect(effectCount).toBe(2);

	// Getter returns correct value
	expect(o.comp).toBe(4);

	// Key behavioral change: getter is NOT memoized
	// Each read increments count (unlike computed which would cache)
	const countBefore = count;
	o.comp;
	o.comp;
	expect(count).toBeGreaterThan(countBefore);
});

test("can only have one observable proxy per object", () => {
	const target = {};

	expect(object(target)).toBe(object(target));
});

test("target is updated when observable value updates", () => {
	const target = {} as any;
	const o = object(target);
	o.prop = "value";
	expect(target.prop).toBe("value");
});

test("observable value is updated when target is updated", () => {
	const target = {} as any;
	const o = object(target);
	o.prop = "value";
	expect(target.prop).toBe("value");
	delete o.prop;
	expect("prop" in target).toBe(false);
});

// REMOVED: "observable objects are deeply observed" test
// With shallow behavior, nested objects are NOT automatically wrapped as observable
// Container mutations are tracked but nested property changes are not

test("does not respond to no-op", () => {
	let count = 0;
	const x = object({});

	effect(() => {
		count++;
		return x.x;
	});

	x.x = 1;
	expect(count).toBe(2);
	x.x = 2;
	expect(count).toBe(3);
	x.x = 2;
	expect(count).toBe(3);
});

test("does not observe constructors indirectly", () => {
	const C = class {};
	const o = object({ v: C });
	expect(isObservable(new o.v())).toBe(false);
});

test("frozen objects are not observed", () => {
	const o = object({ toBeFrozen: {} });
	Object.freeze(source(o).toBeFrozen);
	expect(isObservable(o.toBeFrozen)).toBe(false);
});

test("action can turn into observable", () => {
	let count = 0;
	const o = object({ v() {} });

	effect(() => {
		count++;
		return o.v;
	});

	o.v = 1;
	expect(count).toBe(2);
	o.v = 2;
	expect(count).toBe(3);
});

test("observable can turn into action", () => {
	let count = 0;
	const o = object({ v: 0 });
	const o2 = object({ v: 0 });

	effect(() => {
		count++;
		return o.v + o2.v;
	});

	o.v = function () {
		o2.v++;
	};

	expect(count).toBe(2);
	o.v();
	expect(count).toBe(3);
});

test("action can turn into observable (source)", () => {
	let count = 0;
	const o = object({ v() {} });

	effect(() => {
		count++;
		return o.v;
	});

	source(o).v = 1;
	reportChanged(o);
	expect(count).toBe(2);
});

test("observable can turn into action (source)", () => {
	let count = 0;
	const o = object({ v: 0 });
	const o2 = object({ v: 0 });

	effect(() => {
		count++;
		return o.v + o2.v;
	});

	source(o).v = function () {
		o2.v++;
	};

	reportChanged(o);

	expect(count).toBe(2);
	o.v();
	expect(count).toBe(3);
});
