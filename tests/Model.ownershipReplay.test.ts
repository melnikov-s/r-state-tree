import {
	Model,
	applySnapshot,
	batch,
	child,
	findModelById,
	id,
	modelRef,
	onSnapshot,
	onSnapshotDiff,
	reaction,
	toSnapshot,
} from "../src/index";
import type { Snapshot, SnapshotDiff } from "../src/index";

class Task extends Model {
	@id id?: string;
	title = "";
}

class Board extends Model {
	@child(Task) backlog: Task[] = [];
	@child(Task) today: Task[] = [];
	@child(Task) pinned: Task | null = null;
	@modelRef(Task) selected?: Task;
	date = new Date(0);
}

const book = { id: "42", title: "book" };

test.each([false, true])(
	"replays an ownership move (reverse slot order: %s)",
	(reverse) => {
		const board = Board.create({
			backlog: [book, { id: "keep", title: "keep" }],
			today: [],
			selected: { id: "42" },
		});
		const before = toSnapshot(board);
		const retained = board.backlog[1];
		const history: SnapshotDiff<Board>[] = [];
		const stop = onSnapshotDiff(board, (diff) => history.push(diff));
		batch(() => board.today.push(board.backlog.shift()!));
		stop();
		const after = toSnapshot(board);
		expect(history).toHaveLength(1);

		const notifications: unknown[] = [];
		const stopObserving = reaction(
			() => [board.backlog, board.today, board.selected],
			() => {
				const task = board.backlog
					.concat(board.today)
					.find((task) => task.id === "42");
				expect(task?.parent).toBe(board);
				expect(board.selected).toBe(task);
				expect(findModelById(board, Task, "42")).toBe(task);
				notifications.push(toSnapshot(board));
			}
		);
		try {
			const apply = (snapshot: Snapshot<Board>) => {
				const { backlog, today } = structuredClone(snapshot);
				applySnapshot(board, reverse ? { today, backlog } : { backlog, today });
			};
			apply(history[0].undo);
			expect(toSnapshot(board)).toEqual(before);
			expect(board.backlog[1]).toBe(retained);
			apply(history[0].redo);
			expect(toSnapshot(board)).toEqual(after);
			expect(board.backlog[0]).toBe(retained);
			expect(notifications).toEqual([before, after]);
		} finally {
			stopObserving();
		}
	}
);

test("replays a swap across retained nested owners", () => {
	class Lane extends Model {
		@id id = "";
		@child(Task) task: Task | null = null;
	}
	class Project extends Model {
		@child(Lane) lanes: Lane[] = [];
	}
	const project = Project.create({
		lanes: [
			{ id: "left", task: book },
			{ id: "right", task: { id: "7", title: "send" } },
		],
	});
	const before = toSnapshot(project);
	const [left, right] = project.lanes;
	const history: SnapshotDiff<Project>[] = [];
	const stop = onSnapshotDiff(project, (diff) => history.push(diff));
	batch(() => {
		const l = left.task;
		const r = right.task;
		left.task = null;
		right.task = null;
		left.task = r;
		right.task = l;
	});
	stop();
	const after = toSnapshot(project);
	expect(history).toHaveLength(1);
	applySnapshot(project, history[0].undo);
	expect(toSnapshot(project)).toEqual(before);
	expect(left.task?.parent).toBe(left);
	expect(right.task?.parent).toBe(right);
	applySnapshot(project, history[0].redo);
	expect(toSnapshot(project)).toEqual(after);
	expect(project.lanes[0]).toBe(left);
	expect(project.lanes[1]).toBe(right);
});

test("rejects final conflicts and restores ownership on a late hydration error", () => {
	const board = Board.create({ today: [book], selected: { id: "42" } });
	const original = board.today[0];
	const before = toSnapshot(board);
	const observe = vi.fn();
	const stop = onSnapshot(board, observe);
	try {
		// Omission is not removal: the existing owner is still in the final tree.
		expect(() => applySnapshot(board, { backlog: [book] })).toThrow(
			/already assigned/
		);
		// The source is present in the patch, but still claims the same ID.
		expect(() =>
			applySnapshot(board, { backlog: [book], today: [book] })
		).toThrow(/already assigned/);
		// Releasing the old owner cannot make two new claims for its ID valid.
		expect(() =>
			applySnapshot(board, { backlog: [book], pinned: book, today: [] })
		).toThrow(/already assigned/);
		expect(() =>
			applySnapshot(board, { backlog: [book], today: [], date: "invalid" })
		).toThrow(/invalid ISO date/);
		expect(toSnapshot(board)).toEqual(before);
		expect(board.today[0]).toBe(original);
		expect(original.parent).toBe(board);
		expect(board.selected).toBe(original);
		expect(findModelById(board, Task, "42")).toBe(original);
		expect(observe).not.toHaveBeenCalled();
	} finally {
		stop();
	}
});

test("a first ID history entry replays on the recorded model without losing other batch edits", () => {
	const board = Board.create({
		today: [{ title: "before" }],
		selected: { id: "42" },
	});
	const task = board.today[0];
	const history: SnapshotDiff<Task>[] = [];
	const stop = onSnapshotDiff(task, (diff) => history.push(diff));
	batch(() => {
		task.id = "42";
		task.title = "after";
	});
	stop();
	expect(history).toHaveLength(1);
	const { undo, redo } = history[0];
	expect(() => applySnapshot(task, structuredClone(undo))).toThrow(
		/can't clear an id/
	);
	expect(() => applySnapshot(Task.create({ id: "42" }), undo)).toThrow(
		/can't clear an id/
	);
	expect(() => {
		task.id = undefined;
	}).toThrow(/can't clear an id/);
	for (let cycle = 0; cycle < 2; cycle++) {
		applySnapshot(task, undo);
		expect(task.id).toBeUndefined();
		expect(task.title).toBe("before");
		expect(board.selected).toBeUndefined();
		expect(findModelById(board, Task, "42")).toBeUndefined();
		applySnapshot(task, redo);
		expect(task.id).toBe("42");
		expect(task.title).toBe("after");
		expect(board.selected).toBe(task);
	}
	task.id = "renamed";
	expect(() => applySnapshot(task, undo)).toThrow(/can't clear an id/);
	expect(task.title).toBe("after");
});

test("an ancestor's history can recreate an unidentified child", () => {
	const board = Board.create({
		backlog: [{ title: "before" }, { id: "keep", title: "keep" }],
	});
	const [task, retained] = board.backlog;
	const before = toSnapshot(board);
	const history: SnapshotDiff<Board>[] = [];
	const stop = onSnapshotDiff(board, (diff) => history.push(diff));
	batch(() => {
		task.id = "42";
		task.title = "after";
		board.backlog.reverse();
	});
	stop();
	const after = toSnapshot(board);
	expect(history).toHaveLength(1);
	applySnapshot(board, structuredClone(history[0].undo));
	expect(toSnapshot(board)).toEqual(before);
	expect(board.backlog[1]).toBe(retained);
	expect(findModelById(board, Task, "42")).toBeUndefined();
	applySnapshot(board, structuredClone(history[0].redo));
	expect(toSnapshot(board)).toEqual(after);
	expect(board.backlog[0]).toBe(retained);
	// An omitted ID in an ordinary positional patch does not clear or recreate.
	const identified = board.backlog[1];
	applySnapshot(board, { backlog: [{ id: "keep" }, { title: "partial" }] });
	expect(board.backlog[1]).toBe(identified);
	expect(identified.id).toBe("42");
});

test("rollback restores an actual Model moved into a newly hydrated subtree", () => {
	class Lane extends Model {
		@child(Task) task: Task | null = null;
	}
	class Project extends Model {
		@child(Task) task: Task | null = Task.create(book);
		@child(Lane) lane: Lane | null = null;
		date = new Date(0);
	}
	const project = Project.create();
	const original = project.task!;
	const before = toSnapshot(project);
	// Runtime hydration also accepts actual Model instances in child slots.
	const move = {
		lane: { task: original },
		task: null,
	} as unknown as Snapshot<Project>;
	expect(() => applySnapshot(project, { ...move, date: "invalid" })).toThrow(
		/invalid ISO date/
	);
	expect(toSnapshot(project)).toEqual(before);
	expect(project.task).toBe(original);
	expect(original.parent).toBe(project);
	expect(findModelById(project, Task, "42")).toBe(original);
	applySnapshot(project, move);
	expect(project.lane?.task).toBe(original);
	expect(original.parent).toBe(project.lane);
});
