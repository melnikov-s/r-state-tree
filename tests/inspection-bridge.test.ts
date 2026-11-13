// @vitest-environment jsdom
import { connectViteInspector, type InspectorHot } from "../src/devtools";
import type { Inspector } from "../src/inspection/runtime";
import { CHANNEL } from "../src/inspection/protocol";

test("in-page bridge validates capabilities and targets, bounds Unicode bytes, reconnects and disposes without a panel", () => {
	const handlers = new Map<string, (value: unknown) => void>();
	const sent: { event: string; data: any }[] = [];
	let finalizer!: () => void;
	const hot: InspectorHot = {
		on(event, callback) {
			handlers.set(event, callback);
		},
		off(event) {
			handlers.delete(event);
		},
		send(event, data) {
			sent.push({ event, data });
		},
		dispose(callback) {
			finalizer = callback;
		},
	};
	const query = vi.fn((): any => ({ ok: true }));
	const disconnect = connectViteInspector(
		{ query } as unknown as Inspector,
		hot,
		"browser-capability"
	);
	const hello = sent[0].data;
	expect(hello.url).toBe(location.origin);
	const handle = handlers.get(CHANNEL + ":request")!;
	const request = { ...hello, id: "a", request: { op: "roots" } };
	handle({ ...request, token: "wrong" });
	handle({ ...request, tabId: "other" });
	expect(query).not.toHaveBeenCalled();
	handle(request);
	expect(sent.at(-1)?.data.response).toEqual({ value: { ok: true } });
	handle({ ...request, request: { op: "eval" } });
	expect(sent.at(-1)?.data.response.error).toContain("Inspection failed");
	query.mockReturnValue("界".repeat(400000));
	handle(request);
	expect(sent.at(-1)?.data.response.error).toContain("byte limit");
	const before = sent.length;
	handlers.get("vite:ws:connect")!({});
	expect(sent.length).toBe(before + 1);
	expect(sent.at(-1)?.data.tabId).toBe(hello.tabId);
	disconnect();
	finalizer();
	expect(handlers.size).toBe(0);
	const count = sent.length;
	handle(request);
	expect(sent.length).toBe(count);
});

test("bridge awaits async calls, correlates out-of-order results, contains rejections and drops replies after disposal", async () => {
	const handlers = new Map<string, (value: unknown) => void>();
	const sent: any[] = [];
	const hot: InspectorHot = {
		on: (event, callback) => {
			handlers.set(event, callback);
		},
		off: (event) => {
			handlers.delete(event);
		},
		send: (_event, frame) => {
			sent.push(frame);
		},
		dispose() {},
	};
	let resolve!: (value: any) => void;
	const query = vi.fn(
		(): any =>
			new Promise((r) => {
				resolve = r;
			})
	);
	const disconnect = connectViteInspector(
		{ query } as unknown as Inspector,
		hot,
		"capability"
	);
	const hello = sent[0];
	const handle = handlers.get(CHANNEL + ":request")!;
	const request = {
		...hello,
		id: "first",
		request: { op: "call", rootId: "root", method: "add", args: [1] },
	};
	handle(request);
	const first = resolve;
	handle({ ...request, id: "second" });
	resolve({ ok: true, result: 2 });
	await Promise.resolve();
	expect(sent.at(-1)).toMatchObject({
		id: "second",
		response: { value: { ok: true, result: 2 } },
	});
	first({ ok: true, result: 1 });
	await Promise.resolve();
	expect(sent.at(-1)).toMatchObject({
		id: "first",
		response: { value: { ok: true, result: 1 } },
	});
	query.mockImplementationOnce(() =>
		Promise.reject(new Error("private-exception"))
	);
	handle({ ...request, id: "failed" });
	await Promise.resolve();
	expect(sent.at(-1)).toMatchObject({
		id: "failed",
		response: { error: expect.stringContaining("Inspection failed") },
	});
	expect(JSON.stringify(sent)).not.toContain("private-exception");
	handle({ ...request, id: "detached" });
	disconnect();
	const count = sent.length;
	resolve({ ok: true, result: 3 });
	await Promise.resolve();
	expect(sent.length).toBe(count);
});
