import { effect, reaction, observable, source } from "../src";

function object<T extends object>(obj: T = {} as T): Record<string, any> {
	return observable(obj);
}

describe("Proxy trap invariants", () => {
	test("wrapped proxies receive the observable as the write receiver", () => {
		let receiverSeen: unknown;
		const target = new Proxy(
			{ value: 0 },
			{
				set(target, key, value, receiver) {
					receiverSeen = receiver;
					return Reflect.set(target, key, value, receiver);
				},
			}
		);
		const state = observable(target);
		state.value = 1;
		expect(receiverSeen).toBe(state);
		expect(state.value).toBe(1);
	});

	test("Non-extensible object set should fail", () => {
		const o = observable({} as any);
		Object.preventExtensions(source(o));

		// Assignment should return false or throw in strict mode
		// Vitest tests run in strict mode (ESM), so this should throw
		expect(() => {
			o.x = 1;
		}).toThrow(TypeError);

		expect(Reflect.set(o, "y", 2)).toBe(false);
		expect("y" in o).toBe(false);
	});

	test("Sealed object delete should fail", () => {
		const o = observable({ x: 1 } as any);
		Object.seal(source(o));

		// Deletion should return false or throw
		expect(() => {
			delete o.x;
		}).toThrow(TypeError);

		expect(Reflect.deleteProperty(o, "x")).toBe(false);
		expect("x" in o).toBe(true);
	});

	test("Non-writable property set should fail", () => {
		const target = {};
		Object.defineProperty(target, "x", {
			value: 1,
			writable: false,
			configurable: true,
		});
		const o = observable(target as any);

		expect(() => {
			o.x = 2;
		}).toThrow(TypeError);

		expect(o.x).toBe(1);
	});

	test("Change notifications only happen if mutation succeeds", () => {
		const o = observable({ x: 1 } as any);
		Object.preventExtensions(source(o));

		let count = 0;
		effect(() => {
			o.y;
			count++;
		});

		expect(count).toBe(1);

		// This should fail to set 'y'
		try {
			o.y = 2;
		} catch (e) {}

		// Should NOT increment because 'y' was never successfully added
		expect(count).toBe(1);
	});
});

describe("Setter-only accessors on plain objects", () => {
	test("reading a setter-only accessor returns undefined and does not throw", () => {
		const obj = {};
		let _setterValue: any;
		Object.defineProperty(obj, "prop", {
			set(v) {
				_setterValue = v;
			},
			configurable: true,
			enumerable: true,
		});

		const o = observable(obj) as any;
		expect(() => o.prop).not.toThrow();
		expect(o.prop).toBe(undefined);
		void _setterValue;
	});

	test("writing to a setter-only accessor invokes the setter and does not throw", () => {
		const obj = {};
		let setterValue: any;
		Object.defineProperty(obj, "prop", {
			set(v) {
				setterValue = v;
			},
			configurable: true,
			enumerable: true,
		});

		const o = observable(obj) as any;
		expect(() => {
			o.prop = "value";
		}).not.toThrow();
		expect(setterValue).toBe("value");
	});
});

describe("Proxy Correctness", () => {
	describe("Receiver Semantics", () => {
		test("should correctly handle receiver in prototype chains (get)", () => {
			const proto = object({ x: 1 });
			const child = Object.create(proto);

			expect(child.x).toBe(1);
			expect(Reflect.get(proto, "x", child)).toBe(1);
		});

		test("should correctly handle receiver in prototype chains (set)", () => {
			const proto = object({ x: 1 });
			const child = Object.create(proto);

			// Should define own property on child, not mutate proto
			child.x = 2;
			expect(child.x).toBe(2);
			expect(proto.x).toBe(1);
			expect(Object.hasOwnProperty.call(child, "x")).toBe(true);
		});

		test("should trigger reactivity on proto when child reads inherited property", () => {
			const proto = object({ x: 1 });
			const child = Object.create(proto);
			const spy = vi.fn();

			effect(() => {
				spy(child.x);
			});

			expect(spy).toHaveBeenCalledWith(1);
			proto.x = 2;
			expect(spy).toHaveBeenCalledWith(2);
		});
	});

	describe("defineProperty Reactivity", () => {
		test("should trigger reactivity when Object.defineProperty is used", () => {
			const obj = object({ x: 1 });
			const spy = vi.fn();

			effect(() => {
				spy(Object.keys(obj));
			});

			expect(spy).toHaveBeenLastCalledWith(["x"]);

			// Add a new property via defineProperty
			Object.defineProperty(obj, "y", {
				value: 2,
				enumerable: true,
				configurable: true,
				writable: true,
			});

			expect(obj.y).toBe(2);
			expect(spy).toHaveBeenLastCalledWith(["x", "y"]);
		});

		test("should track value changes made via defineProperty", () => {
			const obj = object({ x: 1 });
			const spy = vi.fn();

			reaction(
				() => {
					spy(obj.x);
				},
				() => {}
			);

			expect(spy).toHaveBeenLastCalledWith(1);

			Object.defineProperty(obj, "x", { value: 100 });

			expect(obj.x).toBe(100);
			expect(spy).toHaveBeenLastCalledWith(100);
		});
	});

	describe("Proxy Invariants", () => {
		test("should respect non-configurable non-writable data properties", () => {
			const target: any = {};
			Object.defineProperty(target, "fixed", {
				value: { nested: 1 },
				writable: false,
				configurable: false,
			});

			const proxy = object(target);

			// Invariant: If a property is non-configurable and non-writable,
			// the proxy MUST return the exact same value as the target.
			// It cannot return a proxy wrapper.
			expect(proxy.fixed).toBe(target.fixed);
			expect(proxy.fixed).toEqual({ nested: 1 });
		});
	});

	describe("Object.prototype Keys", () => {
		test("should be reactive if they are own properties", () => {
			const obj = object({ toString: "custom" });
			const spy = vi.fn();

			reaction(
				() => {
					const v = (obj as any).toString;
					spy(typeof v === "function" ? v.call(obj) : v);
				},
				() => {}
			);

			expect(spy).toHaveBeenLastCalledWith("custom");

			obj.toString = () => "updated";
			expect(spy).toHaveBeenLastCalledWith("updated");
		});

		test("should handle hasOwnProperty masking", () => {
			const obj = object({
				hasOwnProperty: () => "fake",
			});

			expect(obj.hasOwnProperty("anything")).toBe("fake");

			// Should properly track it
			const spy = vi.fn();
			effect(() => spy((obj as any).hasOwnProperty("x")));
			expect(spy).toHaveBeenCalledWith("fake");

			(obj as any).hasOwnProperty = () => "updated";
			expect(spy).toHaveBeenCalledWith("updated");
		});
	});

	describe("Prototype getter receiver semantics", () => {
		test("prototype getters use correct receiver", () => {
			const proto = object({
				get x() {
					return (this as any).y;
				},
			});
			const child = Object.create(proto) as any;
			child.y = 2;
			expect(child.x).toBe(2);
		});

		test("Reflect.get uses correct receiver", () => {
			const proto = object({
				get x() {
					return (this as any).y;
				},
			});
			const child = { y: 2 };
			expect(Reflect.get(proto, "x", child)).toBe(2);
		});
	});
});

describe("Regression Tests", () => {
	test("plain object getter is NOT auto-computed (no memoization)", () => {
		let runs = 0;
		const o = observable({
			x: 1,
			get g() {
				runs++;
				return this.x * 2;
			},
		}) as any;
		// Not memoized: repeated reads re-run getter
		expect(o.g).toBe(2);
		expect(o.g).toBe(2);
		expect(runs).toBe(2);
	});

	test("prototype setters, non-writable inherited data fields, and dynamic function fields keep proxy write semantics", () => {
		let setterThis: unknown;
		const proto = {};
		Object.defineProperty(proto, "inheritedSetter", {
			set(v: number) {
				setterThis = this;
				(this as any).a = v;
				(this as any).b = v * 2;
			},
			configurable: true,
		});
		Object.defineProperty(proto, "readonlyProto", {
			value: 1,
			writable: false,
			configurable: true,
		});

		const obj = observable({ a: 0, b: 0 } as any);
		Object.setPrototypeOf(obj, proto);

		const seen: [number, number][] = [];
		const stop = effect(() => {
			seen.push([obj.a, obj.b]);
		});
		try {
			obj.inheritedSetter = 5;
			expect(setterThis).toBe(obj);
			// Setter writes ran inside a single batch (or with proxy receiver).
			expect(seen.at(-1)).toEqual([5, 10]);

			expect(Reflect.set(obj, "readonlyProto", 2)).toBe(false);
			expect(obj.readonlyProto).toBe(1);

			// Dynamic function property is cached as an action, then reclassified on data write.
			obj.mutate = function (this: any) {
				this.a = 7;
				this.b = 14;
			};
			const countBeforeMutate = seen.length;
			obj.mutate();
			expect(seen.length).toBe(countBeforeMutate + 1);
			expect(seen.at(-1)).toEqual([7, 14]);
			obj.mutate = 42;
			expect(obj.mutate).toBe(42);
		} finally {
			stop();
		}
	});
});
