/// <reference lib="dom" />
export type OperationRecord = {
	id: string;
	name: string;
	startedAt: number;
	durationMs: number;
	status: "pending" | "succeeded" | "failed" | "unobserved";
	/** Abort is a request, never evidence of cancellation or rollback. */
	abortRequested: boolean;
	error?: string;
};
export type OperationTimelineOptions = { maxEntries?: number };
export type OperationRunOptions = { signal?: AbortSignal };
const OBSERVATION_MS = 5 * 60 * 1000;

/** Explicit development-only recording. Labels/errors may be sensitive: use static labels.
 * No arguments, results, stacks, causes or application closures are stored in records.
 * Native promises (including cross-realm promises) are observed without replacing them.
 * Custom thenables are not assimilated; their outcome is marked unobserved.
 */
export function createOperationTimeline(
	options: OperationTimelineOptions = {}
) {
	const maxEntries = options.maxEntries ?? 100;
	if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 500)
		throw new Error("maxEntries must be an integer from 1 to 500");
	const records = new Map<string, OperationRecord>();
	const cleanup = new Map<string, () => void>();
	const listeners = new Set<() => void>();
	let sequence = 0;
	let disposed = false;
	const notify = () => {
		for (const listener of [...listeners]) {
			try {
				listener();
			} catch {
				/* Observation must not change application behavior. */
			}
		}
	};
	const release = (id: string) => {
		cleanup.get(id)?.();
		cleanup.delete(id);
	};
	const finish = (
		id: string,
		status: OperationRecord["status"],
		error?: unknown
	) => {
		const record = records.get(id);
		if (!record || record.status !== "pending") return;
		release(id);
		record.status = status;
		record.durationMs = Math.max(0, Date.now() - record.startedAt);
		if (status === "failed") {
			// Never stringify user objects or invoke their message/toString accessors.
			let message: unknown;
			try {
				message =
					typeof error === "string"
						? error
						: error && typeof error === "object"
							? Object.getOwnPropertyDescriptor(error, "message")?.value
							: undefined;
			} catch {
				/* Proxies and arbitrary thrown objects are not trusted. */
			}
			record.error =
				typeof message === "string"
					? message.slice(0, 500)
					: "Operation failed (details unavailable)";
		}
		notify();
	};
	const observe = (value: unknown, id: string) => {
		if (
			(typeof value !== "object" || value === null) &&
			typeof value !== "function"
		) {
			finish(id, "succeeded");
			return;
		}
		try {
			// Uses the Promise internal slot, not an arbitrary application .then getter.
			void Promise.prototype.then.call(
				value,
				() => finish(id, "succeeded"),
				(error: unknown) => finish(id, "failed", error)
			);
			return;
		} catch {
			/* Non-native promises/thenables are never executed by the recorder. */
		}
		try {
			let current = value;
			for (let depth = 0; current && depth < 16; depth++) {
				const descriptor = Object.getOwnPropertyDescriptor(current, "then");
				if (descriptor) {
					finish(
						id,
						descriptor.get || typeof descriptor.value === "function"
							? "unobserved"
							: "succeeded"
					);
					return;
				}
				current = Object.getPrototypeOf(current);
			}
			finish(id, current ? "unobserved" : "succeeded");
		} catch {
			finish(id, "unobserved");
		}
	};
	return {
		run<T>(name: string, work: () => T, options: OperationRunOptions = {}): T {
			if (typeof work !== "function")
				throw new Error("Expected operation work function");
			if (disposed) return work();
			if (typeof name !== "string" || !name.trim())
				throw new Error("Expected non-empty operation name");
			const signal = options.signal;
			if (
				signal !== undefined &&
				!(
					typeof signal.aborted === "boolean" &&
					typeof signal.addEventListener === "function" &&
					typeof signal.removeEventListener === "function"
				)
			)
				throw new Error("Expected AbortSignal");
			while (records.size >= maxEntries) {
				const oldest = records.keys().next().value!;
				release(oldest);
				records.delete(oldest);
			}
			const id = String(++sequence);
			records.set(id, {
				id,
				name: name.slice(0, 200),
				startedAt: Date.now(),
				durationMs: 0,
				status: "pending",
				abortRequested: signal?.aborted ?? false,
			});
			const aborted = () => {
				const record = records.get(id);
				if (record) {
					record.abortRequested = true;
					notify();
				}
			};
			signal?.addEventListener("abort", aborted, { once: true });
			const timer = setTimeout(() => finish(id, "unobserved"), OBSERVATION_MS);
			// Do not keep Node dev processes alive solely for observation.
			(timer as unknown as { unref?: () => void }).unref?.();
			cleanup.set(id, () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", aborted);
			});
			notify();
			try {
				const result = work();
				observe(result, id);
				return result;
			} catch (error) {
				finish(id, "failed", error);
				throw error;
			}
		},
		list(): readonly OperationRecord[] {
			return [...records.values()].reverse().map((record) => ({
				...record,
				durationMs:
					record.status === "pending"
						? Math.max(0, Date.now() - record.startedAt)
						: record.durationMs,
			}));
		},
		clear() {
			for (const id of cleanup.keys()) release(id);
			records.clear();
			notify();
		},
		subscribe(listener: () => void) {
			if (typeof listener !== "function") throw new Error("Expected listener");
			if (!disposed) listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispose() {
			disposed = true;
			for (const id of cleanup.keys()) release(id);
			records.clear();
			listeners.clear();
		},
	};
}
export type OperationTimeline = ReturnType<typeof createOperationTimeline>;
