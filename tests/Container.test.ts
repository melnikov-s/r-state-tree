import {
	Model,
	Store,
	mount,
	createStore,
	reaction,
	effect,
	observable,
	computed,
} from "../src/index";

export function createContainer<
	T extends new (...args: unknown[]) => InstanceType<T>
>(Container: T): InstanceType<T> {
	if (Model.isPrototypeOf(Container)) {
		return (Container as unknown as typeof Model).create() as InstanceType<T>;
	}

	return mount(createStore(Container as any)) as any;
}

[Model, Store].forEach((c) => {
	const Container = c as typeof Model; // for typing purposes

	describe(`(${Container.name}) state equality tests`, () => {
		test("objects", () => {
			const obj = { prop: "value" };

			class C extends Container {
				_stateA = observable({ value: null as any });
				_stateB = observable({ value: null as any });

				get stateA() {
					return this._stateA.value;
				}
				set stateA(v) {
					this._stateA.value = v;
				}

				get stateB() {
					return this._stateB.value;
				}
				set stateB(v) {
					this._stateB.value = v;
				}

				setA(obj) {
					this.stateA = obj;
				}

				setB(obj) {
					this.stateB = obj;
				}

				modObj(prop, value) {
					this.stateA[prop] = value;
				}
			}

			const c = createContainer(C);
			c.setA(obj);
			c.setB(obj);

			// With shallow behavior, plain objects are NOT wrapped - same reference
			expect(c.stateA).toBe(obj);
			expect(c.stateB).toBe(obj);
			expect(c.stateB).toBe(c.stateA);
			c.modObj("anotherProp", "anotherValue");
			expect(c.stateB).toBe(c.stateA);
			expect(obj).toEqual({ prop: "value", anotherProp: "anotherValue" });
		});

		test("arrays", () => {
			const array = [0];

			class C extends Container {
				_stateA = observable({ value: [] as any[] });
				get stateA() {
					return this._stateA.value;
				}
				set stateA(v) {
					this._stateA.value = v;
				}

				_stateB = observable({ value: [] as any[] });
				get stateB() {
					return this._stateB.value;
				}
				set stateB(v) {
					this._stateB.value = v;
				}

				setA(array) {
					this.stateA = array;
				}

				setB(array) {
					this.stateB = array;
				}

				modArray(index, value) {
					this.stateA[index] = value;
				}
			}

			const c = createContainer(C);
			c.setA(array);
			c.setB(array);

			expect(c.stateA).toBe(array);
			expect(c.stateA).toEqual(array);
			expect(c.stateB).toBe(c.stateA);
			c.modArray(0, 1); // Changed to match new modArray signature
			expect(c.stateB).toBe(c.stateA);
			expect(array).toEqual([1]); // Changed expected value due to modArray change
		});

		test("maps", () => {
			const map = new Map([["prop", "value"]]);

			class C extends Container {
				_stateA = observable({ value: new Map() });
				get stateA() {
					return this._stateA.value;
				}
				set stateA(v) {
					this._stateA.value = v;
				}

				_stateB = observable({ value: new Map() });
				get stateB() {
					return this._stateB.value;
				}
				set stateB(v) {
					this._stateB.value = v;
				}

				setA(map) {
					this.stateA = map;
				}

				setB(map) {
					this.stateB = map;
				}

				modMap(key, value) {
					this.stateA.set(key, value);
				}
			}

			const c = createContainer(C);
			c.setA(map);
			c.setB(map);

			expect(c.stateA).toBe(map);
			expect(Array.from(c.stateA.entries())).toEqual(Array.from(map.entries()));
			expect(c.stateB).toBe(c.stateA);
			c.modMap("anotherProp", "anotherValue");
			expect(c.stateB).toBe(c.stateA);
			expect(Array.from(map.entries())).toEqual([
				["prop", "value"],
				["anotherProp", "anotherValue"],
			]);
		});

		test("sets", () => {
			const set = new Set([0]);

			class C extends Container {
				_stateA = observable({ value: new Set() });
				get stateA() {
					return this._stateA.value;
				}
				set stateA(v) {
					this._stateA.value = v;
				}

				_stateB = observable({ value: new Set() });
				get stateB() {
					return this._stateB.value;
				}
				set stateB(v) {
					this._stateB.value = v;
				}

				setA(set) {
					this.stateA = set;
				}

				setB(set) {
					this.stateB = set;
				}

				modSet(value) {
					this.stateA.add(value);
				}
			}

			const c = createContainer(C);
			c.setA(set);
			c.setB(set);

			expect(c.stateA).toBe(set);
			expect(Array.from(c.stateA)).toEqual(Array.from(set));
			expect(c.stateB).toBe(c.stateA);
			c.modSet(1);
			expect(c.stateB).toBe(c.stateA);
			expect(Array.from(set)).toEqual([0, 1]);
		});
	});

	test(`(${Container.name}) has reactive state properties`, () => {
		let count = 0;

		class M extends Container {
			_state = observable({ value: 0 });
			get state() {
				return this._state.value;
			}
			set state(v) {
				this._state.value = v;
			}

			incState() {
				this.state++;
			}
		}

		const m = createContainer(M);
		reaction(
			() => m.state,
			() => count++
		);
		expect(count).toBe(0);
		m.incState();
		expect(count).toBe(1);
	});

	test(`(${Container.name}) has reactive computed properties`, () => {
		let count = 0;

		class M extends Container {
			_state = observable({ value: 0 });
			get state() {
				return this._state.value;
			}
			set state(v) {
				this._state.value = v;
			}

			incState() {
				this.state++;
			}

			@computed get twiceState() {
				return this.state * 2;
			}
		}

		const m = createContainer(M);
		reaction(
			() => m.twiceState,
			() => count++
		);
		expect(m.twiceState).toBe(0);
		expect(count).toBe(0);
		m.incState();
		expect(count).toBe(1);
		expect(m.twiceState).toBe(2);
	});

	test(`(${Container.name}) plain fields are reactive even when decorators are present`, () => {
		let count = 0;

		class C extends Container {
			value = 0; // NOT decorated

			// Force Symbol.metadata to exist on the class
			@computed get doubled() {
				return this.value * 2;
			}

			inc() {
				this.value++;
			}
		}

		const c = createContainer(C);

		reaction(
			() => c.value,
			() => count++
		);

		expect(count).toBe(0);
		c.inc();
		expect(count).toBe(1);
	});

	test(`(${Container.name}) computed values update when they depend on plain fields`, () => {
		let count = 0;

		class C extends Container {
			value = 0; // NOT decorated

			@computed get doubled() {
				return this.value * 2;
			}

			inc() {
				this.value++;
			}
		}

		const c = createContainer(C);

		reaction(
			() => c.doubled,
			() => count++
		);

		expect(c.doubled).toBe(0);
		expect(count).toBe(0);
		c.inc();
		expect(c.doubled).toBe(2);
		expect(count).toBe(1);
	});

	test(`(${Container.name}) supports async actions`, async () => {
		const result = {};

		class S extends Container {
			value = 0;

			result = null;

			async inc() {
				this.value++;
				this.result = await new Promise((resolve) =>
					setTimeout(() => resolve(result), 0)
				);

				this.value++;
				return this.value;
			}
		}

		const s = createContainer(S);
		expect(s.value).toBe(0);
		effect(() => s.value);
		const w = s.inc();
		expect(s.value).toBe(1);
		expect(s.result).toBe(null);
		expect(await w).toBe(2);
		expect(s.result).toEqual(result);
	});
});
