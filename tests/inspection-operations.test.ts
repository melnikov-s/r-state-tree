import {
	createOperationTimeline,
	createInspector,
} from "../devtools/src/devtools";
import { validateRequest } from "../devtools/src/inspection/protocol";
import { runInNewContext } from "node:vm";

afterEach(() => vi.useRealTimers());

test("operation run preserves sync values, receivers, thrown identity and promise identity", async () => {
	const timeline = createOperationTimeline();
	const receiver = {
		count: 0,
		add() {
			return ++this.count;
		},
	};
	expect(timeline.run("add", () => receiver.add())).toBe(1);
	const result = { privateResult: "not recorded" };
	expect(timeline.run("object", () => result)).toBe(result);
	const error = new Error("readable failure");
	try {
		timeline.run("throw", () => {
			throw error;
		});
	} catch (caught) {
		expect(caught).toBe(error);
	}
	const promise = Promise.resolve(result);
	expect(timeline.run("async", () => promise)).toBe(promise);
	await promise;
	const rejected = Promise.reject(error);
	expect(timeline.run("reject", () => rejected)).toBe(rejected);
	await expect(rejected).rejects.toBe(error);
	expect(timeline.list().map((record) => record.status)).toEqual([
		"failed",
		"succeeded",
		"failed",
		"succeeded",
		"succeeded",
	]);
	expect(timeline.list()[0].error).toBe("readable failure");
	expect(JSON.stringify(timeline.list())).not.toContain("privateResult");
	timeline.dispose();
});

test("cross-realm native promises are observed; custom thenables and accessors are never invoked", async () => {
	const timeline = createOperationTimeline();
	const foreign = runInNewContext("Promise.resolve(42)") as Promise<number>;
	expect(timeline.run("foreign", () => foreign)).toBe(foreign);
	await foreign;
	expect(timeline.list()[0].status).toBe("succeeded");
	const then = vi.fn();
	const thenable = { then };
	expect(timeline.run("thenable", () => thenable)).toBe(thenable);
	expect(then).not.toHaveBeenCalled();
	expect(timeline.list()[0].status).toBe("unobserved");
	const getter = vi.fn(() => {
		throw new Error("not called");
	});
	const accessor = Object.defineProperty({}, "then", { get: getter });
	expect(timeline.run("accessor", () => accessor)).toBe(accessor);
	expect(getter).not.toHaveBeenCalled();
	expect(timeline.list()[0].status).toBe("unobserved");
	timeline.dispose();
});

test("bounded snapshots and pending bookkeeping: eviction, clear, timeout, unsubscribe and disposal", async () => {
	vi.useFakeTimers();
	const timeline = createOperationTimeline({ maxEntries: 2 });
	const changed = vi.fn();
	const unsubscribe = timeline.subscribe(changed);
	const signal = new AbortController();
	const remove = vi.spyOn(signal.signal, "removeEventListener");
	let complete!: () => void;
	const never = new Promise<void>((resolve) => {
		complete = resolve;
	});
	timeline.run("first", () => never, { signal: signal.signal });
	timeline.run("second", () => new Promise(() => {}));
	timeline.run("third", () => new Promise(() => {}));
	expect(timeline.list().map((record) => record.name)).toEqual([
		"third",
		"second",
	]);
	expect(remove).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(2);
	const snapshot = timeline.list();
	snapshot[0].name = "changed";
	expect(timeline.list()[0].name).toBe("third");
	complete();
	await never;
	expect(timeline.list()).toHaveLength(2);
	vi.advanceTimersByTime(5 * 60 * 1000);
	expect(
		timeline.list().every((record) => record.status === "unobserved")
	).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
	unsubscribe();
	const before = changed.mock.calls.length;
	timeline.clear();
	expect(changed).toHaveBeenCalledTimes(before);
	expect(timeline.list()).toEqual([]);
	timeline.run("pending", () => new Promise(() => {}), {
		signal: signal.signal,
	});
	timeline.dispose();
	expect(vi.getTimerCount()).toBe(0);
	expect(timeline.run("after disposal", () => 7)).toBe(7);
	expect(timeline.list()).toEqual([]);
});

test("clear detaches pending signals and late rejection cannot resurrect history or leak rejection", async () => {
	vi.useFakeTimers();
	const timeline = createOperationTimeline();
	const controller = new AbortController();
	const remove = vi.spyOn(controller.signal, "removeEventListener");
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((_, fail) => {
		reject = fail;
	});
	timeline.run("pending", () => promise, { signal: controller.signal });
	timeline.clear();
	expect(remove).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
	// Intentionally no application rejection handler: the observer must handle it.
	reject(new Error("late error"));
	await Promise.resolve();
	expect(timeline.list()).toEqual([]);
	let complete!: () => void;
	const late = new Promise<void>((resolve) => {
		complete = resolve;
	});
	timeline.run("expires", () => late, { signal: controller.signal });
	vi.advanceTimersByTime(5 * 60 * 1000);
	expect(remove).toHaveBeenCalledTimes(2);
	complete();
	await late;
	expect(timeline.list()[0].status).toBe("unobserved");
	timeline.dispose();
});

test("abort only records the request; never skips work or claims rollback", async () => {
	const timeline = createOperationTimeline();
	const signal = new AbortController();
	signal.abort();
	const work = vi.fn(() => 123);
	expect(timeline.run("already aborted", work, { signal: signal.signal })).toBe(
		123
	);
	expect(work).toHaveBeenCalledOnce();
	expect(timeline.list()[0]).toMatchObject({
		status: "succeeded",
		abortRequested: true,
	});
	const pendingSignal = new AbortController();
	let complete!: () => void;
	const promise = new Promise<void>((resolve) => {
		complete = resolve;
	});
	timeline.run("pending abort", () => promise, {
		signal: pendingSignal.signal,
	});
	pendingSignal.abort();
	expect(timeline.list()[0]).toMatchObject({
		status: "pending",
		abortRequested: true,
	});
	complete();
	await promise;
	expect(timeline.list()[0]).toMatchObject({
		status: "succeeded",
		abortRequested: true,
	});
	timeline.dispose();
});

test("inputs, strings, error summaries and subscriber failures stay bounded and safe", () => {
	for (const maxEntries of [0, -1, 501, 1.5, NaN, Infinity])
		expect(() => createOperationTimeline({ maxEntries })).toThrow();
	const timeline = createOperationTimeline();
	const work = vi.fn();
	expect(() => timeline.run(" ", work)).toThrow();
	expect(work).not.toHaveBeenCalled();
	timeline.subscribe(() => {
		throw new Error("observer error");
	});
	expect(timeline.run("a".repeat(1000), () => 9)).toBe(9);
	expect(timeline.list()[0].name).toHaveLength(200);
	const getter = vi.fn();
	const thrown = Object.defineProperty({}, "message", { get: getter });
	expect(() =>
		timeline.run("unsafe error", () => {
			throw thrown;
		})
	).toThrow();
	expect(getter).not.toHaveBeenCalled();
	expect(timeline.list()[0].error).toContain("details unavailable");
	expect(() =>
		timeline.run("long error", () => {
			throw new Error("e".repeat(1000));
		})
	).toThrow();
	expect(timeline.list()[0].error).toHaveLength(500);
	timeline.dispose();
});

test("inspector operations are explicit, read-only by default and redacted on synthetic paths", () => {
	const timeline = createOperationTimeline();
	timeline.run("private operation", () => 1);
	try {
		timeline.run("failure", () => {
			throw new Error("private exception");
		});
	} catch {
		/* expected */
	}
	const inspector = createInspector({ operations: timeline });
	expect(inspector.query({ op: "operations" })).toMatchObject({
		enabled: true,
		canClear: false,
		records: [{ error: "private exception" }, {}],
	});
	expect(() => inspector.query({ op: "clearOperations" })).toThrow();
	expect(timeline.list()).toHaveLength(2);
	const paths: readonly string[][] = [];
	const redacted = createInspector({
		operations: timeline,
		redact(path) {
			(paths as string[][]).push([...path]);
			return path[0] === "$operations" && ["name", "error"].includes(path[2]);
		},
	});
	const text = JSON.stringify(redacted.query({ op: "operations" }));
	expect(text).not.toContain("private operation");
	expect(text).not.toContain("private exception");
	expect(text).toContain("[redacted]");
	expect(paths).toContainEqual(["$operations", "2", "error"]);
	const hidden = createInspector({
		operations: timeline,
		controls: true,
		redact: (path) => path[0] === "$operations",
	});
	expect(hidden.query({ op: "operations" })).toMatchObject({
		redacted: true,
		records: [],
	});
	expect(() => hidden.query({ op: "clearOperations" })).toThrow();
	const controls = createInspector({ operations: timeline, controls: true });
	expect(controls.query({ op: "clearOperations" })).toEqual({ ok: true });
	expect(timeline.list()).toEqual([]);
	inspector.dispose();
	redacted.dispose();
	hidden.dispose();
	controls.dispose();
	timeline.dispose();
	expect(() => inspector.query({ op: "operations" })).toThrow("disposed");
	expect(createInspector().query({ op: "operations" })).toEqual({
		enabled: false,
		canClear: false,
		records: [],
	});
	for (const op of ["operations", "clearOperations"]) {
		expect(() => validateRequest({ op })).not.toThrow();
		expect(() => validateRequest({ op, rootId: "unrelated" })).toThrow();
	}
});
