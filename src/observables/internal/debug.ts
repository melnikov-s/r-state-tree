import { batch as signalsBatch } from "@preact/signals-core";

/** Internal, opt-in debugger hooks. No history or serialization lives in the runtime. */
export type DebugEvent =
	| { type: "batch-end"; batchId: number; failed: boolean }
	| {
			type: "call";
			target: object;
			fn: Function;
			callId: number;
			parentId?: number;
			batchId?: number;
	  }
	| { type: "return"; callId: number; result?: unknown; failed: boolean }
	| {
			type: "write";
			target: object;
			key: unknown;
			operation: string;
			before: unknown;
			after: unknown;
			batchId?: number;
			callId?: number;
	  };

const listeners = new Set<(event: DebugEvent) => void>();
export let debugEnabled = false;
// Stable identity, including callers that saved `batch` before enabling recording.
export const batch: typeof signalsBatch = (work) =>
	debugEnabled ? debugBatch(() => signalsBatch(work)) : signalsBatch(work);
let delivering = false;
let sequence = 0;
let batchId: number | undefined;
let callId: number | undefined;

export function isDebugRecording(): boolean {
	return debugEnabled && !delivering;
}
export function subscribeDebug(
	listener: (event: DebugEvent) => void
): () => void {
	if (process.env.NODE_ENV === "production")
		throw new Error("Activity recording is for development only");
	listeners.add(listener);
	debugEnabled = true;
	return () => {
		listeners.delete(listener);
		if (!listeners.size) debugEnabled = false;
	};
}
function emit(event: DebugEvent): void {
	if (delivering) return;
	delivering = true;
	try {
		for (const listener of listeners) {
			try {
				listener(event);
			} catch {
				/* Debuggers must not change app behavior. */
			}
		}
	} finally {
		delivering = false;
	}
}
export function debugBatch<T>(work: () => T): T {
	if (!isDebugRecording() || batchId !== undefined) return work();
	const id = ++sequence;
	batchId = id;
	let failed = true;
	try {
		const result = work();
		failed = false;
		return result;
	} finally {
		batchId = undefined;
		emit({ type: "batch-end", batchId: id, failed });
	}
}
export function debugCall<T>(target: object, fn: Function, work: () => T): T {
	if (!isDebugRecording()) return work();
	const parentId = callId;
	const id = ++sequence;
	callId = id;
	emit({ type: "call", target, fn, callId: id, parentId, batchId });
	try {
		const result = work();
		emit({ type: "return", callId: id, result, failed: false });
		return result;
	} catch (error) {
		emit({ type: "return", callId: id, failed: true });
		throw error;
	} finally {
		callId = parentId;
	}
}
export function debugWrite(
	target: object,
	key: unknown,
	operation: string,
	before: unknown,
	after: unknown
): void {
	if (isDebugRecording())
		emit({
			type: "write",
			target,
			key,
			operation,
			before,
			after,
			batchId,
			callId,
		});
}
