import {
	applySnapshot,
	child,
	effect,
	findModelById,
	id,
	Model,
	modelRef,
	observable,
	toSnapshot,
} from "../src/index";

class User extends Model {
	@id id = "";
	name = "";
}

class LegacyTask extends Model {
	@modelRef(User) assignees: User[] = [];
}

class Project extends Model {
	@child(User) users: User[] = [];
	@child(LegacyTask) task = LegacyTask.create();
}

test("resolved modelRef membership cannot be mutated, but its models are live", () => {
	const {
		task,
		users: [ada, grace],
	} = Project.create({
		users: [
			{ id: "ada", name: "Ada" },
			{ id: "grace", name: "Grace" },
		],
	});
	task.assignees = [ada];
	const resolved = task.assignees;
	const before = toSnapshot(task);

	expect(resolved[0]).toBe(ada);
	expect(task.assignees).toBe(resolved);
	expect(() => resolved.push(grace)).toThrow(TypeError);
	expect(() => resolved.splice(0, 1)).toThrow(TypeError);
	expect(() => (resolved[0] = grace)).toThrow(TypeError);
	expect(() => (resolved.length = 0)).toThrow(TypeError);
	expect(task.assignees).toBe(resolved);
	expect(task.assignees).toEqual([ada]);
	expect(toSnapshot(task)).toBe(before);

	const names: string[] = [];
	const stop = effect(() => {
		names.push(task.assignees[0].name);
	});
	try {
		resolved[0].name = "Ada Lovelace";
		expect(ada.name).toBe("Ada Lovelace");
		expect(names).toEqual(["Ada", "Ada Lovelace"]);
	} finally {
		stop();
	}
});

test("legacy reference snapshots keep unresolved IDs until whole-field replacement", () => {
	const project = Project.create({ users: [{ id: "ada" }, { id: "grace" }] });
	const {
		task,
		users: [ada, grace],
	} = project;
	applySnapshot(task, { assignees: [{ id: "missing" }, { id: "ada" }] });
	expect(task.assignees).toEqual([ada]);
	expect(task.assignees[0]).toBe(ada);
	expect(JSON.stringify(toSnapshot(task))).toBe(
		'{"assignees":[{"id":"missing"},{"id":"ada"}]}'
	);

	const reloaded = Project.create(
		JSON.parse(JSON.stringify(toSnapshot(project)))
	);
	expect(reloaded.task.assignees).toEqual([reloaded.users[0]]);
	const restored = User.create({ id: "missing" });
	reloaded.users.push(restored);
	expect(reloaded.task.assignees).toEqual([restored, reloaded.users[0]]);
	expect(reloaded.task.assignees[0]).toBe(restored);

	task.assignees = [grace, ada];
	expect(task.assignees).toEqual([grace, ada]);
	expect(JSON.stringify(toSnapshot(task))).toBe(
		'{"assignees":[{"id":"grace"},{"id":"ada"}]}'
	);
});

test("observable assignee IDs can append Ada without dropping an unresolved ID", () => {
	class Task extends Model {
		assigneeIds = observable<string[]>([]);
	}
	class IdProject extends Model {
		@child(User) users: User[] = [];
		@child(Task) task = Task.create();
	}

	const project = IdProject.create({
		users: [{ id: "ada" }],
		task: { assigneeIds: ["missing"] },
	});
	const { task } = project;
	expect(findModelById(task, User, "missing")).toBeUndefined();
	expect(findModelById(task, User, "ada")).toBe(project.users[0]);
	expect(JSON.stringify(toSnapshot(task))).toBe('{"assigneeIds":["missing"]}');

	const ada = findModelById(task, User, "ada");
	if (ada) task.assigneeIds.push(ada.id);
	expect(JSON.stringify(toSnapshot(task))).toBe(
		'{"assigneeIds":["missing","ada"]}'
	);

	const reloaded = IdProject.create(
		JSON.parse(JSON.stringify(toSnapshot(project)))
	);
	expect(reloaded.task.assigneeIds).toEqual(["missing", "ada"]);
	const restored = User.create({ id: "missing" });
	reloaded.users.push(restored);
	expect(findModelById(reloaded.task, User, reloaded.task.assigneeIds[0])).toBe(
		restored
	);
});
