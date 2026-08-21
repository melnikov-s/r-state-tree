import {
	Model,
	id,
	modelRef,
	child,
	transient,
	toSnapshot,
	applySnapshot,
	onSnapshot,
	onSnapshotDiff,
	computed,
	effect,
	reaction,
	isObservable,
	observable,
	signal,
	findModelById,
} from "../src/index";

test("can create a model", () => {
	class M extends Model {}

	const model = M.create();

	expect(model instanceof Model).toBe(true);
});

test("ordinary Model fields are snapshotted and transient fields are excluded", () => {
	class M extends Model {
		title = "saved";
		@transient cache = observable(new Map<string, number>());
	}

	const model = M.create();
	model.cache.set("runtime", 1);

	expect(toSnapshot(model)).toEqual({ title: "saved" });
});

test("unsupported implicit Model fields fail during creation", () => {
	class M extends Model {
		cache = new Map<string, number>();
	}

	expect(() => M.create()).toThrow(
		/snapshots do not support Map.*cache.*Mark runtime-only Model fields with @transient/
	);
});

test("parent reactions observe detach and reattach transitions", () => {
	const transitions: Array<[Model | null, Model | null]> = [];

	class Item extends Model {}

	class Parent extends Model {
		@child item: Item | null = null;
	}

	const item = Item.create();
	const stop = reaction(
		() => item.parent,
		(next, previous) => transitions.push([next, previous])
	);
	const first = Parent.create();
	const second = Parent.create();
	first.item = item;
	first.item = null;
	second.item = item;

	expect(transitions).toEqual([
		[first, null],
		[null, first],
		[second, null],
	]);
	expect(() => item[Symbol.dispose]()).toThrow(/attached child/);
	second[Symbol.dispose]();
	expect(() => {
		first.item = item;
	}).toThrow(/disposed model/);
	stop();
});

test("named factories can prepare input before creating a model", () => {
	class Item extends Model {
		@id id?: number;
		title = "";

		static fromTitle(title = "new") {
			return this.create({ id: 1, title: title.trim() });
		}
	}

	const item = Item.fromTitle("  hello  ");
	expect({ id: item.id, title: item.title }).toEqual({ id: 1, title: "hello" });
	expect(Item.fromTitle().title).toBe("new");
});

test("root snapshots stay fresh when nested child model updates an observable state array", () => {
	class Chat extends Model {
		messages: { id: number; parts: { type: string }[] }[] = observable([]);

		setMessages(ids: number[]) {
			this.messages.splice(
				0,
				this.messages.length,
				...ids.map((id) => ({ id, parts: [{ type: "text" }] }))
			);
		}
	}

	class Threads extends Model {
		@child(Chat) chats: Chat[] = [Chat.create()];
		activeChatId = "";
	}

	class Root extends Model {
		@child(Threads) conceptChats: Threads = Threads.create();
	}

	const root = Root.create();
	const chat = root.conceptChats.chats[0];
	const snapshots: any[] = [];
	const off = onSnapshot(root, (snapshot) => snapshots.push(snapshot));

	expect(toSnapshot(root)).toStrictEqual({
		conceptChats: { chats: [{ messages: [] }], activeChatId: "" },
	});

	chat.setMessages([1, 2]);

	expect(toSnapshot(chat)).toStrictEqual({
		messages: [
			{ id: 1, parts: [{ type: "text" }] },
			{ id: 2, parts: [{ type: "text" }] },
		],
	});
	expect(toSnapshot(root)).toStrictEqual({
		conceptChats: {
			chats: [
				{
					messages: [
						{ id: 1, parts: [{ type: "text" }] },
						{ id: 2, parts: [{ type: "text" }] },
					],
				},
			],
			activeChatId: "",
		},
	});
	expect(snapshots).toStrictEqual([
		{
			conceptChats: {
				chats: [
					{
						messages: [
							{ id: 1, parts: [{ type: "text" }] },
							{ id: 2, parts: [{ type: "text" }] },
						],
					},
				],
				activeChatId: "",
			},
		},
	]);

	off();
});

test("root snapshots stay fresh after adding a child model and then mutating its observable state array", () => {
	class Chat extends Model {
		id = "";
		messages: { id: number; parts: { type: string }[] }[] = observable([]);

		setMessages(ids: number[]) {
			this.messages.splice(
				0,
				this.messages.length,
				...ids.map((id) => ({ id, parts: [{ type: "text" }] }))
			);
		}
	}

	class Threads extends Model {
		@child(Chat) chats: Chat[] = [];
		activeChatId = "";

		addChat(chat: Chat) {
			this.chats.push(chat);
			this.activeChatId = chat.id;
		}
	}

	class Root extends Model {
		@child(Threads) conceptChats: Threads = Threads.create();
	}

	const root = Root.create();
	const snapshots: any[] = [];
	const off = onSnapshot(root, (snapshot) => snapshots.push(snapshot));

	expect(toSnapshot(root)).toStrictEqual({
		conceptChats: { chats: [], activeChatId: "" },
	});

	const chat = Chat.create({ id: "concept:feature" });
	root.conceptChats.addChat(chat);

	expect(toSnapshot(root)).toStrictEqual({
		conceptChats: {
			chats: [{ id: "concept:feature", messages: [] }],
			activeChatId: "concept:feature",
		},
	});

	chat.setMessages([1, 2]);

	expect(toSnapshot(chat)).toStrictEqual({
		id: "concept:feature",
		messages: [
			{ id: 1, parts: [{ type: "text" }] },
			{ id: 2, parts: [{ type: "text" }] },
		],
	});
	expect(toSnapshot(root)).toStrictEqual({
		conceptChats: {
			chats: [
				{
					id: "concept:feature",
					messages: [
						{ id: 1, parts: [{ type: "text" }] },
						{ id: 2, parts: [{ type: "text" }] },
					],
				},
			],
			activeChatId: "concept:feature",
		},
	});

	off();
});

test("snapshot hydration preserves observable containers and references", () => {
	class Chat extends Model {
		messages: { id: number }[] = observable([]);
		draft = observable({ title: "", unread: 0 });

		setMessages(ids: number[]) {
			this.messages.splice(
				0,
				this.messages.length,
				...ids.map((id) => ({ id }))
			);
		}
	}

	const chat = Chat.create({
		messages: [{ id: 1 }],
		draft: { title: "hello", unread: 1 },
	});
	const messagesRef = chat.messages;
	const draftRef = chat.draft;

	expect(isObservable(chat.messages)).toBe(true);
	expect(isObservable(chat.draft)).toBe(true);
	expect(chat.messages).toBe(messagesRef);
	expect(chat.draft).toBe(draftRef);
	expect(toSnapshot(chat)).toStrictEqual({
		messages: [{ id: 1 }],
		draft: { title: "hello", unread: 1 },
	});

	applySnapshot(chat, {
		messages: [{ id: 2 }, { id: 3 }],
		draft: { title: "updated", unread: 2 },
	});

	expect(chat.messages).toBe(messagesRef);
	expect(chat.draft).toBe(draftRef);
	expect(toSnapshot(chat)).toStrictEqual({
		messages: [{ id: 2 }, { id: 3 }],
		draft: { title: "updated", unread: 2 },
	});

	chat.setMessages([1, 2]);
	chat.draft.unread = 3;

	expect(toSnapshot(chat)).toStrictEqual({
		messages: [{ id: 1 }, { id: 2 }],
		draft: { title: "updated", unread: 3 },
	});
});

test("snapshot hydration preserves plain container references", () => {
	class Chat extends Model {
		messages: { id: number }[] = [];
		draft = { title: "", unread: 0 };
	}

	const chat = Chat.create({
		messages: [{ id: 1 }],
		draft: { title: "hello", unread: 1 },
	});
	const messagesRef = chat.messages;
	const draftRef = chat.draft;

	applySnapshot(chat, {
		messages: [{ id: 2 }, { id: 3 }],
		draft: { title: "updated", unread: 2 },
	});

	expect(chat.messages).toBe(messagesRef);
	expect(chat.draft).toBe(draftRef);
	expect(chat.messages).toStrictEqual([{ id: 2 }, { id: 3 }]);
	expect(chat.draft).toStrictEqual({ title: "updated", unread: 2 });
});

test("snapshot hydration preserves nested plain references by index", () => {
	class Chat extends Model {
		messages: {
			id: number;
			meta: { unread: number };
		}[] = [];
	}

	const chat = Chat.create({
		messages: [{ id: 1, meta: { unread: 1 } }],
	});
	const messagesRef = chat.messages;
	const firstMessageRef = chat.messages[0];
	const firstMetaRef = chat.messages[0].meta;

	applySnapshot(chat, {
		messages: [
			{ id: 2, meta: { unread: 2 } },
			{ id: 3, meta: { unread: 0 } },
		],
	});

	expect(chat.messages).toBe(messagesRef);
	expect(chat.messages[0]).toBe(firstMessageRef);
	expect(chat.messages[0].meta).toBe(firstMetaRef);
	expect(toSnapshot(chat)).toStrictEqual({
		messages: [
			{ id: 2, meta: { unread: 2 } },
			{ id: 3, meta: { unread: 0 } },
		],
	});
});

test("hydrated observable arrays in stay live for in-place mutation", () => {
	class Chat extends Model {
		messages: { id: number }[] = observable([]);

		setMessages(ids: number[]) {
			this.messages.splice(
				0,
				this.messages.length,
				...ids.map((id) => ({ id }))
			);
		}
	}

	const chat = Chat.create({ messages: [{ id: 1 }] });
	expect(toSnapshot(chat)).toStrictEqual({ messages: [{ id: 1 }] });

	chat.setMessages([1, 2]);

	expect(toSnapshot(chat)).toStrictEqual({
		messages: [{ id: 1 }, { id: 2 }],
	});
});

test("direct new calls are disallowed", () => {
	class M extends Model {}
	expect(() => new M()).toThrowErrorMatchingInlineSnapshot(
		`[Error: r-state-tree: Can't initialize model directly, use \`M.create()\` instead]`
	);
});

describe("model attachment", () => {
	test("the initial snapshot is loaded before create returns", () => {
		class M extends Model {
			prop = 0;
		}

		const m = M.create({ prop: 1 });
		expect(m.prop).toBe(1);
	});

	test("named factories accept domain-specific creation parameters", () => {
		class M extends Model {
			prop = 0;
			static fromValue(prop: number) {
				return this.create({ prop });
			}
		}

		expect(M.fromValue(1).prop).toBe(1);
	});

	test("snapshot loading is batched", () => {
		class M extends Model {
			count = 0;
		}

		const m = M.create({ count: 1 });
		expect(m.count).toBe(1);
	});

	test("models can be created without a snapshot", () => {
		class M extends Model {
			prop = 0;
		}

		const m = M.create();
		expect(m.prop).toBe(0);
	});

	test("parent reactions observe children attached after creation", () => {
		class CM extends Model {}

		class M extends Model {
			@child cm!: CM;

			setCM() {
				this.cm = CM.create();
			}
		}

		const m = M.create();
		const observedModel = CM.create();
		const parents: Array<Model | null> = [];
		const stop = reaction(
			() => observedModel.parent,
			(parent) => parents.push(parent)
		);
		m.cm = observedModel;
		expect(parents).toEqual([m]);
		stop();
	});

	test("parent reactions observe children added to a list", () => {
		class CM extends Model {}

		class M extends Model {
			@child cms: CM[] = [];

			addCM() {
				this.cms.push(CM.create());
			}
		}

		const m = M.create();
		m.addCM();
		m.addCM();
		expect(m.cms).toHaveLength(2);
		m.cms.forEach((child) => expect(child.parent).toBe(m));
	});

	test("parent reactions observe an initialized child", () => {
		class CM extends Model {}

		class M extends Model {
			@child cm: CM = CM.create();
		}

		const m = M.create();
		expect(m.cm).toBeInstanceOf(CM);
		expect(m.cm.parent).toBe(m);
	});

	test("parent reactions observe initialized child arrays", () => {
		class CM extends Model {}

		class M extends Model {
			@child cms: CM[] = [CM.create(), CM.create()];
		}

		const m = M.create();
		expect(m.cms.length).toBe(2);
		m.cms.forEach((child) => expect(child.parent).toBe(m));
	});

	test("parent reactions observe child detachment", () => {
		class CM extends Model {}

		class M extends Model {
			@child cm: CM | null = CM.create();

			clearCM() {
				this.cm = null;
			}
		}

		const m = M.create();
		const observedModel = m.cm!;
		m.clearCM();
		expect(observedModel.parent).toBe(null);
	});

	test("parent reactions observe children removed from a list", () => {
		class CM extends Model {}

		class M extends Model {
			@child cms: CM[] = [CM.create(), CM.create()];

			popCM() {
				this.cms.pop();
			}
		}

		const m = M.create();
		const children = [...m.cms];
		m.popCM();
		m.popCM();
		children.forEach((child) => expect(child.parent).toBe(null));
	});

	test("re-ordering preserves attachment", () => {
		class CM extends Model {}

		class M extends Model {
			@child cms: CM[] = [CM.create(), CM.create()];

			reverse() {
				this.cms = this.cms.slice().reverse();
			}
		}

		const m = M.create();
		const children = [...m.cms];
		m.reverse();
		expect(m.cms).toEqual(children.reverse());
		m.cms.forEach((child) => expect(child.parent).toBe(m));
	});

	test("external reactions observe attachment", () => {
		class CM extends Model {}

		class M extends Model {
			@child cm!: CM;
			setCM() {
				this.cm = CM.create();
			}
		}

		const m = M.create();
		const observedModel = CM.create();
		const parents: Array<Model | null> = [];
		const stop = reaction(
			() => observedModel.parent,
			(parent) => parents.push(parent)
		);
		m.cm = observedModel;
		expect(parents).toEqual([m]);
		stop();
	});

	test("external reactions receive the previous parent on detachment", () => {
		class CM extends Model {}

		class M extends Model {
			@child cm: CM | null = CM.create();
			_temp!: CM;
			clearCM() {
				this._temp = this.cm!;
				this.cm = null;
			}
		}

		const m = M.create();
		const observedModel = m.cm!;
		const transitions: Array<[Model | null, Model | null]> = [];
		const stop = reaction(
			() => observedModel.parent,
			(parent, previousParent) => transitions.push([parent, previousParent])
		);
		m.clearCM();
		expect(transitions).toEqual([[null, m]]);
		stop();
	});
});

test("can re-attach an detached model", () => {
	class CM extends Model {
		state = 0;
		incState() {
			this.state++;
		}

		get computed() {
			return this.state * 2;
		}
	}

	class M extends Model {
		@child cm!: CM | null;
		_cm: CM | null = null;

		clearCM() {
			this._cm = this.cm;
			this.cm = null;
		}

		setCM() {
			this.cm = this._cm || CM.create();
			this._cm = null;
		}
	}

	const m = M.create();
	m.setCM();
	const observedModel = m.cm!;
	const transitions: Array<[Model | null, Model | null]> = [];
	const stop = reaction(
		() => observedModel.parent,
		(parent, previousParent) => transitions.push([parent, previousParent])
	);
	m.cm!.incState();
	expect(m.cm!.computed).toBe(2);
	m.clearCM();
	m.setCM();
	expect(transitions).toEqual([
		[null, m],
		[m, null],
	]);
	expect(m.cm!.computed).toBe(2);
	m.cm!.incState();
	expect(m.cm!.computed).toBe(4);
	stop();
});

test("can have a child model", () => {
	class MC extends Model {
		state = 0;
	}

	class M extends Model {
		@child mc: MC | null = null;

		addModel(state: number) {
			this.mc = MC.create({ state });
		}
	}

	const m = M.create();
	expect(m.mc).toBe(null);
	m.addModel(1);
	expect(m.mc).toBeInstanceOf(MC);
	expect(m.mc!.state).toBe(1);
});

test("child models are reactive properties", () => {
	class M extends Model {
		@child mc: M | null = null;

		setModel() {
			this.mc = M.create();
		}
	}

	const m = M.create();
	let count = 0;
	reaction(
		() => m.mc,
		() => count++
	);
	m.setModel();
	expect(count).toBe(1);
	m.setModel();
	expect(count).toBe(2);
});

test("model can initialzie child model", () => {
	class MC extends Model {}
	class M extends Model {
		@child mc: MC = MC.create();
	}

	const m = M.create();
	expect(m.mc).toBeInstanceOf(MC);
});

test("child model can't be placed in multiple locations in the tree", () => {
	class MC extends Model {}
	class M extends Model {
		@child mc!: MC;
		setModel(mc: MC) {
			this.mc = mc;
		}
	}

	const mc = MC.create();
	const m1 = M.create();
	const m2 = M.create();
	m1.setModel(mc);
	expect(() => m2.setModel(mc)).toThrow();
});

describe("model identifiers", () => {
	test("identifiers can't be set to undefined once assigned", () => {
		class M extends Model {
			@id id = 1;

			clearId() {
				this.id = undefined as any;
			}
		}

		class MP extends Model {
			@child m = M.create();
		}

		const mp = MP.create();
		expect(() => mp.m.clearId()).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree can't clear an id once it has already been set.]`
		);
	});

	test("same id can't be assigned to different models", () => {
		class M extends Model {
			@id id = 0;
		}

		class MP extends Model {
			@child ms = [M.create()];

			add() {
				this.ms.push(M.create());
			}
		}

		const mp = MP.create();
		expect(() => mp.add()).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: id: 0 is already assigned to another model]`
		);
	});

	test("identifiers can be re-assigned after init", () => {
		class M extends Model {
			@id id = 1;

			setId() {
				this.id = 2;
			}
		}

		class MP extends Model {
			@child m = M.create();
			@modelRef(M) mr: M = this.m;
		}

		const mp = MP.create();
		// With shallow behavior, use deep equality for Model comparisons
		expect(mp.m).toStrictEqual(mp.mr);
		mp.m.setId();
		expect(mp.mr).toBe(undefined);
	});

	test("correct id shows up in snapshot after being re-assigned", () => {
		class M extends Model {
			@id myId = 1;
			test = "me";

			setId() {
				this.myId = 2;
			}
		}

		class MP extends Model {
			@child m = M.create();
			@modelRef(M) mr: M = this.m;
		}

		const mp = MP.create();
		mp.m.setId();
		expect(toSnapshot(mp)).toStrictEqual({
			m: { myId: 2, test: "me" },
			mr: { myId: 1 },
		});
	});

	test("identifiers can be assigned by a named factory", () => {
		class M extends Model {
			@id id!: any;

			static new() {
				return this.create({ id: 1 });
			}
		}

		const m = M.new();
		expect(m.id).toBe(1);
	});

	test("identifiers can be re-assigned in a snapshot", () => {
		class M extends Model {
			@id id = 1;
			badAction() {
				this.id++;
			}
		}

		expect(() => M.create({ id: 1 })).not.toThrowError();
		expect(() => M.create({ id: 2 })).not.toThrowError();
	});
});

test("can get the parent of a model", () => {
	class MC extends Model {}
	class M extends Model {
		@child mc: MC = MC.create();
		@child mc2: MC | null = null;
		@child mcs: MC[] = [MC.create(), MC.create()];
	}

	const m = M.create();
	expect(m.parent).toBe(null);
	expect(m.mc.parent).toBe(m);
	expect(m.mcs.length).toBe(2);
	m.mcs.forEach((mc) => expect(mc.parent).toBe(m));
	m.mc2 = MC.create();
	expect(m.mc2.parent).toBe(m);
	m.mcs.push(MC.create());
	expect(m.mcs[m.mcs.length - 1].parent).toBe(m);
});

test("children models can be set with Object.defineProperty", () => {
	class MC extends Model {}

	class M extends Model {
		@child mcs!: any;

		constructor() {
			super();
			this.mcs = [];
			Object.defineProperty(this, "mcs", {
				value: [],
				writable: true,
				configurable: true,
			});
		}

		addChild() {
			this.mcs.push(MC.create());
		}
	}

	const m = M.create();
	m.addChild();
	expect(m.mcs[0].parent).toBe(m);
	m.addChild();
	expect(m.mcs[1].parent).toBe(m);
});

describe("runtime type switching", () => {
	describe("child property switching", () => {
		test("can switch from single child to array of children", () => {
			class MC extends Model {
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];

				setSingle() {
					this.items = MC.create({ value: 1 });
				}

				setArray() {
					this.items = [MC.create({ value: 2 }), MC.create({ value: 3 })];
				}
			}

			const m = M.create();

			// Start with single
			m.setSingle();
			const oldItem = m.items as MC;
			expect(Array.isArray(m.items)).toBe(false);
			expect((m.items as MC).value).toBe(1);
			expect(oldItem.parent).toBe(m);

			// Switch to array
			m.setArray();
			expect(Array.isArray(m.items)).toBe(true);
			expect((m.items as MC[]).length).toBe(2);
			expect((m.items as MC[])[0].value).toBe(2);
			expect((m.items as MC[])[1].value).toBe(3);
			expect(oldItem.parent).toBe(null);
			(m.items as MC[]).forEach((item) => expect(item.parent).toBe(m));
		});

		test("can switch from array of children to single child", () => {
			class MC extends Model {
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];

				setSingle() {
					this.items = MC.create({ value: 1 });
				}

				setArray() {
					this.items = [MC.create({ value: 2 }), MC.create({ value: 3 })];
				}
			}

			const m = M.create();

			// Start with array
			m.setArray();
			const oldItems = [...(m.items as MC[])];
			expect(Array.isArray(m.items)).toBe(true);
			expect((m.items as MC[]).length).toBe(2);
			oldItems.forEach((item) => expect(item.parent).toBe(m));

			// Switch to single
			m.setSingle();
			expect(Array.isArray(m.items)).toBe(false);
			expect((m.items as MC).value).toBe(1);
			expect((m.items as MC).parent).toBe(m);
			oldItems.forEach((item) => expect(item.parent).toBe(null));
		});

		test("switching child types is reactive", () => {
			class MC extends Model {
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];

				setSingle() {
					this.items = MC.create({ value: 1 });
				}

				setArray() {
					this.items = [MC.create({ value: 2 }), MC.create({ value: 3 })];
				}
			}

			const m = M.create();
			let reactionCount = 0;
			let currentValue: MC | MC[];

			reaction(
				() => m.items,
				(value) => {
					currentValue = value;
					reactionCount++;
				}
			);

			expect(reactionCount).toBe(0);

			m.setSingle();
			expect(reactionCount).toBe(1);
			expect(Array.isArray(currentValue!)).toBe(false);

			m.setArray();
			expect(reactionCount).toBe(2);
			expect(Array.isArray(currentValue!)).toBe(true);
		});

		test("parent references are correct after switching", () => {
			class MC extends Model {
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];
			}

			const m = M.create();

			// Start with single
			m.items = MC.create({ value: 1 });
			expect((m.items as MC).parent).toBe(m);

			// Switch to array
			m.items = [MC.create({ value: 2 }), MC.create({ value: 3 })];
			expect((m.items as MC[])[0].parent).toBe(m);
			expect((m.items as MC[])[1].parent).toBe(m);

			// Switch back to single
			m.items = MC.create({ value: 4 });
			expect((m.items as MC).parent).toBe(m);
		});
	});

	describe("modelRef property switching", () => {
		test("can switch from single modelRef to array of modelRefs", () => {
			class MC extends Model {
				@id id!: any;
				value = 0;
			}

			class M extends Model {
				@child(MC) children: MC[] = [];
				@modelRef(MC) refs!: MC | MC[];

				addChild(id: number, value: number) {
					this.children.push(MC.create({ id, value }));
				}

				setSingleRef(index: number) {
					this.refs = this.children[index];
				}

				setArrayRefs(indices: number[]) {
					this.refs = indices.map((i) => this.children[i]);
				}
			}

			const m = M.create();
			m.addChild(1, 10);
			m.addChild(2, 20);
			m.addChild(3, 30);

			// Start with single ref
			m.setSingleRef(0);
			expect(Array.isArray(m.refs)).toBe(false);
			expect((m.refs as MC).id).toBe(1);

			// Switch to array refs
			m.setArrayRefs([1, 2]);
			expect(Array.isArray(m.refs)).toBe(true);
			expect((m.refs as MC[]).length).toBe(2);
			expect((m.refs as MC[])[0].id).toBe(2);
			expect((m.refs as MC[])[1].id).toBe(3);
		});

		test("can switch from array of modelRefs to single modelRef", () => {
			class MC extends Model {
				@id id!: any;
				value = 0;
			}

			class M extends Model {
				@child(MC) children: MC[] = [];
				@modelRef(MC) refs!: MC | MC[];

				addChild(id: number, value: number) {
					this.children.push(MC.create({ id, value }));
				}

				setSingleRef(index: number) {
					this.refs = this.children[index];
				}

				setArrayRefs(indices: number[]) {
					this.refs = indices.map((i) => this.children[i]);
				}
			}

			const m = M.create();
			m.addChild(1, 10);
			m.addChild(2, 20);
			m.addChild(3, 30);

			// Start with array refs
			m.setArrayRefs([0, 1]);
			expect(Array.isArray(m.refs)).toBe(true);
			expect((m.refs as MC[]).length).toBe(2);

			// Switch to single ref
			m.setSingleRef(2);
			expect(Array.isArray(m.refs)).toBe(false);
			expect((m.refs as MC).id).toBe(3);
		});

		test("switching modelRef types is reactive", () => {
			class MC extends Model {
				@id id!: any;
				value = 0;
			}

			class M extends Model {
				@child(MC) children: MC[] = [];
				@modelRef(MC) refs!: MC | MC[];

				addChild(id: number, value: number) {
					this.children.push(MC.create({ id, value }));
				}

				setSingleRef(index: number) {
					this.refs = this.children[index];
				}

				setArrayRefs(indices: number[]) {
					this.refs = indices.map((i) => this.children[i]);
				}
			}

			const m = M.create();
			m.addChild(1, 10);
			m.addChild(2, 20);

			let reactionCount = 0;
			let currentValue: MC | MC[];

			reaction(
				() => m.refs,
				(value) => {
					currentValue = value;
					reactionCount++;
				}
			);

			expect(reactionCount).toBe(0);

			m.setSingleRef(0);
			expect(reactionCount).toBe(1);
			expect(Array.isArray(currentValue!)).toBe(false);

			m.setArrayRefs([0, 1]);
			expect(reactionCount).toBe(2);
			expect(Array.isArray(currentValue!)).toBe(true);
		});
	});

	describe("snapshot compatibility with type switching", () => {
		test("snapshots work correctly when switching child types", () => {
			class MC extends Model {
				@id id!: any;
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];
			}

			const m = M.create();

			// Test single child snapshot
			m.items = MC.create({ id: 1, value: 10 });
			let snapshot = toSnapshot(m);
			expect(snapshot.items).toEqual({ id: 1, value: 10 });

			// Switch to array and test snapshot
			m.items = [
				MC.create({ id: 2, value: 20 }),
				MC.create({ id: 3, value: 30 }),
			];
			snapshot = toSnapshot(m);
			expect(snapshot.items).toEqual([
				{ id: 2, value: 20 },
				{ id: 3, value: 30 },
			]);

			// Switch back to single and test snapshot
			m.items = MC.create({ id: 4, value: 40 });
			snapshot = toSnapshot(m);
			expect(snapshot.items).toEqual({ id: 4, value: 40 });
		});

		test("can load snapshot with different type than current", () => {
			class MC extends Model {
				@id id!: any;
				value = 0;
			}

			class M extends Model {
				@child(MC) items!: MC | MC[];
			}

			const m = M.create();

			// Start with single
			m.items = MC.create({ id: 1, value: 10 });
			expect(Array.isArray(m.items)).toBe(false);

			// Load snapshot with array
			applySnapshot(m, {
				items: [
					{ id: 2, value: 20 },
					{ id: 3, value: 30 },
				],
			});
			expect(Array.isArray(m.items)).toBe(true);
			expect((m.items as unknown as MC[]).length).toBe(2);
			expect((m.items as unknown as MC[])[0].value).toBe(20);

			// Load snapshot with single
			applySnapshot(m, {
				items: { id: 4, value: 40 },
			});
			expect(Array.isArray(m.items)).toBe(false);
			expect((m.items as MC).value).toBe(40);
		});
	});
});

describe("model references", () => {
	test("modelRef requires an explicit model constructor", () => {
		expect(() => {
			class Invalid extends Model {
				@(modelRef as any) ref!: Model;
			}
			return Invalid;
		}).toThrow("@modelRef requires a model constructor");

		class InvalidStatic extends Model {
			ref!: Model;
			static types = { ref: modelRef };
		}
		expect(() => InvalidStatic.create()).toThrow(
			"modelRef requires a model constructor"
		);
	});

	test("modelRef rejects a model outside its declared type", () => {
		class User extends Model {
			@id id = 1;
		}
		class Project extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) user = User.create();
			@child(Project) project = Project.create();
			@modelRef(User) ref!: User;
		}

		const root = Root.create();
		expect(() => (root.ref = root.project as unknown as User)).toThrow(
			"must reference User"
		);
	});

	test("findModelById exposes typed tree-scoped lookup", () => {
		class User extends Model {
			@id id = 1;
		}
		class Project extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) user: User | null = User.create();
			@child(Project) project = Project.create();
		}

		const root = Root.create();
		expect(findModelById(root, User, 1)).toBe(root.user);
		expect(findModelById(root, Project, 1)).toBe(root.project);
		expect(findModelById(root, User, 2)).toBe(undefined);
	});

	test("findModelById tracks id mutation and detachment reactively", () => {
		class User extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) user: User | null = User.create();
		}

		const root = Root.create();
		const user = root.user!;
		let byOne: User | undefined;
		let byTwo: User | undefined;
		const dispose = effect(() => {
			byOne = findModelById(root, User, 1);
			byTwo = findModelById(root, User, 2);
		});

		expect(byOne).toBe(user);
		expect(byTwo).toBe(undefined);
		user.id = 2;
		expect(byOne).toBe(undefined);
		expect(byTwo).toBe(user);
		root.user = null;
		expect(byTwo).toBe(undefined);
		dispose();
	});

	test("ids and typed references are namespaced by exact model type", () => {
		class User extends Model {
			@id id = 1;
		}
		class Project extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) users = [User.create()];
			@child(Project) projects = [Project.create()];
			@modelRef(User) user!: User;
			@modelRef(Project) project!: Project;
			@modelRef(User) userList: User[] = [];

			setRefs() {
				this.user = this.users[0];
				this.project = this.projects[0];
				this.userList = [this.users[0]];
			}
		}

		const root = Root.create();
		root.setRefs();
		expect(root.user).toBe(root.users[0]);
		expect(root.project).toBe(root.projects[0]);
		expect(root.userList).toEqual([root.users[0]]);
	});

	test("failed same-type id mutation preserves both mappings", () => {
		class User extends Model {
			@id id!: number;
		}
		class Root extends Model {
			@child(User) users = [User.create({ id: 1 }), User.create({ id: 2 })];
			@modelRef(User) first: User = this.users[0];
			@modelRef(User) second: User = this.users[1];
		}

		const root = Root.create();
		expect(() => (root.users[0].id = 2)).toThrow();
		expect(root.users[0].id).toBe(1);
		expect(root.first).toBe(root.users[0]);
		expect(root.second).toBe(root.users[1]);
	});

	test("typed reference reacts when an identifier changes", () => {
		class User extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) user = User.create();
			@modelRef(User) ref: User = this.user;
		}

		const root = Root.create();
		let resolved: User | undefined;
		const dispose = effect(() => {
			resolved = root.ref;
		});
		expect(resolved).toBe(root.user);
		root.user.id = 2;
		expect(resolved).toBe(undefined);
		dispose();
	});

	test("snapshot reconciliation uses the declared child type with overlapping ids", () => {
		class User extends Model {
			@id id!: number;
			name = "";
		}
		class Project extends Model {
			@id id!: number;
		}
		class Root extends Model {
			@child(User) users = [User.create({ id: 1, name: "old" })];
			@child(Project) projects = [Project.create({ id: 1 })];
		}

		const root = Root.create();
		const user = root.users[0];
		applySnapshot(root, { users: [{ id: 1, name: "new" }] });
		expect(root.users[0]).toBe(user);
		expect(root.users[0].name).toBe("new");
	});

	test("snapshot loading rejects duplicate ids of the same child type", () => {
		class User extends Model {
			@id id!: number;
		}
		class Root extends Model {
			@child(User) users: User[] = [];
		}

		const root = Root.create();
		expect(() =>
			applySnapshot(root, { users: [{ id: 1 }, { id: 1 }] })
		).toThrow("duplicate ids");
		expect(root.users).toEqual([]);
	});

	test("typed references do not resolve an overlapping id from another model type", () => {
		class User extends Model {
			@id id = 1;
		}
		class Project extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(Project) projects = [Project.create()];
			@child(User) users = [User.create()];
			@modelRef(User) ref: User = this.users[0];
		}

		const root = Root.create();
		expect(root.ref).toBe(root.users[0]);
	});

	test("failed attachment rolls back the child collection", () => {
		class User extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(User) users = [User.create()];
		}

		const root = Root.create();
		const original = root.users[0];
		const duplicate = User.create();

		expect(() => root.users.push(duplicate)).toThrow();
		expect(root.users).toEqual([original]);
		expect(original.parent).toBe(root);
		expect(duplicate.parent).toBe(null);
	});

	test("failed snapshot application rolls back changes across child properties", () => {
		class User extends Model {
			@id id!: number;
		}
		class Root extends Model {
			@child(User) first: User[] = [];
			@child(User) second: User[] = [];
		}

		const root = Root.create();
		expect(() =>
			applySnapshot(root, {
				first: [{ id: 1 }],
				second: [{ id: 1 }],
			})
		).toThrow("already assigned");
		expect(root.first).toEqual([]);
		expect(root.second).toEqual([]);
	});

	test("singular snapshot reconciliation uses the declared child type", () => {
		class User extends Model {
			@id id = 1;
			name = "";
		}
		class Project extends Model {
			@id id = 1;
			name = "";
		}
		class Root extends Model {
			@child(User) item: User = Project.create() as unknown as User;
		}

		const root = Root.create();
		applySnapshot(root, { item: { id: 1, name: "hydrated" } });
		expect(root.item).toBeInstanceOf(User);
		expect(root.item.name).toBe("hydrated");
	});

	test("references react when their owning model is detached and reparented", () => {
		class User extends Model {
			@id id = 1;
		}
		class Holder extends Model {
			@modelRef(User) ref!: User;

			setRef(user: User) {
				this.ref = user;
			}
		}
		class Root extends Model {
			@child(User) user = User.create();
			@child(Holder) holder: Holder | null = null;
		}

		const first = Root.create();
		const second = Root.create();
		const holder = Holder.create();
		first.holder = holder;
		holder.setRef(first.user);

		let resolved: User | undefined;
		const dispose = effect(() => {
			resolved = holder.ref;
		});
		expect(resolved).toBe(first.user);
		first.holder = null;
		expect(resolved).toBe(undefined);
		second.holder = holder;
		expect(resolved).toBe(second.user);
		dispose();
	});

	test("can assign a model to a reference", () => {
		class MC extends Model {
			@id id = 0;
		}

		class M extends Model {
			@child(MC) mc: MC = MC.create();
			@modelRef(MC) mr!: MC;

			setRef() {
				this.mr = this.mc;
			}
		}

		const m = M.create();
		m.setRef();
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mc).toStrictEqual(m.mr);
	});

	test("can't assing a model without an id to a reference", () => {
		class MC extends Model {}
		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef(MC) mr!: MC;

			setRef() {
				this.mr = this.mc;
			}
		}

		const m = M.create();
		expect(() => m.setRef()).toThrow();
	});

	test("model ref is not available until the referenced model is attached", () => {
		class MC extends Model {
			@id id = 1;
		}

		class M extends Model {
			@transient mctemp = MC.create({ id: 1 });
			@child mc: MC | null = null;
			@modelRef(MC) mr: MC = this.mctemp as any;

			setChild() {
				this.mc = this.mctemp;
			}
		}

		const m = M.create();
		expect(m.mr).toBe(undefined);
		m.setChild();
		expect(m.mr).toStrictEqual(m.mc);
	});

	test("model ref will become undefined when model is detached", () => {
		class MC extends Model {
			@id id = 0;
		}
		class M extends Model {
			@child(MC) mc: MC | null = MC.create();
			@modelRef(MC) mr!: MC | null;

			setRef() {
				this.mr = this.mc;
			}

			clearModel() {
				this.mc = null;
			}
		}

		const m = M.create();
		expect(m.mr).toBe(undefined);
		m.setRef();
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mc).toStrictEqual(m.mr);
		m.clearModel();
		expect(m.mr).toBe(undefined);
	});

	test("model ref will become undefined when model is detached (array)", () => {
		class MC extends Model {
			@id id: any;
		}

		class M extends Model {
			@child mc: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@modelRef(MC) mr!: MC;

			setRef() {
				this.mr = this.mc[0];
			}

			clearModel() {
				this.mc = [];
			}
		}

		const m = M.create();
		m.setRef();
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mc[0]).toStrictEqual(m.mr);
		m.clearModel();
		expect(m.mr).toBe(undefined);
	});

	test("model ref is reactive", () => {
		class MC extends Model {
			@id id: any;
		}
		class M extends Model {
			@child mc: MC[] = [MC.create({ id: 0 }), MC.create({ id: 1 })];
			@modelRef(MC) mr!: MC;

			setModel(index: number) {
				this.mr = (index >= 0 ? this.mc[index] : undefined) as MC;
			}
		}

		const m = M.create();
		let current;

		effect(() => {
			current = m.mr;
		});

		expect(current).toBe(undefined);
		m.setModel(0);
		// With shallow behavior, use deep equality for Model comparisons
		expect(current).toStrictEqual(m.mc[0]);
		m.setModel(1);
		expect(current).toStrictEqual(m.mc[1]);
		m.setModel(-1);
		expect(current).toBe(undefined);
	});

	test("model ref is restored when model is re-attached", () => {
		class MC extends Model {
			@id id = 0;
		}
		class M extends Model {
			@child(MC) mc: MC | null = MC.create();
			@modelRef(MC) mr!: MC | null;
			_temp!: MC | null;

			setRef() {
				this.mr = this.mc;
			}

			clearModel() {
				this._temp = this.mc;
				this.mc = null;
			}

			resetModel() {
				this.mc = this._temp;
			}
		}

		const m = M.create();
		m.setRef();
		m.clearModel();
		expect(m.mr).toBe(undefined);
		expect(m.mc).toBe(null);
		m.resetModel();
		expect(m.mc).not.toBe(null);
		// With shallow behavior, use deep equality for Model comparisons
		expect(m.mr).toStrictEqual(m.mc);
	});

	test("model ref is NOT restored when model is re-attached to a another tree root", () => {
		let temp: MC | null = null;

		class MC extends Model {
			@id id = 0;
		}
		class M extends Model {
			@child mc: MC = MC.create();
			@modelRef(MC) mr!: MC | null;
			setRef: boolean = false;

			clearModel() {
				temp = this.mc;
				this.mc = null as any;
			}

			resetModel() {
				this.mc = temp as any;
			}
		}

		const m1 = M.create({ setRef: true });
		const m2 = M.create();

		m1.clearModel();
		expect(m1.mr).toBe(undefined);
		expect(m1.mc).toBe(null);
		m2.resetModel();
		expect(m1.mr).toBe(undefined);
		expect(m1.mc).toBe(null);
	});
	test("model refs can be an array", () => {
		class MC extends Model {
			@id id: any;
		}
		class M extends Model {
			@child(MC) mc1: MC | null = MC.create({ id: 1 });
			@child(MC) mc2: MC | null = MC.create({ id: 2 });
			@modelRef(MC) mr: MC[] = [];
			_temp!: MC | null;

			setRef() {
				this.mr = [this.mc1!, this.mc2!];
			}

			clearModel1() {
				this.mc1 = null;
			}

			clearModel2() {
				this._temp = this.mc2;
				this.mc2 = null;
			}

			restoreModel2() {
				this.mc2 = this._temp;
			}
		}

		const m = M.create();
		m.setRef();
		expect(m.mr).toEqual([m.mc1, m.mc2]);
		m.clearModel1();
		expect(m.mr).toEqual([m.mc2]); // Filters out undefined
		m.clearModel2();
		expect(m.mr).toEqual([]); // Filters out all undefined
		m.restoreModel2();
		expect(m.mr).toEqual([m.mc2]); // Only valid models
	});
});

describe("child type validation", () => {
	test("rejects non-Model values for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) child!: MC;
		}

		const m = M.create();

		expect(() => {
			m.child = "invalid" as unknown as MC;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'child' must be a Model instance, an array of Model instances, or null/undefined. Found: string]`
		);

		expect(() => {
			m.child = 123 as unknown as MC;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'child' must be a Model instance, an array of Model instances, or null/undefined. Found: number]`
		);

		expect(() => {
			m.child = {} as unknown as MC;
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'child' must be a Model instance, an array of Model instances, or null/undefined. Found: object]`
		);
	});

	test("allows null and undefined for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) child!: MC | null;
		}

		const m = M.create();

		expect(() => {
			m.child = null;
		}).not.toThrow();

		expect(() => {
			m.child = undefined as unknown as MC | null;
		}).not.toThrow();
	});

	test("allows Model instance for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) child!: MC;
		}

		const m = M.create();
		const childModel = MC.create();

		expect(() => {
			m.child = childModel;
		}).not.toThrow();
		expect(m.child).toBe(childModel);
	});

	test("rejects array with non-Model items for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) children!: MC[];
		}

		const m = M.create();

		expect(() => {
			m.children = ["invalid", "values"] as unknown as MC[];
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'children' must be a Model instance, an array of Model instances, or null/undefined. Found invalid array item: string]`
		);

		expect(() => {
			m.children = [MC.create(), "invalid"] as unknown as MC[];
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'children' must be a Model instance, an array of Model instances, or null/undefined. Found invalid array item: string]`
		);

		expect(() => {
			m.children = [123, 456] as unknown as MC[];
		}).toThrowErrorMatchingInlineSnapshot(
			`[Error: r-state-tree: child property 'children' must be a Model instance, an array of Model instances, or null/undefined. Found invalid array item: number]`
		);
	});

	test("allows array of Model instances for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) children!: MC[];
		}

		const m = M.create();
		const children = [MC.create(), MC.create()];

		expect(() => {
			m.children = children;
		}).not.toThrow();
		expect(m.children).toEqual(children);
	});

	test("allows empty array for child property", () => {
		class MC extends Model {}
		class M extends Model {
			@child(MC) children!: MC[];
		}

		const m = M.create();

		expect(() => {
			m.children = [];
		}).not.toThrow();
		expect(m.children).toEqual([]);
	});
});

// Ordinary Model fields are shallow-reactive and participate in snapshots by default.
// Their values are not deep-wrapped. Treat plain objects/arrays as immutable, or
// store `observable()` containers / `signal()` values if you need in-place mutation + snapshot updates.
describe("implicit Model snapshot fields", () => {
	test("fields are reactive on assignment (property-level)", () => {
		class M extends Model {
			title = "a";
			setTitle(t: string) {
				this.title = t;
			}
		}

		const m = M.create();
		let count = 0;

		effect(() => {
			m.title;
			count++;
		});

		m.setTitle("b");
		expect(count).toBe(2);
	});

	test("toSnapshot updates after assignment (no stale cache)", () => {
		class M extends Model {
			title = "a";
			setTitle(t: string) {
				this.title = t;
			}
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ title: "a" });
		m.setTitle("b");
		expect(toSnapshot(m)).toStrictEqual({ title: "b" });
	});

	test("observable() container mutations update snapshots", () => {
		class M extends Model {
			items: { value: number }[] = observable([]);
			addItem(value: number) {
				this.items.push({ value });
			}
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ items: [] });
		m.addItem(1);
		expect(toSnapshot(m)).toStrictEqual({ items: [{ value: 1 }] });

		// Items are NOT wrapped (shallow behavior)
		expect(isObservable(m.items[0])).toBe(false);
	});

	test("nested observable() containers update snapshots on deep mutation", () => {
		class M extends Model {
			data = observable({ nested: observable({ value: 1 }) });
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ data: { nested: { value: 1 } } });
		m.data.nested.value++;
		expect(toSnapshot(m)).toStrictEqual({ data: { nested: { value: 2 } } });
	});

	test("signal() serializes current value and stays up to date", () => {
		class M extends Model {
			count = signal(0);
		}

		const m = M.create();
		expect(toSnapshot(m)).toStrictEqual({ count: 0 });
		m.count.value = 1;
		expect(toSnapshot(m)).toStrictEqual({ count: 1 });
	});

	test("raw in-place mutation does NOT trigger onSnapshot; reassignment does", () => {
		class M extends Model {
			tags: string[] = [];

			pushTag(tag: string) {
				this.tags.push(tag); // in-place
			}

			reassignTags(tags: string[]) {
				this.tags = tags;
			}
		}

		const m = M.create();
		const snapshots: any[] = [];
		const off = onSnapshot(m, (snap) => snapshots.push(snap));

		// In-place mutation: onSnapshot does NOT fire
		m.pushTag("a");
		expect(snapshots.length).toBe(0);

		// toSnapshot also returns the stale cached snapshot (from when listener was set up)
		// because the snapshot is a memoized computed and no reactive dependencies changed
		expect(toSnapshot(m)).toStrictEqual({ tags: [] });

		// Reassignment: onSnapshot fires and cache is invalidated
		m.reassignTags(["a", "b"]);
		expect(snapshots.length).toBe(1);
		expect(snapshots[0]).toStrictEqual({ tags: ["a", "b"] });

		// Now toSnapshot reflects the new value
		expect(toSnapshot(m)).toStrictEqual({ tags: ["a", "b"] });

		off();
	});

	test("observable() container triggers onSnapshot on mutation", () => {
		class M extends Model {
			items: { id: number }[] = observable([]);

			addItem(id: number) {
				this.items.push({ id });
			}
		}

		const m = M.create();
		const snapshots: any[] = [];
		const off = onSnapshot(m, (snap) => snapshots.push(snap));

		m.addItem(1);
		expect(snapshots.length).toBe(1);
		expect(snapshots[0]).toStrictEqual({ items: [{ id: 1 }] });

		m.addItem(2);
		expect(snapshots.length).toBe(2);
		expect(snapshots[1]).toStrictEqual({ items: [{ id: 1 }, { id: 2 }] });

		off();
	});

	test("applying an unchanged observable array snapshot does not emit", () => {
		class M extends Model {
			items: number[] = observable([1, 2]);
		}

		const m = M.create();
		const snapshot = toSnapshot(m);
		const snapshots: unknown[] = [];
		const stop = onSnapshot(m, (nextSnapshot) => snapshots.push(nextSnapshot));

		applySnapshot(m, snapshot);

		expect(snapshots).toEqual([]);
		stop();
	});

	test("state is included in snapshots", () => {
		class M extends Model {
			items: { value: number }[] = [];

			addItem(value: number) {
				this.items.push({ value });
			}
		}

		const m = M.create();
		m.addItem(1);
		m.addItem(2);

		const snapshot = toSnapshot(m);
		expect(snapshot.items).toEqual([{ value: 1 }, { value: 2 }]);
	});

	test("state can be restored from snapshot", () => {
		class M extends Model {
			items: { value: number }[] = [];
		}

		const m = M.create();
		applySnapshot(m, { items: [{ value: 1 }, { value: 2 }] });

		expect(m.items).toEqual([{ value: 1 }, { value: 2 }]);
		// Items are NOT wrapped (shallow behavior)
		expect(isObservable(m.items[0])).toBe(false);
	});

	test("invalidates changed raw state after in-place hydration without replacing it", () => {
		class M extends Model {
			settings = { theme: "light" };

			@computed get theme() {
				return this.settings.theme;
			}
		}

		const m = M.create();
		const settings = m.settings;
		const snapshots: unknown[] = [];
		const stop = onSnapshot(m, (snapshot) => snapshots.push(snapshot));

		expect(m.theme).toBe("light");

		applySnapshot(m, { settings: { theme: "dark" } });

		expect(m.settings).toBe(settings);
		expect(m.theme).toBe("dark");
		expect(snapshots).toEqual([{ settings: { theme: "dark" } }]);

		applySnapshot(m, { settings: { theme: "dark" } });

		expect(snapshots).toHaveLength(1);
		stop();
	});

	test("state allows structuredClone of values", () => {
		class M extends Model {
			data: { value: number } = { value: 1 };
		}

		const m = M.create();

		// Should NOT throw - values are plain objects
		expect(() => structuredClone(m.data)).not.toThrow();
	});
});

describe("snapshot serialization rules", () => {
	test("preserves JavaScript primitive values for application codecs", () => {
		class M extends Model {
			missing: unknown = undefined;
			notANumber = Number.NaN;
			positiveInfinity = Infinity;
			negativeInfinity = -Infinity;
		}

		const m = M.create();
		const snapshot = toSnapshot(m);

		expect(snapshot.missing).toBeUndefined();
		expect(snapshot.notANumber).toBeNaN();
		expect(snapshot.positiveInfinity).toBe(Infinity);
		expect(snapshot.negativeInfinity).toBe(-Infinity);
	});

	test("does not report unchanged NaN state in snapshot diffs", () => {
		class M extends Model {
			notANumber = Number.NaN;
			count = 0;
		}

		const m = M.create();
		const diffs: unknown[] = [];
		const stop = onSnapshotDiff(m, (diff) => diffs.push(diff));

		m.count = 1;

		expect(diffs).toEqual([
			{
				undo: { count: 0 },
				redo: { count: 1 },
			},
		]);
		stop();
	});

	test("serializes an unresolved model ref as null", () => {
		class Item extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(Item) items: Item[] = [];
			@modelRef(Item) selected?: Item;
		}

		const root = Root.create();
		const snapshot = toSnapshot(root);

		expect(snapshot).toEqual({ items: [], selected: null });
		expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(() => applySnapshot(root, snapshot)).not.toThrow();
		expect(root.selected).toBeUndefined();
	});

	test("round-trips null child snapshots without creating a child", () => {
		class Child extends Model {}
		class Root extends Model {
			@child(Child) child: Child | null = null;
		}

		const root = Root.create();
		const snapshot = JSON.parse(JSON.stringify(toSnapshot(root)));

		expect(snapshot).toEqual({ child: null });
		expect(() => applySnapshot(root, snapshot)).not.toThrow();
		expect(root.child).toBeNull();
	});

	test("diffs transitions to and from a null child snapshot", () => {
		class Child extends Model {
			value = 1;
		}
		class Root extends Model {
			@child(Child) child: Child | null = null;
		}

		const root = Root.create();
		const diffs: unknown[] = [];
		const stop = onSnapshotDiff(root, (diff) => diffs.push(diff));

		root.child = Child.create();
		root.child = null;

		expect(diffs).toEqual([
			{
				undo: { child: null },
				redo: { child: { value: 1 } },
			},
			{
				undo: { child: { value: 1 } },
				redo: { child: null },
			},
		]);
		stop();
	});

	test("round-trips null snapshots for child types with identifiers", () => {
		class Child extends Model {
			@id id = 1;
		}
		class Root extends Model {
			@child(Child) child: Child | null = null;
		}

		const root = Root.create();
		const snapshot = JSON.parse(JSON.stringify(toSnapshot(root)));

		expect(snapshot).toEqual({ child: null });
		expect(() => applySnapshot(root, snapshot)).not.toThrow();
		expect(root.child).toBeNull();
	});

	test("preserves unresolved model ref ids in snapshots", () => {
		class Item extends Model {
			@id id!: number;
		}
		class Root extends Model {
			@child(Item) items = [Item.create({ id: 1 })];
			@modelRef(Item) selected: Item | undefined = this.items[0];
		}

		const root = Root.create();
		const selected = root.items[0];
		root.items = [];

		expect(root.selected).toBeUndefined();
		expect(toSnapshot(root)).toEqual({
			items: [],
			selected: { id: 1 },
		});

		root.items = [selected];
		expect(root.selected).toBe(selected);
	});

	describe("Date serialization", () => {
		test("Date serializes to ISO string in snapshots", () => {
			class M extends Model {
				createdAt: Date = new Date("2024-01-15T10:30:00.000Z");
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.createdAt).toBe("2024-01-15T10:30:00.000Z");
			expect(typeof snapshot.createdAt).toBe("string");
		});

		test("Date state hydrates back into the runtime Date shape", () => {
			class M extends Model {
				createdAt = new Date("2024-01-15T10:30:00.000Z");
				nested = {
					updatedAt: new Date("2024-01-16T10:30:00.000Z"),
				};
			}

			const m = M.create();
			applySnapshot(m, {
				createdAt: "2025-02-01T12:00:00.000Z",
				nested: { updatedAt: "2025-02-02T12:00:00.000Z" },
			});

			expect(m.createdAt).toBeInstanceOf(Date);
			expect(m.createdAt.toISOString()).toBe("2025-02-01T12:00:00.000Z");
			expect(m.nested.updatedAt).toBeInstanceOf(Date);
			expect(m.nested.updatedAt.toISOString()).toBe("2025-02-02T12:00:00.000Z");
		});

		test("observable Date state remains observable after hydration", () => {
			class M extends Model {
				createdAt = observable(new Date("2024-01-15T10:30:00.000Z"));
			}

			const m = M.create();
			applySnapshot(m, {
				createdAt: "2025-02-01T12:00:00.000Z",
			});

			expect(isObservable(m.createdAt)).toBe(true);

			const snapshots: unknown[] = [];
			const stop = onSnapshot(m, (snapshot) => snapshots.push(snapshot));

			m.createdAt.setUTCFullYear(2026);

			expect(snapshots).toEqual([{ createdAt: "2026-02-01T12:00:00.000Z" }]);
			expect(toSnapshot(m)).toEqual({
				createdAt: "2026-02-01T12:00:00.000Z",
			});
			stop();
		});

		test("Date in nested object serializes to ISO string", () => {
			class M extends Model {
				data = { timestamp: new Date("2024-06-20T15:00:00.000Z") };
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({
				timestamp: "2024-06-20T15:00:00.000Z",
			});
		});

		test("Date in array serializes to ISO string", () => {
			class M extends Model {
				dates: Date[] = [
					new Date("2024-01-01T00:00:00.000Z"),
					new Date("2024-12-31T23:59:59.999Z"),
				];
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.dates).toEqual([
				"2024-01-01T00:00:00.000Z",
				"2024-12-31T23:59:59.999Z",
			]);
		});

		test("Date array hydration preserves the element shape when the array grows", () => {
			class M extends Model {
				dates = [new Date("2024-01-01T00:00:00.000Z")];
			}

			const m = M.create({
				dates: ["2025-01-01T00:00:00.000Z", "2025-01-02T00:00:00.000Z"],
			});

			expect(m.dates).toHaveLength(2);
			expect(m.dates.every((date) => date instanceof Date)).toBe(true);
			expect(m.dates.map((date) => date.toISOString())).toEqual([
				"2025-01-01T00:00:00.000Z",
				"2025-01-02T00:00:00.000Z",
			]);
		});
	});

	describe("Signal serialization", () => {
		test("signals serialize to their current .value in snapshots", () => {
			class M extends Model {
				count = signal(42);
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.count).toBe(42);
			expect(typeof snapshot.count).toBe("number");
		});

		test("Signal array hydration preserves distinct elements when the array grows", () => {
			class M extends Model {
				counts = [signal(0)];
			}

			const m = M.create({ counts: [1, 2] });

			expect(m.counts).toHaveLength(2);
			expect(m.counts[0]).not.toBe(m.counts[1]);
			expect(m.counts.map((count) => count.value)).toEqual([1, 2]);
		});

		test("signal with object value serializes the object", () => {
			class M extends Model {
				data = signal({ nested: { value: 123 } });
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({ nested: { value: 123 } });
		});

		test("signal with array value serializes the array", () => {
			class M extends Model {
				items = signal([1, 2, 3]);
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.items).toEqual([1, 2, 3]);
		});

		test("signal with Date value serializes to ISO string", () => {
			class M extends Model {
				when = signal(new Date("2024-03-15T12:00:00.000Z"));
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.when).toBe("2024-03-15T12:00:00.000Z");
		});
	});

	describe("Non-plain object rejection", () => {
		test("Map field fails during creation", () => {
			class M extends Model {
				data = new Map([["key", "value"]]);
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support Map at path "data"/
			);
		});

		test("Set field fails during creation", () => {
			class M extends Model {
				items = new Set([1, 2, 3]);
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support Set at path "items"/
			);
		});

		test("WeakMap field fails during creation", () => {
			class M extends Model {
				cache = new WeakMap();
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support WeakMap at path "cache"/
			);
		});

		test("WeakSet field fails during creation", () => {
			class M extends Model {
				visited = new WeakSet();
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support WeakSet at path "visited"/
			);
		});

		test("class instance field fails during creation", () => {
			class CustomClass {
				value = 42;
			}

			class M extends Model {
				instance = new CustomClass();
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support class instance \(CustomClass\) at path "instance"/
			);
		});

		test("nested Map throws with correct path", () => {
			class M extends Model {
				data = { level1: { level2: new Map() } };
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support Map at path "data\.level1\.level2"/
			);
		});

		test("Map in array throws with correct path", () => {
			class M extends Model {
				items: any[] = [{ nested: new Map() }];
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support Map at path "items\[0\]\.nested"/
			);
		});

		test("RegExp field fails during creation", () => {
			class M extends Model {
				pattern = /test/gi;
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support RegExp at path "pattern"/
			);
		});

		test("Error field fails during creation", () => {
			class M extends Model {
				lastError = new Error("oops");
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support Error at path "lastError"/
			);
		});
	});

	describe("Unsupported primitive rejection", () => {
		test("bigint field fails during creation", () => {
			class M extends Model {
				id = 1n;
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support bigint at path "id"/
			);
		});

		test("symbol field fails during creation", () => {
			class M extends Model {
				token = Symbol("t");
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support symbol at path "token"/
			);
		});

		test("function field fails during creation", () => {
			class M extends Model {
				fn = () => 1;
			}

			expect(() => M.create()).toThrowError(
				/r-state-tree: snapshots do not support function at path "fn"/
			);
		});
	});

	describe("Valid snapshot values", () => {
		test("plain objects are allowed", () => {
			class M extends Model {
				data = { a: 1, b: { c: 2 } };
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({ a: 1, b: { c: 2 } });
		});

		test("arrays are allowed", () => {
			class M extends Model {
				items = [1, "two", { three: 3 }];
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.items).toEqual([1, "two", { three: 3 }]);
		});

		test("primitives are allowed", () => {
			class M extends Model {
				str = "hello";
				num = 42;
				bool = true;
				nil: null = null;
			}

			const m = M.create();
			const snapshot = toSnapshot(m);

			expect(snapshot.str).toBe("hello");
			expect(snapshot.num).toBe(42);
			expect(snapshot.bool).toBe(true);
			expect(snapshot.nil).toBe(null);
		});

		test("null prototype objects are allowed", () => {
			class M extends Model {
				data = Object.create(null);
			}

			const m = M.create();
			m.data.key = "value";
			const snapshot = toSnapshot(m);

			expect(snapshot.data).toEqual({ key: "value" });
		});
	});
});
