import { effect, observable, Observable, isObservable, computed } from "../src";

test("objects created from class return `false` from `isObservable`", () => {
	class C extends Observable {}

	const o = new C();
	expect(isObservable(o)).toBe(false);
});

test("objects create from class have observable properties", () => {
	class C extends Observable {
		@observable value = "prop";
	}

	const o = new C();
	let count = 0;

	effect(() => {
		o.value;
		count++;
	});

	o.value = "newProp";
	expect(count).toBe(2);
});

test("object methods return a value", () => {
	class C extends Observable {
		@observable value = "prop";

		readValue() {
			return this.value;
		}
	}

	const o = new C();
	expect(o.readValue()).toBe("prop");
});

test("object methods are observable", () => {
	class C extends Observable {
		@observable value = "prop";

		readValue() {
			return this.value;
		}
	}

	const o = new C();
	let count = 0;

	effect(() => {
		o.readValue();
		count++;
	});

	o.value = "newProp";
	expect(count).toBe(2);
});

test("object getters and setters on same property", () => {
	class C extends Observable {
		@observable valueA = 0;
		@observable valueB = 0;

		@computed get values() {
			return this.valueA + this.valueB;
		}

		set values(v: number) {
			this.valueA = v;
			this.valueB = v;
		}
	}

	const o = new C();
	let count = 0;

	effect(() => {
		o.values;
		count++;
	});

	o.values = 1;
	expect(count).toBe(2);
});

test("object getters return a value", () => {
	class C extends Observable {
		@observable value = "prop";

		@computed get readValue() {
			return this.value;
		}
	}

	const o = new C();
	expect(o.readValue).toBe("prop");
});

test("object getters are observable", () => {
	class C extends Observable {
		@observable value = "prop";

		@computed get readValue() {
			return this.value;
		}
	}

	const o = new C();
	let count = 0;

	effect(() => {
		o.readValue;
		count++;
	});

	o.value = "newProp";
	expect(count).toBe(2);
});

test("can have properties that are Promise", async () => {
	class C extends Observable {
		@observable value = Promise.resolve(42);
	}

	const o = new C();
	const v = await o.value;
	expect(v).toBe(42);
});

test("instanceof operator on observable class and object", () => {
	class C extends Observable {}
	const c = new C();
	expect(c).toBeInstanceOf(C);
});

test("constructor has observable instance", () => {
	const weakSet = new WeakSet();

	class C extends Observable {
		constructor() {
			super();
			weakSet.add(this);
		}
		@observable prop = {};
		arrowFunc = () => {
			expect(isObservable(this.prop)).toBe(true);
		};
	}

	const c = new C();
	c.arrowFunc();
	expect(weakSet.has(c)).toBe(true);
	expect.assertions(2);
});

describe("@observable.shallow", () => {
	test("shallow observable container is reactive", () => {
		class C extends Observable {
			@observable.shallow items: { value: number }[] = [];
		}

		const c = new C();
		let count = 0;

		effect(() => {
			c.items.length;
			count++;
		});

		c.items.push({ value: 1 });
		expect(count).toBe(2);
	});

	test("shallow observable does not make pushed items observable", () => {
		class C extends Observable {
			@observable.shallow items: { value: number }[] = [];
		}

		const c = new C();
		c.items.push({ value: 1 });

		expect(isObservable(c.items[0])).toBe(false);
	});

	test("shallow observable does not make nested object properties observable", () => {
		class C extends Observable {
			@observable.shallow data: { nested: { value: number } } = {
				nested: { value: 1 },
			};
		}

		const c = new C();
		let count = 0;

		effect(() => {
			c.data.nested.value;
			count++;
		});

		c.data.nested.value = 2;
		expect(count).toBe(1);

		c.data = { nested: { value: 3 } };
		expect(count).toBe(2);
	});

	test("shallow observable container tracks array mutations", () => {
		class C extends Observable {
			@observable.shallow items: number[] = [];
		}

		const c = new C();
		let count = 0;

		effect(() => {
			c.items.length;
			count++;
		});

		c.items.push(1);
		expect(count).toBe(2);
		c.items.pop();
		expect(count).toBe(3);
	});

	test("shallow observable works with Map", () => {
		class C extends Observable {
			@observable.shallow map = new Map<string, { value: number }>();
		}

		const c = new C();
		let count = 0;

		effect(() => {
			c.map.size;
			count++;
		});

		c.map.set("a", { value: 1 });
		expect(count).toBe(2);

		expect(isObservable(c.map.get("a"))).toBe(false);
	});

	test("shallow observable allows structuredClone of values", () => {
		class C extends Observable {
			@observable.shallow items: { value: number }[] = [];
		}

		const c = new C();
		c.items.push({ value: 1 });

		expect(() => structuredClone(c.items[0])).not.toThrow();
	});

	test("can mix regular and shallow observables in same class", () => {
		class C extends Observable {
			@observable deepItems: { value: number }[] = [];
			@observable.shallow shallowItems: { value: number }[] = [];
		}

		const c = new C();
		c.deepItems.push({ value: 1 });
		c.shallowItems.push({ value: 2 });

		expect(isObservable(c.deepItems[0])).toBe(true);
		expect(isObservable(c.shallowItems[0])).toBe(false);
	});
});

describe("@observable.signal", () => {
	test("signal observable triggers on assignment", () => {
		class C extends Observable {
			@observable.signal items: number[] = [];
		}

		const c = new C();
		let count = 0;

		effect(() => {
			c.items;
			count++;
		});

		c.items = [1, 2, 3];
		expect(count).toBe(2);
	});

	test("signal observable does NOT trigger on array mutations", () => {
		class C extends Observable {
			@observable.signal items: number[] = [];
		}

		const c = new C();
		let count = 0;

		effect(() => {
			c.items;
			count++;
		});

		c.items.push(1);
		expect(count).toBe(1);

		c.items.pop();
		expect(count).toBe(1);

		c.items = [...c.items, 2];
		expect(count).toBe(2);
	});

	test("signal observable value is NOT observable", () => {
		class C extends Observable {
			@observable.signal data: { value: number } = { value: 1 };
		}

		const c = new C();

		expect(isObservable(c.data)).toBe(false);
	});

	test("signal observable nested properties are not tracked", () => {
		class C extends Observable {
			@observable.signal data: { nested: { value: number } } = {
				nested: { value: 1 },
			};
		}

		const c = new C();
		let count = 0;

		effect(() => {
			c.data.nested.value;
			count++;
		});

		c.data.nested.value = 2;
		expect(count).toBe(1);
	});

	test("signal observable allows structuredClone", () => {
		class C extends Observable {
			@observable.signal data: { value: number } = { value: 1 };
		}

		const c = new C();

		expect(() => structuredClone(c.data)).not.toThrow();
	});
});
