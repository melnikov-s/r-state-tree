import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";

const source = readFileSync("devtools/extension/content.js", "utf8");
afterEach(() => vi.useRealTimers());
function fixture(url = "http://127.0.0.1:5198") {
	vi.useFakeTimers();
	let receive!: (event: any) => void,
		message!: (frame: any, sender: any, reply: any) => any;
	const postMessage = vi.fn(),
		sendMessage = vi.fn().mockResolvedValue(undefined);
	const window = {
		addEventListener(_name: string, callback: any) {
			receive = callback;
		},
		postMessage,
	};
	runInNewContext(source, {
		window,
		location: new URL(url),
		TextEncoder,
		crypto: { randomUUID },
		setTimeout,
		clearTimeout,
		chrome: {
			runtime: {
				id: "extension",
				sendMessage,
				onMessage: {
					addListener(callback: any) {
						message = callback;
					},
				},
			},
		},
	});
	const request = (frame: any, sender = { id: "extension" }) => {
		const reply = vi.fn();
		const result = message(
			{ source: "r-state-tree:panel", ...frame },
			sender,
			reply
		);
		return { reply, result, posted: postMessage.mock.calls.at(-1)?.[0] };
	};
	const respond = (
		frame: object,
		origin = new URL(url).origin,
		eventSource: any = window
	) => {
		receive({
			source: eventSource,
			origin,
			data: { source: "r-state-tree:page", version: 1, ...frame },
		});
	};
	return { request, respond, postMessage, sendMessage, installed: !!message };
}
test("isolated content bridge installs only for loopback http(s); rejects external senders and unbounded requests", () => {
	expect(fixture("https://example.com").installed).toBe(false);
	expect(fixture("file:///tmp/app.html").installed).toBe(false);
	const f = fixture();
	f.request({ type: "discover" }, { id: "other-extension" });
	f.request({ type: "eval" });
	expect(f.postMessage).not.toHaveBeenCalled();
	const large = f.request({
		type: "query",
		instanceId: "a",
		request: { value: "界".repeat(400000) },
	});
	expect(large.reply).toHaveBeenCalledWith({
		error: "Request exceeds transport byte limit",
	});
	expect(f.postMessage).not.toHaveBeenCalled();
});
test("discovery isolates origins/sources, deduplicates and bounds instances, and queries bind replies to the selected instance", () => {
	const f = fixture();
	const discovery = f.request({ type: "discover" });
	const frame = {
		id: discovery.posted.id,
		type: "instance",
		instanceId: "a",
		title: "App",
		url: "http://127.0.0.1:5198",
	};
	f.respond(frame, "https://attacker.example");
	f.respond(frame, undefined, {});
	f.respond({ ...frame, url: "https://attacker.example" });
	f.respond({ ...frame, id: "wrong" });
	f.respond(frame);
	f.respond(frame);
	vi.advanceTimersByTime(150);
	expect(discovery.reply).toHaveBeenCalledExactlyOnceWith({
		instances: [
			{ instanceId: "a", title: "App", url: "http://127.0.0.1:5198" },
		],
	});
	const query = f.request({
		type: "query",
		instanceId: "a",
		request: { op: "roots" },
	});
	f.respond({
		id: query.posted.id,
		type: "response",
		instanceId: "b",
		response: { value: "wrong" },
	});
	f.respond({
		id: query.posted.id,
		type: "response",
		instanceId: "a",
		response: { value: "wrong", error: "bad" },
	});
	expect(query.reply).not.toHaveBeenCalled();
	f.respond({
		id: query.posted.id,
		type: "response",
		instanceId: "a",
		response: { value: { roots: [] } },
	});
	expect(query.reply).toHaveBeenCalledExactlyOnceWith({ value: { roots: [] } });
	vi.advanceTimersByTime(6000);
	expect(query.reply).toHaveBeenCalledTimes(1);
});
test("pending requests and timeouts are bounded; control requests are never retried", () => {
	const f = fixture();
	const calls = Array.from({ length: 32 }, () =>
		f.request({ type: "query", instanceId: "a", request: { op: "call" } })
	);
	const excess = f.request({ type: "discover" });
	expect(excess.reply).toHaveBeenCalledWith({
		error: "Too many outstanding inspection requests",
	});
	expect(f.postMessage).toHaveBeenCalledTimes(32);
	vi.advanceTimersByTime(6000);
	for (const call of calls)
		expect(call.reply).toHaveBeenCalledExactlyOnceWith({
			error: expect.stringContaining("Control may already have run"),
		});
	expect(f.postMessage).toHaveBeenCalledTimes(32);
	f.request({ type: "discover" });
	expect(f.postMessage).toHaveBeenCalledTimes(33);
});
