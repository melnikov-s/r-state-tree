import {
	subscribeDebug,
	type DebugEvent,
} from "../../../src/observables/internal/debug";
import { untracked } from "../../../src/observables/preact";
import { getSource } from "../../../src/observables/internal/lookup";
import type { OperationRecord } from "./operations";

export type ActivityOptions = {
	maxEntries?: number;
	/** Retain the write event but omit its values (for document text, for example). */
	redactValues?: (path: readonly string[]) => boolean;
};
export type ActivityLocation = {
	rootId: string;
	rootName: string;
	path: string[];
};
export type ActivityRecord = OperationRecord & {
	kind: "method" | "write" | "batch";
	rootId?: string;
	rootName?: string;
	path?: string[];
	batchId?: string;
	parentId?: string;
	operation?: string;
	before?: string | number | boolean | null;
	after?: string | number | boolean | null;
};

/** Values are shallow summaries: never invoke getters, stringify objects, or retain app objects. */
function summary(value: unknown): string | number | boolean | null {
	if (value === null) return null;
	if (typeof value === "string") return value.slice(0, 160);
	if (typeof value === "boolean") return value;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : String(value);
	if (typeof value === "undefined") return "[undefined]";
	if (typeof value === "function") return "[Function]";
	if (typeof value !== "object") return `[${typeof value}]`;
	return Array.isArray(value) ? "[Array]" : "[Object]";
}

export function createActivityRecorder(
	options: ActivityOptions,
	locate: (target: object, mutation: boolean) => ActivityLocation | undefined,
	methodName: (target: object, fn: Function) => string | undefined,
	visible: (location: ActivityLocation) => boolean
) {
	if (process.env.NODE_ENV === "production")
		throw new Error("Activity recording is for development only");
	const maxEntries = options.maxEntries ?? 200;
	if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 500)
		throw new Error("activity.maxEntries must be an integer from 1 to 500");
	const records = new Map<string, ActivityRecord>();
	const calls = new Map<number, string>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	let sequence = 0;
	let generation = 0;
	let disposed = false;
	const release = (id: string) => {
		clearTimeout(timers.get(id));
		timers.delete(id);
		for (const [call, record] of calls) if (record === id) calls.delete(call);
	};
	const add = (record: ActivityRecord) => {
		while (records.size >= maxEntries) {
			const oldest = records.keys().next().value!;
			release(oldest);
			records.delete(oldest);
		}
		records.set(record.id, record);
	};
	const finish = (id: string, status: OperationRecord["status"]) => {
		const record = records.get(id);
		if (disposed || !record || record.status !== "pending") return;
		record.status = status;
		record.durationMs = Math.max(0, Date.now() - record.startedAt);
		release(id);
	};
	const receive = (event: DebugEvent) => {
		if (event.type === "batch-end") {
			finish(`batch-${event.batchId}`, event.failed ? "failed" : "succeeded");
			return;
		}
		if (event.type === "return") {
			const id = calls.get(event.callId);
			if (!id) return;
			calls.delete(event.callId);
			if (event.failed) {
				finish(id, "failed");
				return;
			}
			if (
				event.result === null ||
				(typeof event.result !== "object" && typeof event.result !== "function")
			) {
				finish(id, "succeeded");
				return;
			}
			// Most methods return ordinary objects. Do not throw a Promise brand-check
			// TypeError for every lookup: inspect descriptors first, never .then getters.
			let then: PropertyDescriptor | undefined;
			try {
				let current: object | null = event.result;
				for (let depth = 0; current && depth < 16; depth++) {
					then = Object.getOwnPropertyDescriptor(current, "then");
					if (then) break;
					current = Object.getPrototypeOf(current);
				}
				if (!then) {
					finish(id, current ? "unobserved" : "succeeded");
					return;
				}
			} catch {
				finish(id, "unobserved");
				return;
			}
			const epoch = generation;
			try {
				// Observe native promises only; never execute arbitrary .then accessors.
				void Promise.prototype.then.call(
					event.result,
					() => {
						if (generation === epoch) finish(id, "succeeded");
					},
					() => {
						if (generation === epoch) finish(id, "failed");
					}
				);
				const timer = setTimeout(() => finish(id, "unobserved"), 5 * 60 * 1000);
				(timer as unknown as { unref?: () => void }).unref?.();
				timers.set(id, timer);
			} catch {
				finish(
					id,
					then.get || typeof then.value === "function"
						? "unobserved"
						: "succeeded"
				);
			}
			return;
		}
		if (
			!event.target ||
			(typeof event.target !== "object" && typeof event.target !== "function")
		)
			return;
		const location = locate(getSource(event.target), event.type === "write");
		if (!location) return;
		const key =
			event.type === "call"
				? methodName(event.target, event.fn)
				: typeof event.key === "string" || typeof event.key === "number"
					? String(event.key)
					: undefined;
		// Object/symbol collection keys have no safe inspectable/redactable path.
		if (key === undefined) return;
		const at = { ...location, path: [...location.path, key] };
		if (!visible(at)) return;
		const valuesRedacted =
			event.type === "write" && options.redactValues?.(at.path);
		const now = Date.now();
		const batch =
			event.batchId === undefined ? undefined : `batch-${event.batchId}`;
		if (batch && !records.has(batch))
			add({
				id: batch,
				kind: "batch",
				name: "Batch",
				startedAt: now,
				durationMs: 0,
				status: "pending",
				abortRequested: false,
			});
		const id = `activity-${++sequence}`;
		add({
			id,
			...at,
			kind: event.type === "call" ? "method" : "write",
			name: key.slice(0, 200),
			startedAt: now,
			durationMs: 0,
			status: event.type === "call" ? "pending" : "succeeded",
			abortRequested: false,
			...(batch ? { batchId: batch } : {}),
			...(event.type === "call"
				? {
						parentId:
							event.parentId === undefined
								? undefined
								: calls.get(event.parentId),
					}
				: {
						parentId:
							event.callId === undefined ? undefined : calls.get(event.callId),
						operation: event.operation,
						before: valuesRedacted ? "[redacted]" : summary(event.before),
						after: valuesRedacted ? "[redacted]" : summary(event.after),
					}),
		});
		if (event.type === "call") calls.set(event.callId, id);
	};
	let unsubscribe: (() => void) | undefined;
	const stop = () => {
		unsubscribe?.();
		unsubscribe = undefined;
	};
	const clear = () => {
		generation++;
		for (const id of timers.keys()) release(id);
		calls.clear();
		records.clear();
	};
	return {
		start() {
			if (!disposed && !unsubscribe)
				unsubscribe = subscribeDebug((event) =>
					untracked(() => receive(event))
				);
		},
		stop,
		list(): ActivityRecord[] {
			return [...records.values()]
				.filter(
					(record) => !record.rootId || visible(record as ActivityLocation)
				)
				.reverse()
				.map((record) => ({
					...record,
					...(record.path ? { path: [...record.path] } : {}),
					...(record.kind === "write" &&
					record.path &&
					options.redactValues?.(record.path)
						? { before: "[redacted]", after: "[redacted]" }
						: {}),
					durationMs:
						record.status === "pending"
							? Math.max(0, Date.now() - record.startedAt)
							: record.durationMs,
				}));
		},
		clear,
		dispose() {
			disposed = true;
			stop();
			clear();
		},
	};
}
