import { effect, observable, isObservable, computed, Observable } from "../src";

describe("private fields and built-ins compatibility", () => {
	test("post-hoc proxying returns instance raw (not proxied)", () => {
		class C {
			#x = 1;
			read() {
				return this.#x;
			}
		}

		const inst = new C();
		const o = observable(inst);
		// Should return raw instance, NOT a proxy
		expect(o).toBe(inst);
		expect(isObservable(o)).toBe(false);
		expect(o.read()).toBe(1);
	});

	test("return observable(this) in same constructor returns instance raw", () => {
		class C {
			#x = 1;
			constructor() {
				return observable(this);
			}
			read() {
				return this.#x;
			}
		}

		const o = new C();
		// Should return raw instance
		expect(isObservable(o)).toBe(false);
		expect(o.read()).toBe(1);
	});

	test("extends Observable supports derived #private fields", () => {
		class C extends Observable {
			#x = 1;
			read() {
				return this.#x;
			}
		}

		const o = new C();
		// This SHOULD work because the Proxy is created in the base constructor
		expect(o.read()).toBe(1);
	});

	test("unsupported built-ins are returned raw (not proxied)", () => {
		const url = new URL("https://example.com");
		const proxiedUrl = observable(url);
		expect(proxiedUrl).toBe(url);
		expect(isObservable(proxiedUrl)).toBe(false);

		const regExp = new RegExp("x");
		const proxiedRegExp = observable(regExp);
		expect(proxiedRegExp).toBe(regExp);
		expect(isObservable(proxiedRegExp)).toBe(false);
	});
});

test("objects created from plain class with observable state work", () => {
	class C {
		state = observable({ value: "prop" });
	}

	const o = new C();
	let count = 0;

	effect(() => {
		o.state.value;
		count++;
	});

	o.state.value = "newProp";
	expect(count).toBe(2);
});

test("object methods return a value", () => {
	class C {
		state = observable({ value: "prop" });

		readValue() {
			return this.state.value;
		}
	}

	const o = new C();
	expect(o.readValue()).toBe("prop");
});

test("object methods are observable", () => {
	class C {
		state = observable({ value: "prop" });

		readValue() {
			return this.state.value;
		}
	}

	const o = new C();
	let count = 0;

	effect(() => {
		o.readValue();
		count++;
	});

	o.state.value = "newProp";
	expect(count).toBe(2);
});

test("object getters and setters on same property", () => {
	class C {
		state = observable({ valueA: 0, valueB: 0 });

		get values() {
			return this.state.valueA + this.state.valueB;
		}

		set values(v: number) {
			this.state.valueA = v;
			this.state.valueB = v;
		}
	}

	const o = new C();
	let count = 0;

	effect(() => {
		o.values;
		count++;
	});

	o.values = 1;
	// Setter modifies 2 properties, so effect runs 3 times total: 1 initial + 2 changes
	expect(count).toBe(3);
});

test("object getters return a value", () => {
	class C {
		state = observable({ value: "prop" });

		get readValue() {
			return this.state.value;
		}
	}

	const o = new C();
	expect(o.readValue).toBe("prop");
});

test("object getters are observable", () => {
	class C {
		state = observable({ value: "prop" });

		get readValue() {
			return this.state.value;
		}
	}

	const o = new C();
	let count = 0;

	effect(() => {
		o.readValue;
		count++;
	});

	o.state.value = "newProp";
	expect(count).toBe(2);
});

test("can have properties that are Promise", async () => {
	class C {
		value = Promise.resolve(42);
	}

	const o = new C();
	const v = await o.value;
	expect(v).toBe(42);
});

test("instanceof operator works", () => {
	class C {
		state = observable({ value: 0 });
	}
	const c = new C();
	expect(c).toBeInstanceOf(C);
});

// observable() creates shallow reactive containers - values NOT wrapped
describe("observable (shallow by default)", () => {
	test("observable container is reactive", () => {
		class C {
			items = observable<{ value: number }[]>([]);
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

	test("observable does not make pushed items observable", () => {
		class C {
			items = observable<{ value: number }[]>([]);
		}

		const c = new C();
		c.items.push({ value: 1 });

		// Items are NOT wrapped (shallow behavior)
		expect(isObservable(c.items[0])).toBe(false);
	});

	test("observable does not make nested object properties observable", () => {
		const state = observable({ nested: { value: 1 } });

		let count = 0;

		effect(() => {
			state.nested.value;
			count++;
		});

		// Changing nested value should NOT trigger effect (shallow)
		state.nested.value = 2;
		expect(count).toBe(1);

		// But changing the property itself SHOULD trigger
		state.nested = { value: 3 };
		expect(count).toBe(2);
	});

	test("observable container tracks array mutations", () => {
		class C {
			items = observable<number[]>([]);
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

	test("observable works with Map", () => {
		class C {
			map = observable(new Map<string, { value: number }>());
		}

		const c = new C();
		let count = 0;

		effect(() => {
			c.map.size;
			count++;
		});

		c.map.set("a", { value: 1 });
		expect(count).toBe(2);

		// Map values are NOT wrapped (shallow behavior)
		expect(isObservable(c.map.get("a"))).toBe(false);
	});

	test("observable allows structuredClone of values", () => {
		class C {
			items = observable<{ value: number }[]>([]);
		}

		const c = new C();
		c.items.push({ value: 1 });

		// Should NOT throw - values are plain objects
		expect(() => structuredClone(c.items[0])).not.toThrow();
	});
});

// Plain class properties - assignment works, no mutation tracking without observable()
describe("plain properties (no observable wrapper)", () => {
	test("plain property assignment doesn't trigger effects without observable", () => {
		class C {
			items: number[] = [];
		}

		const c = new C();
		let count = 0;

		effect(() => {
			c.items;
			count++;
		});

		// Without observable(), changes don't trigger
		c.items = [1, 2, 3];
		expect(count).toBe(1); // Only initial run

		c.items.push(1);
		expect(count).toBe(1); // Still no trigger
	});

	test("plain object value is NOT observable", () => {
		class C {
			data = { value: 1 };
		}

		const c = new C();

		expect(isObservable(c.data)).toBe(false);
	});

	test("plain objects allow structuredClone", () => {
		class C {
			data = { value: 1 };
		}

		const c = new C();

		expect(() => structuredClone(c.data)).not.toThrow();
	});
});

// Making instance itself observable via constructor pattern
describe("observable class instance (constructor pattern)", () => {
	test("observable(this) in constructor returns raw instance (no longer supported for arbitrary classes)", () => {
		class C {
			state = observable({ value: 0 });

			constructor() {
				return observable(this);
			}
		}

		const c = new C();
		expect(isObservable(c)).toBe(false);

		let count = 0;
		effect(() => {
			c.state.value;
			count++;
		});

		c.state.value = 1;
		expect(count).toBe(2);
	});

	test("plain instance property reassignment NO LONGER triggers effects without extends Observable", () => {
		class C {
			data = { count: 0 };

			constructor() {
				return observable(this);
			}
		}

		const c = new C();
		let count = 0;

		effect(() => {
			c.data;
			count++;
		});

		// Reassigning the property should NOT trigger effect
		c.data = { count: 1 };
		expect(count).toBe(1);
	});

	test("observable instance new property NO LONGER triggers effects without extends Observable", () => {
		class C {
			constructor() {
				return observable(this);
			}
		}

		const c = new C() as any;
		let count = 0;

		effect(() => {
			c.newProp;
			count++;
		});

		// Adding new property should NOT trigger effect
		c.newProp = "hello";
		expect(count).toBe(1);
	});
});
