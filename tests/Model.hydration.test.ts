import {
	Model,
	id,
	child,
	toSnapshot,
	applySnapshot,
	onSnapshot,
	isObservable,
	observable,
} from "../src/index";

test("leaf creation captures snapshot inputs before writes and resumes after an observable field", () => {
	let constructing!: Leaf;
	const initialList = observable<number[]>([]);
	class Leaf extends Model {
		@id key = "initial";
		items = initialList;
		label = "";
		constructor() {
			super();
			constructing = this;
		}
	}
	const leaf = Leaf.create({
		key: "loaded",
		items: [1, 2],
		get label() {
			return constructing.key;
		},
	});
	expect(leaf.items).toBe(initialList);
	expect(toSnapshot(leaf)).toStrictEqual({
		key: "loaded",
		items: [1, 2],
		label: "initial",
	});
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
