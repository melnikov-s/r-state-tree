import {
	observable,
	action,
	computed,
	Model,
	Store,
	mount,
	autorun,
	reaction,
	createStore,
} from "../src/index";

export function createContainer<
	T extends new (...args: unknown[]) => InstanceType<T>
>(Container: T): InstanceType<T> {
	if (Model.isPrototypeOf(Container)) {
		return ((Container as unknown) as typeof Model).create() as InstanceType<T>;
	}

	return mount(createStore(Container));
}

[Model, Store].forEach((c) => {
	const Container = c as typeof Model; // for typing purposes

	describe(`(${Container.name}) state equality tests`, () => {
		test("objects", () => {
			const obj = { prop: "value" };

			class C extends Container {
				@observable stateA = null;
				@observable stateB = null;

				@action setA(obj) {
					this.stateA = obj;
				}

				@action setB(obj) {
					this.stateB = obj;
				}

				@action modObj(prop, value) {
					this.stateA[prop] = value;
				}
			}

			const c = createContainer(C);
			c.setA(obj);
			c.setB(obj);

			expect(c.stateA).not.toBe(obj);
			expect(c.stateA).toEqual(obj);
			expect(c.stateB).toBe(c.stateA);
			c.modObj("anotherProp", "anotherValue");
			expect(c.stateB).toBe(c.stateA);
			expect(obj).toEqual({ prop: "value", anotherProp: "anotherValue" });
		});

		test("arrays", () => {
			const array = [0];

			class C extends Container {
				@observable stateA = null;
				@observable stateB = null;

				@action setA(array) {
					this.stateA = array;
				}

				@action setB(array) {
					this.stateB = array;
				}

				@action modArray(value) {
					this.stateA.push(value);
				}
			}

			const c = createContainer(C);
			c.setA(array);
			c.setB(array);

			expect(c.stateA).not.toBe(array);
			expect(c.stateA).toEqual(array);
			expect(c.stateB).toBe(c.stateA);
			c.modArray(1);
			expect(c.stateB).toBe(c.stateA);
			expect(array).toEqual([0, 1]);
		});

		test("maps", () => {
			const map = new Map([["prop", "value"]]);

			class C extends Container {
				@observable stateA = null;
				@observable stateB = null;

				@action setA(map) {
					this.stateA = map;
				}

				@action setB(map) {
					this.stateB = map;
				}

				@action modMap(prop, value) {
					this.stateA.set(prop, value);
				}
			}

			const c = createContainer(C);
			c.setA(map);
			c.setB(map);

			expect(c.stateA).not.toBe(map);
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
				@observable stateA = null;
				@observable stateB = null;

				@action setA(set) {
					this.stateA = set;
				}

				@action setB(map) {
					this.stateB = map;
				}

				@action modSet(value) {
					this.stateA.add(value);
				}
			}

			const c = createContainer(C);
			c.setA(set);
			c.setB(set);

			expect(c.stateA).not.toBe(set);
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
			@observable state = 0;

			@action incState() {
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
			@observable state = 0;

			@action incState() {
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

	test(`(${Container.name}) state can't be mutated directly`, () => {
		class M extends Container {
			@observable state = 0;
		}

		const m = createContainer(M);
		autorun(() => m.state);
		expect(() => m.state++).toThrow();
	});

	test(`(${Container.name}) supports async actions`, async () => {
		const result = {};

		class S extends Container {
			@observable
			value = 0;

			@observable({ ref: true })
			result = null;

			@action async inc() {
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
		const w = s.inc();
		expect(s.value).toBe(1);
		expect(s.result).toBe(null);
		expect(await w).toBe(2);
		expect(s.result).toBe(result);
	});
});
