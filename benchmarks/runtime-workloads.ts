import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
	applySnapshot,
	batch,
	child,
	computed,
	createStore,
	findModelById,
	id,
	Model,
	mount,
	observable,
	onSnapshot,
	reaction,
	snapshot,
	Store,
	toSnapshot,
	type StoreSnapshot,
} from "../src/index.js";

export type Counters = Record<string, number>;
export type Sample = {
	run(): void;
	verify(): Counters;
	dispose(): void;
};
export type Workload = {
	id: string;
	operation: string;
	phase: "fresh" | "steady";
	parameters: Record<string, number>;
	iterations: number;
	prepare(iterations: number): Sample;
};

const noop = () => {};
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const each = (n: number, fn: (i: number) => void) => {
	for (let i = 0; i < n; i++) fn(i);
};

const slots = 16;
function observableWrites(
	mode: "none" | "subscribers" | "computed" | "batch"
): Workload {
	return {
		id: `observable.write.${mode}`,
		operation: "one field, index and Map entry write",
		phase: "steady",
		parameters: { collectionSize: slots, writesPerOperation: 3 },
		iterations: 16_000,
		prepare(n) {
			const state = observable({ total: 0 });
			const rows = observable(range(slots).map(() => 0));
			const entries = observable(new Map(range(slots).map((i) => [i, 0])));
			let callbacks = 0;
			let evaluations = 0;
			let aggregate = 0;
			const seen = [0, 0, 0];
			const stops: (() => void)[] = [];
			if (mode === "subscribers") {
				[() => state.total, () => rows[0], () => entries.get(0)].forEach(
					(read, i) => {
						stops.push(
							reaction(read, (v) => {
								callbacks++;
								seen[i] = v!;
							})
						);
					}
				);
			} else if (mode !== "none") {
				const total = computed(() => {
					evaluations++;
					let value = state.total + entries.get(0)!;
					for (let i = 0; i < slots; i++) value += rows[i];
					return value;
				});
				stops.push(
					reaction(
						() => total.value,
						(v) => {
							callbacks++;
							aggregate = v;
						}
					)
				);
			}
			function write(i: number) {
				state.total = i + 1;
				rows[0] = (i + 1) * 2;
				entries.set(0, (i + 1) * 3);
			}
			return {
				run() {
					if (mode === "batch") each(n, (i) => batch(() => write(i)));
					else each(n, write);
				},
				verify() {
					const values = [n, n * 2, n * 3];
					assert.deepEqual([state.total, rows[0], entries.get(0)], values);
					assert.equal(
						callbacks,
						mode === "none" ? 0 : mode === "batch" ? n : n * 3
					);
					assert.equal(
						evaluations,
						mode === "batch" || mode === "computed" ? callbacks + 1 : 0
					);
					if (mode === "subscribers") assert.deepEqual(seen, values);
					if (evaluations) assert.equal(aggregate, n * 6);
					return { writes: n * 3, callbacks, computedEvaluations: evaluations };
				},
				dispose() {
					stops.forEach((stop) => stop());
				},
			};
		},
	};
}

class Document extends Model {
	@id id = "";
	title = "";
	value = 0;
	revision = 0;
}

class Documents extends Model {
	@child(Document) items = observable<Document[]>([]);
}

class Folders extends Model {
	@child(Documents) groups = observable<Documents[]>([]);
}

function documentData(i: number) {
	return { id: `doc-${i}`, title: `Document ${i}`, value: i, revision: 0 };
}

const modelSize = 256;
const groupSize = 32;
const groupCount = modelSize / groupSize;
const wideData = { items: range(modelSize).map(documentData) };
const nestedData = {
	groups: range(groupCount).map((g) => ({
		items: wideData.items.slice(g * groupSize, (g + 1) * groupSize),
	})),
};
const nestedEdited = {
	groups: nestedData.groups.map(({ items }) => ({
		items: items.map((item) => ({ ...item, value: -item.value - 1 })),
	})),
};

function modelCreation(nested: boolean): Workload {
	return {
		id: `model.create.${nested ? "nested" : "wide"}`,
		operation: "Model.create from snapshot",
		phase: "fresh",
		parameters: { documents: modelSize, folders: nested ? groupCount : 0 },
		iterations: 32,
		prepare(n) {
			const roots: (Documents | Folders)[] = [];
			return {
				run() {
					each(n, () =>
						roots.push(
							nested ? Folders.create(nestedData) : Documents.create(wideData)
						)
					);
				},
				verify() {
					assert.equal(roots.length, n);
					for (const root of roots) {
						assert.deepEqual(toSnapshot(root), nested ? nestedData : wideData);
						const last = findModelById(root, Document, `doc-${modelSize - 1}`);
						const owner = root instanceof Folders ? root.groups.at(-1)! : root;
						assert.ok(last);
						assert.equal(last, owner.items.at(-1));
						assert.equal(last.parent, owner);
					}
					return {
						roots: roots.length,
						hydratedDocuments: modelSize * roots.length,
					};
				},
				dispose() {
					roots.forEach((root) => root[Symbol.dispose]());
				},
			};
		},
	};
}

const modelHydration: Workload = {
	id: "model.apply.nested",
	operation: "apply a full snapshot to an existing keyed tree",
	phase: "steady",
	parameters: { documents: modelSize, folders: groupCount },
	iterations: 12,
	prepare(n) {
		const root = Folders.create(nestedData);
		const before = root.groups.flatMap((group) => [...group.items]);
		return {
			run() {
				each(n, (i) => {
					applySnapshot(root, i % 2 ? nestedData : nestedEdited);
				});
			},
			verify() {
				assert.deepEqual(toSnapshot(root), n % 2 ? nestedEdited : nestedData);
				let reused = 0;
				for (const item of root.groups.flatMap((group) => [...group.items])) {
					assert.equal(item, before[reused++]);
				}
				assert.equal(reused, modelSize);
				return { snapshotApplications: n, verifiedReusedDocuments: reused };
			},
			dispose() {
				root[Symbol.dispose]();
			},
		};
	},
};

const modelLookup: Workload = {
	id: "model.lookup.nested",
	operation: "findModelById lookup",
	phase: "steady",
	parameters: { documents: modelSize, folders: groupCount },
	iterations: 200_000,
	prepare(n) {
		const root = Folders.create(nestedData);
		const docs = root.groups.flatMap((group) => [...group.items]);
		const keys = range(modelSize).map(
			(i) => wideData.items[(i * 97) % modelSize].id
		);
		let checksum = 0;
		return {
			run() {
				each(n, (i) => {
					checksum += findModelById(root, Document, keys[i % modelSize])!.value;
				});
			},
			verify() {
				let expected = 0;
				each(n, (i) => {
					expected += (i * 97) % modelSize;
				});
				assert.equal(checksum, expected);
				for (const item of docs)
					assert.equal(findModelById(root, Document, item.id), item);
				assert.equal(findModelById(root, Document, "missing"), undefined);
				return { lookups: n, checksum };
			},
			dispose() {
				root[Symbol.dispose]();
			},
		};
	},
};

class Slot extends Model {
	@child branch: Documents | null = null;
}

const modelTransfer: Workload = {
	id: "model.transfer.branch",
	operation: "detach branch and attach it to the other root",
	phase: "steady",
	parameters: { documents: groupSize, roots: 2 },
	iterations: 600,
	prepare(n) {
		const roots = [Slot.create(), Slot.create()];
		const branch = Documents.create(nestedData.groups[0]);
		roots[0].branch = branch;
		const item = branch.items[0];
		let callbacks = 0;
		let attached = 0;
		const stop = reaction(
			() => branch.parent,
			(parent) => {
				callbacks++;
				if (parent) attached++;
			}
		);
		return {
			run() {
				each(n, (i) => {
					roots[i % 2].branch = null;
					roots[1 - (i % 2)].branch = branch;
				});
			},
			verify() {
				assert.equal(branch.parent, roots[n % 2]);
				assert.equal(findModelById(roots[n % 2], Document, item.id), item);
				assert.equal(
					findModelById(roots[1 - (n % 2)], Document, item.id),
					undefined
				);
				assert.equal(callbacks, n * 2);
				assert.equal(attached, n);
				return {
					parentCallbacks: callbacks,
					attached,
					detached: callbacks - attached,
				};
			},
			dispose() {
				stop();
				roots.forEach((root) => root[Symbol.dispose]());
			},
		};
	},
};

const storeSize = 128;
const storeKeys = range(storeSize);
const reverseKeys = [...storeKeys].reverse();
const replacementKeys = storeKeys.map((i) => i + storeSize);
type Lifecycle = { getterRuns: number; constructed: number; cleaned: number };

class Row extends Store<{ counts: Lifecycle }> {
	constructor(props: Row["props"]) {
		super(props);
		const counts = props.counts;
		counts.constructed++;
		this.effect(() => () => {
			counts.cleaned++;
		});
	}
}

class Rows extends Store<{ counts: Lifecycle }> {
	keys = storeKeys;

	@child get items() {
		const counts = this.props.counts;
		counts.getterRuns++;
		return this.keys.map((key) => createStore(Row, { key, counts }));
	}
}

function storeWork(
	mode: "mount" | "realize" | "reads" | "reorder" | "replace" | "dispose"
): Workload {
	const fresh = mode === "mount" || mode === "realize" || mode === "dispose";
	return {
		id: `store.children.${mode}`,
		operation: {
			mount: "mount root descriptor (leave child list unopened)",
			realize: "first child list read after mount",
			reads: "traverse list via repeated getter and indexed reads",
			reorder: "reverse realized list, reusing keys",
			replace: "swap a disjoint set of keys into realized list",
			dispose: "dispose root with realized list",
		}[mode],
		phase: fresh ? "fresh" : "steady",
		parameters: { children: storeSize },
		iterations: {
			mount: 600,
			realize: 32,
			reads: 4_000,
			reorder: 100,
			replace: 36,
			dispose: 32,
		}[mode],
		prepare(n) {
			const counts: Lifecycle = { getterRuns: 0, constructed: 0, cleaned: 0 };
			const create = () => mount(createStore(Rows, { counts }));
			const roots: Rows[] =
				mode === "mount" ? [] : range(fresh ? n : 1).map(create);
			const before =
				mode === "dispose" || !fresh
					? roots.map((root) => [...root.items])
					: [];
			const realized: Row[][] = [];
			const root = roots[0];
			let checksum = 0;
			if (mode === "realize") assert.equal(counts.getterRuns, 0);
			return {
				run() {
					if (mode === "mount") each(n, () => roots.push(create()));
					else if (mode === "realize")
						roots.forEach((r) => realized.push(r.items));
					else if (mode === "dispose")
						roots.forEach((r) => r[Symbol.dispose]());
					else if (mode === "reads")
						each(n, () => {
							for (let i = 0; i < root.items.length; i++)
								checksum += root.items[i].key as number;
						});
					else
						each(n, (i) => {
							root.keys =
								i % 2
									? storeKeys
									: mode === "reorder"
										? reverseKeys
										: replacementKeys;
						});
				},
				verify() {
					const expectedRuns =
						mode === "mount" ? 0 : fresh ? n : mode === "reads" ? 1 : n + 1;
					const expectedConstructed =
						(mode === "replace"
							? n + 1
							: mode === "mount"
								? 0
								: fresh
									? n
									: 1) * storeSize;
					const expectedCleaned =
						(mode === "replace" || mode === "dispose" ? n : 0) * storeSize;
					let reused = 0;
					if (mode === "reads" || mode === "reorder" || mode === "replace") {
						const keys =
							n % 2 && mode === "reorder"
								? reverseKeys
								: n % 2 && mode === "replace"
									? replacementKeys
									: storeKeys;
						assert.deepEqual(
							root.items.map((row) => row.key),
							keys
						);
						for (const [i, row] of root.items.entries()) {
							assert.equal(row.signal.aborted, false);
							if (mode !== "replace") {
								assert.equal(row, before[0][keys[i]]);
								reused++;
							} else assert.equal(before[0][i].signal.aborted, true);
						}
					} else if (mode === "realize") {
						assert.equal(realized.length, n);
						for (const rows of realized)
							assert.deepEqual(
								rows.map((row) => row.key),
								storeKeys
							);
					} else {
						assert.equal(roots.length, n);
						for (const r of roots)
							assert.equal(r.signal.aborted, mode === "dispose");
						for (const row of before.flat())
							assert.equal(row.signal.aborted, true);
					}
					assert.deepEqual(counts, {
						getterRuns: expectedRuns,
						constructed: expectedConstructed,
						cleaned: expectedCleaned,
					});
					assert.equal(
						checksum,
						mode === "reads" ? (n * storeSize * (storeSize - 1)) / 2 : 0
					);
					return { ...counts, verifiedReusedChildren: reused, checksum };
				},
				dispose() {
					for (const r of roots) if (!r.signal.aborted) r[Symbol.dispose]();
					assert.equal(
						counts.cleaned,
						counts.constructed,
						"all child effects cleaned up"
					);
				},
			};
		},
	};
}

function persistEdit(scope: "leaf" | "root" | "batched-root"): Workload {
	return {
		id: `persistence.edit.${scope}`,
		operation:
			"four writes to one leaf with synchronous snapshot JSON serialization",
		phase: "steady",
		parameters: { documents: modelSize, writesPerOperation: 4 },
		iterations: 160,
		prepare(n) {
			const root = Documents.create(wideData);
			const targetIndex = modelSize >> 1;
			const leaf = root.items[targetIndex];
			let callbacks = 0;
			let bytes = 0;
			let saved = "";
			function save(payload: unknown) {
				callbacks++;
				saved = JSON.stringify(payload);
				bytes += saved.length; // All fixture content is ASCII.
			}
			const stop =
				scope === "leaf" ? onSnapshot(leaf, save) : onSnapshot(root, save);
			const write = () => {
				leaf.value++;
				leaf.revision++;
				leaf.value++;
				leaf.revision++;
			};
			return {
				run() {
					each(n, scope === "batched-root" ? () => batch(write) : write);
				},
				verify() {
					assert.equal(callbacks, scope === "batched-root" ? n : n * 4);
					const expected = {
						...wideData.items[targetIndex],
						value: targetIndex + n * 2,
						revision: n * 2,
					};
					assert.deepEqual(toSnapshot(leaf), expected);
					const items = wideData.items.slice();
					items[targetIndex] = expected;
					assert.deepEqual(
						JSON.parse(saved),
						scope === "leaf" ? expected : { items }
					);
					return { writes: n * 4, callbacks, serializedBytes: bytes };
				},
				dispose() {
					stop();
					root[Symbol.dispose]();
				},
			};
		},
	};
}

const catalogSize = 64;
const editorCount = 8;
const catalog = wideData.items.slice(0, catalogSize);
const editorIds = catalog.slice(0, editorCount).map((item) => item.id);
const savedWorkspace: StoreSnapshot = {
	state: { editorIds },
	children: {
		editors: editorIds.map((key) => ({
			key,
			state: { draft: `Draft ${key}` },
		})),
	},
};
type WorkspaceCounts = {
	started: number;
	cleaned: number;
	active: number;
	peak: number;
	callbacks: number;
	unopened: number;
};

class Editor extends Store<{ document: Document; counts: WorkspaceCounts }> {
	@snapshot draft = "";

	constructor(props: Editor["props"]) {
		super(props);
		this.effect(() => {
			const { document, counts } = this.props;
			counts.started++;
			counts.peak = Math.max(counts.peak, ++counts.active);
			const stop = onSnapshot(document, () => {
				counts.callbacks++;
			});
			return () => {
				stop();
				counts.cleaned++;
				counts.active--;
			};
		});
	}
}

class Workspace extends Store<{
	documents: Documents;
	counts: WorkspaceCounts;
}> {
	@snapshot editorIds = observable<string[]>([]);

	@child get editors() {
		return this.editorIds.map((key) => {
			const document = findModelById(this.props.documents, Document, key);
			assert.ok(document, `Unknown document ${key}`);
			return createStore(Editor, { key, document, counts: this.props.counts });
		});
	}
}

const workspaceFlow: Workload = {
	id: "workspace.editor.cycle",
	operation:
		"mount saved workspace, open, reorder, edit, save, close and dispose",
	phase: "fresh",
	parameters: { documents: catalogSize, editors: editorCount },
	iterations: 48,
	prepare(n) {
		const documents = Documents.create({ items: catalog });
		const counts: WorkspaceCounts = {
			started: 0,
			cleaned: 0,
			active: 0,
			peak: 0,
			callbacks: 0,
			unopened: 0,
		};
		const firstDocument = documents.items[0];
		const secondDocument = documents.items[1];
		let saved = "";
		let reused = 0;
		let closed = 0;
		return {
			run() {
				each(n, (i) => {
					const startedBefore = counts.started;
					{
						using workspace = mount(
							createStore(Workspace, { documents, counts }),
							{ snapshot: savedWorkspace }
						);
						if (counts.started === startedBefore) counts.unopened++;
						const editors = [...workspace.editors];
						workspace.editorIds.reverse();
						for (let j = 0; j < editorCount; j++)
							if (workspace.editors[j] === editors[editorCount - j - 1])
								reused++;
						const first = editors[0];
						first.draft = `Edited draft ${i}`;
						first.props.document.title = `Renamed ${i}`;
						saved = JSON.stringify({
							documents: toSnapshot(documents),
							workspace: toSnapshot(workspace),
						});
						workspace.editorIds.pop();
						if (
							first.signal.aborted &&
							!editors[1].signal.aborted &&
							workspace.editors.length === editorCount - 1
						)
							closed++;
						firstDocument.revision++; // Closed editor must not receive this.
					}
					secondDocument.revision++; // No prior cycle's watchers may still be live.
				});
			},
			verify() {
				const reversed = [...editorIds].reverse();
				const expectedCatalog = catalog.slice();
				expectedCatalog[0] = {
					...catalog[0],
					title: `Renamed ${n - 1}`,
					revision: n - 1,
				};
				expectedCatalog[1] = { ...catalog[1], revision: n - 1 };
				assert.deepEqual(JSON.parse(saved), {
					documents: { items: expectedCatalog },
					workspace: {
						state: { editorIds: reversed },
						children: {
							editors: reversed.map((key) => ({
								key,
								state: {
									draft:
										key === editorIds[0]
											? `Edited draft ${n - 1}`
											: `Draft ${key}`,
								},
							})),
						},
					},
				});
				assert.deepEqual(counts, {
					started: n * editorCount,
					cleaned: n * editorCount,
					active: 0,
					peak: editorCount,
					callbacks: n,
					unopened: n,
				});
				assert.equal(reused, editorCount * n);
				assert.equal(closed, n);
				assert.equal(
					findModelById(documents, Document, firstDocument.id),
					firstDocument
				);
				assert.equal(firstDocument.revision, n);
				assert.equal(secondDocument.revision, n);
				return { ...counts, reused, closed };
			},
			dispose() {
				documents[Symbol.dispose]();
			},
		};
	},
};

const workloads: Workload[] = [
	observableWrites("none"),
	observableWrites("subscribers"),
	observableWrites("computed"),
	observableWrites("batch"),
	modelCreation(false),
	modelCreation(true),
	modelHydration,
	modelLookup,
	modelTransfer,
	storeWork("mount"),
	storeWork("realize"),
	storeWork("reads"),
	storeWork("reorder"),
	storeWork("replace"),
	storeWork("dispose"),
	persistEdit("leaf"),
	persistEdit("root"),
	persistEdit("batched-root"),
	workspaceFlow,
];

export type Sampling = { smoke: boolean; warmups: number; samples: number };

export const caseIds = workloads.map((workload) => workload.id);

export function measureCase(id: string, { smoke, warmups, samples }: Sampling) {
	const workload = workloads.find((workload) => workload.id === id);
	assert.ok(workload, `Unknown workload ${id}`);
	const iterations = smoke
		? Math.ceil(workload.iterations / 100)
		: workload.iterations;
	const durations: number[] = [];
	let counters: Counters | undefined;
	for (let i = -warmups; i < samples; i++) {
		const sample: Sample = workload.prepare(iterations);
		try {
			const start = performance.now();
			sample.run();
			const elapsed = performance.now() - start;
			const verified = sample.verify();
			if (counters)
				assert.deepEqual(verified, counters, `${id}: stable sample counters`);
			counters = verified;
			if (i >= 0) durations.push((elapsed * 1000) / iterations);
		} finally {
			sample.dispose();
		}
	}
	assert.ok(counters);
	durations.sort((a, b) => a - b);
	// Linear interpolation also works for small smoke sample counts.
	function percentile(p: number) {
		const index = p * (durations.length - 1);
		const low = Math.floor(index);
		const interpolated =
			durations[low] +
			(durations[Math.ceil(index)] - durations[low]) * (index - low);
		return +interpolated.toPrecision(5);
	}
	return {
		id,
		operation: workload.operation,
		phase: workload.phase,
		parameters: workload.parameters,
		iterations,
		usPerOperation: {
			median: percentile(0.5),
			p25: percentile(0.25),
			p75: percentile(0.75),
			min: percentile(0),
			max: percentile(1),
		},
		counters,
	};
}
