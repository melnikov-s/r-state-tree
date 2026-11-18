import {
	child,
	createStore,
	findModelById,
	id,
	Model,
	mount,
	observable,
	onSnapshot,
	snapshot,
	Store,
	toSnapshot,
	untracked,
	type Snapshot,
	type StoreSnapshot,
} from "../src/index";

test("round-trips lazy keyed editor drafts and closes editors without disposing their documents", () => {
	const starts: [id: string, draft: string][] = [];
	const changes: Snapshot<Document>[] = [];
	const cleanups: string[] = [];

	class Document extends Model {
		@id id = "";
		title = "";
	}

	class Documents extends Model {
		@child(Document) items = observable<Document[]>([]);
	}

	class Editor extends Store<{ document: Document }> {
		@snapshot draft = "";

		constructor(props: Editor["props"]) {
			super(props);
			this.effect(() => {
				const document = this.props.document;
				starts.push([document.id, untracked(() => this.draft)]);
				const stop = onSnapshot(document, (saved) => changes.push(saved));
				return () => {
					stop();
					cleanups.push(document.id);
				};
			});
		}
	}

	class Workspace extends Store<{ documents: Documents }> {
		@snapshot editorIds = observable<string[]>([]);

		@child get editors() {
			return this.editorIds.map((key) => {
				const document = findModelById(this.props.documents, Document, key);
				if (!document) throw new Error(`Missing document: ${key}`);
				return createStore(Editor, { key, document });
			});
		}
	}

	const savedDocuments = {
		items: [
			{ id: "a", title: "Document A" },
			{ id: "b", title: "Document B" },
		],
	};
	const savedWorkspace: StoreSnapshot = {
		state: { editorIds: ["a", "b"] },
		children: {
			editors: [
				{ key: "a", state: { draft: "first draft" } },
				{ key: "b", state: { draft: "second draft" } },
			],
		},
	};
	let saved: string;
	{
		using documents = Documents.create(savedDocuments);
		using unopened = mount(createStore(Workspace, { documents }), {
			snapshot: savedWorkspace,
		});
		const savedUnopened = JSON.stringify(toSnapshot(unopened));
		expect(JSON.parse(savedUnopened)).toEqual(savedWorkspace);
		expect(starts).toEqual([]);

		using workspace = mount(createStore(Workspace, { documents }), {
			snapshot: JSON.parse(savedUnopened),
		});
		expect(starts).toEqual([]);
		const [a, b] = workspace.editors;
		expect(starts).toEqual([
			["a", "first draft"],
			["b", "second draft"],
		]);
		const document = a.props.document;
		expect(document).toBe(findModelById(documents, Document, "a"));
		a.draft = "revised draft";
		document.title = "Renamed A";
		expect(changes).toEqual([{ id: "a", title: "Renamed A" }]);
		workspace.editorIds.reverse();
		expect(workspace.editors[0]).toBe(b);
		expect(workspace.editors[1]).toBe(a);
		expect(a.props.document).toBe(document);
		expect(starts).toHaveLength(2);
		expect(cleanups).toEqual([]);

		saved = JSON.stringify({
			documents: toSnapshot(documents),
			workspace: toSnapshot(workspace),
		});
	}

	const restored: { documents: Snapshot<Documents>; workspace: StoreSnapshot } =
		JSON.parse(saved);
	expect(restored).toEqual({
		documents: {
			items: [
				{ id: "a", title: "Renamed A" },
				{ id: "b", title: "Document B" },
			],
		},
		workspace: {
			state: { editorIds: ["b", "a"] },
			children: {
				editors: [
					{ key: "b", state: { draft: "second draft" } },
					{ key: "a", state: { draft: "revised draft" } },
				],
			},
		},
	});

	expect([...cleanups].sort()).toEqual(["a", "b"]);
	cleanups.length = 0;
	{
		using documents = Documents.create(restored.documents);
		using workspace = mount(createStore(Workspace, { documents }), {
			snapshot: restored.workspace,
		});
		expect(starts).toHaveLength(2);
		const [b, a] = workspace.editors;
		expect(starts.slice(2)).toEqual([
			["b", "second draft"],
			["a", "revised draft"],
		]);
		const document = a.props.document;
		expect(document.title).toBe("Renamed A");

		workspace.editorIds.pop();
		expect(a.signal.aborted).toBe(true);
		expect(b.signal.aborted).toBe(false);
		expect(workspace.editors[0]).toBe(b);
		expect(cleanups).toEqual(["a"]);

		documents.items.splice(documents.items.indexOf(document), 1);
		using detached = document;
		expect(findModelById(documents, Document, "a")).toBeUndefined();
		detached.title = "Detached A";
		expect(toSnapshot(detached)).toEqual({ id: "a", title: "Detached A" });
		expect(changes).toEqual([{ id: "a", title: "Renamed A" }]);
	}
	expect(cleanups).toEqual(["a", "b"]);
});
