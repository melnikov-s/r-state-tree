import {
	Store,
	child,
	createStore,
	mount,
	effect,
	observable,
	computed,
} from "../src/index";

test("can create a child store", () => {
	class S extends Store<any> {
		@child
		get c() {
			return createStore(C, { prop: 0 });
		}
	}
	class C extends Store<any> {}

	const s = mount(createStore(S));

	expect(s.c).toBeInstanceOf(C);
	expect(s.c.props.prop).toBe(0);
});

test("child store can be null", () => {
	class S extends Store<any> {
		state = observable({ mounted: true });
		get mounted() {
			return this.state.mounted;
		}
		set mounted(v) {
			this.state.mounted = v;
		}

		@child
		get c() {
			return this.mounted ? createStore(C, { prop: 0 }) : null;
		}

		unmountChild() {
			this.mounted = false;
		}
	}
	class C extends Store<any> {}
	const s = mount(createStore(S));
	expect(s.c).toBeInstanceOf(C);
	s.unmountChild();
	expect(s.c).toBe(null);
});

test("can create an array of child stores", () => {
	class S extends Store<any> {
		@child
		get cs() {
			return types.map((Type, i) => createStore(Type, { prop: i }));
		}
	}
	class C extends Store<any> {}
	class C1 extends Store<any> {}
	class C2 extends Store<any> {}

	const types = [C, C1, C2];

	const s = mount(createStore(S));
	expect(Array.isArray(s.cs));
	s.cs.forEach((c, i) => {
		expect(c).toBeInstanceOf(types[i]);
		expect(c.props.prop).toBe(i);
	});
});

test("updates an array of stores", () => {
	class S extends Store<any> {
		state = observable({ value: 0 });
		get value() {
			return this.state.value;
		}
		set value(v) {
			this.state.value = v;
		}

		inc() {
			this.state.value++;
		}

		@child
		get cs() {
			return types.map((Type, i) =>
				createStore(Type, { prop: this.value + i })
			);
		}
	}
	class C extends Store<any> {}
	class C1 extends Store<any> {}
	class C2 extends Store<any> {}

	const types = [C, C1, C2];

	const s = mount(createStore(S));
	const equals = (v: any) =>
		expect(s.cs.map((c: any) => c.props.prop)).toEqual(v);
	equals([0, 1, 2]);
	s.inc();
	equals([1, 2, 3]);
	s.inc();
	equals([2, 3, 4]);
});

test("child stores are reactive", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		values = observable([] as any[]);
		add() {
			this.values.push(this.values.length);
		}
		@child get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	effect(() => {
		s.c.length;
		count++;
	});

	s.add();
	expect(count).toBe(2);
	s.add();
	expect(count).toBe(3);
});

test("child store can be retrieved during an action", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		state = observable({ value: false });
		get value() {
			return this.state.value;
		}
		set value(v) {
			this.state.value = v;
		}
		add() {
			count++;
			this.value = true;
			expect(this.c).toBeInstanceOf(C);
		}
		@child get c() {
			return this.value ? createStore(C, { value: this.value }) : null;
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	effect(() => {
		s.c;
	});

	s.add();
	expect(count).toBe(1);
});

test("children stores can be retrieved during an action", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		values = observable([] as any[]);
		add() {
			count++;
			this.values.push(this.values.length);
			expect(this.c.length).toBe(this.values.length);
		}
		@child get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	effect(() => {
		s.c.length;
	});

	s.add();
	expect(count).toBe(1);
});

test("child stores do not trigger listeners when only props change", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		state = observable({ values: [1, 2] });
		get values() {
			return this.state.values;
		}
		set values(v) {
			this.state.values = v;
		}

		changeValues() {
			this.state.values = this.state.values.map((v) => v + 1);
		}
		@child get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	effect(() => {
		s.c.length;
		count++;
	});

	expect(s.c.map((c) => c.value)).toEqual([1, 2]);
	s.changeValues();
	expect(count).toBe(1);
	expect(s.c.map((c) => c.value)).toEqual([2, 3]);
});

test("child stores are reactive", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		values = observable([] as any[]);
		add() {
			this.values.push(this.values.length);
		}
		@child get c() {
			return this.values.map((value) => createStore(C, { value }));
		}
	}

	let count = 0;
	const s = mount(createStore(S));

	effect(() => {
		s.c.length;
		count++;
	});

	s.add();
	expect(count).toBe(2);
	s.add();
	expect(count).toBe(3);
});

test("child stores with keys", () => {
	class C extends Store<any> {
		@computed get value() {
			return this.props.value;
		}
	}
	class S extends Store<any> {
		keys = observable([1, 2, 3]);
		@child get cs() {
			return this.keys.map((value) => createStore(C, { value, key: value }));
		}
		reverse() {
			this.keys.reverse();
		}
	}

	const s = mount(createStore(S));
	const stores = s.cs.slice();
	expect(stores.length).toBe(3);
	let count = 0;
	effect(() => {
		count++;
		s.cs;
	});
	expect(count).toBe(1);
	s.reverse();
	expect(count).toBe(2);
	expect(stores[0]).toBe(s.cs[2]);
	expect(stores[1]).toBe(s.cs[1]);
	expect(stores[2]).toBe(s.cs[0]);
});

describe("child store duplicate keys", () => {
	test("throws before initially materializing duplicate keyed children", () => {
		let created = 0;
		class FirstChild extends Store<any> {
			constructor(props: any) {
				super(props);
				created++;
			}
		}
		class SecondChild extends Store<any> {
			constructor(props: any) {
				super(props);
				created++;
			}
		}
		class ParentStore extends Store<any> {
			@child get chapters() {
				return [
					createStore(FirstChild, { key: "chapter-1" }),
					createStore(SecondChild, { key: "chapter-1" }),
				];
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(() => parent.chapters).toThrowError(
			'r-state-tree: duplicate key "chapter-1" in child property "chapters" of ParentStore'
		);
		expect(created).toBe(0);
	});

	test("throws before mutating the existing tree during reactive reconciliation", () => {
		class ItemStore extends Store<any> {}
		class ParentStore extends Store<any> {
			items = observable([
				{ key: "first", value: 1 },
				{ key: "second", value: 2 },
			]);

			@child get children() {
				return this.items.map(({ key, value }) =>
					createStore(ItemStore, { key, value })
				);
			}
		}

		const parent = mount(createStore(ParentStore));
		const originalChildren = parent.children.slice();

		expect(() => {
			parent.items = observable([
				{ key: "first", value: 10 },
				{ key: "first", value: 20 },
			]);
			parent.children;
		}).toThrowError(/duplicate key "first"/);

		expect(originalChildren.map((item) => item.props.value)).toEqual([1, 2]);
		parent.items = observable([
			{ key: "second", value: 3 },
			{ key: "first", value: 4 },
		]);
		expect(parent.children).toEqual([originalChildren[1], originalChildren[0]]);
		expect(parent.children.map((item) => item.props.value)).toEqual([3, 4]);
	});

	test("allows unkeyed and null entries and distinguishes numeric keys", () => {
		class ItemStore extends Store<any> {}
		class ParentStore extends Store<any> {
			@child get children() {
				return [
					createStore(ItemStore),
					null,
					createStore(ItemStore),
					createStore(ItemStore, { key: 1 }),
					createStore(ItemStore, { key: "1" }),
				];
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.children).toHaveLength(4);
	});

	test("scopes duplicate validation to each child property", () => {
		class ItemStore extends Store<any> {}
		class ParentStore extends Store<any> {
			@child get first() {
				return [createStore(ItemStore, { key: "shared" })];
			}

			@child get second() {
				return [createStore(ItemStore, { key: "shared" })];
			}
		}

		const parent = mount(createStore(ParentStore));
		expect(parent.first).toHaveLength(1);
		expect(parent.second).toHaveLength(1);
	});
});

describe("child type validation", () => {
	test("rejects non-StoreElement values for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get c() {
				return "invalid" as unknown as ReturnType<typeof createStore<C>>;
			}
		}

		const s = mount(createStore(S));
		expect(() => {
			s.c;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'c' must be a StoreElement ({ Type, props, key }), an array of StoreElements, or null/undefined. Found: string]`
		);
	});

	test("rejects invalid StoreElement objects", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get c() {
				return { Type: "not a function" } as unknown as ReturnType<
					typeof createStore<C>
				>;
			}
		}

		const s = mount(createStore(S));
		expect(() => {
			s.c;
		}).toThrow();
	});

	test("allows null for child property", () => {
		class S extends Store<any> {
			@child get c() {
				return null;
			}
		}

		const s = mount(createStore(S));
		expect(s.c).toBe(null);
	});

	test("allows undefined for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get c() {
				return undefined as unknown as ReturnType<typeof createStore<C>> | null;
			}
		}

		const s = mount(createStore(S));
		expect(s.c).toBe(null);
	});

	test("allows valid StoreElement for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get c() {
				return createStore(C, { prop: 1 });
			}
		}

		const s = mount(createStore(S));
		expect(s.c).toBeInstanceOf(C);
		expect(s.c!.props.prop).toBe(1);
	});

	test("rejects array with non-StoreElement items for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get cs() {
				return ["invalid", "values"] as unknown as ReturnType<
					typeof createStore<C>
				>[];
			}
		}

		const s = mount(createStore(S));
		expect(() => {
			s.cs;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'cs' must be a StoreElement ({ Type, props, key }), an array of StoreElements, or null/undefined. Found invalid array item: string]`
		);
	});

	test("rejects array with invalid StoreElement objects", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get cs() {
				return [
					createStore(C, { prop: 1 }),
					{ Type: "not a function" },
				] as unknown as ReturnType<typeof createStore<C>>[];
			}
		}

		const s = mount(createStore(S));
		expect(() => {
			s.cs;
		}).toThrow();
	});

	test("allows array of StoreElements for child property", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			@child get cs() {
				return [createStore(C, { prop: 1 }), createStore(C, { prop: 2 })];
			}
		}

		const s = mount(createStore(S));
		expect(Array.isArray(s.cs)).toBe(true);
		expect(s.cs!.length).toBe(2);
		expect(s.cs![0]).toBeInstanceOf(C);
		expect(s.cs![1]).toBeInstanceOf(C);
	});

	test("allows empty array for child property", () => {
		class S extends Store<any> {
			@child get cs() {
				return [];
			}
		}

		const s = mount(createStore(S));
		expect(Array.isArray(s.cs)).toBe(true);
		expect(s.cs!.length).toBe(0);
	});

	test("validates child property when it changes reactively", () => {
		class C extends Store<any> {}
		class S extends Store<any> {
			state = observable({ shouldReturnInvalid: false });
			get shouldReturnInvalid() {
				return this.state.shouldReturnInvalid;
			}
			set shouldReturnInvalid(v) {
				this.state.shouldReturnInvalid = v;
			}

			@child get c() {
				if (this.state.shouldReturnInvalid) {
					return "invalid" as unknown as ReturnType<typeof createStore<C>>;
				}
				return createStore(C, { prop: 1 });
			}
		}

		const s = mount(createStore(S));
		expect(s.c).toBeInstanceOf(C);

		expect(() => {
			s.shouldReturnInvalid = true;
			s.c;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'c' must be a StoreElement ({ Type, props, key }), an array of StoreElements, or null/undefined. Found: string]`
		);
	});
});
