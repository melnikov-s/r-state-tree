// @vitest-environment jsdom
import { connectExtensionBridge } from "../devtools/src/inspection/bridge";
import type { Inspector } from "../devtools/src/inspection/runtime";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	vi.restoreAllMocks();
});
function fixture(instanceId = "instance-a") {
	const query = vi.fn((): any => ({ roots: [] }));
	const dispose = connectExtensionBridge(
		{ query } as unknown as Inspector,
		instanceId
	);
	cleanups.push(dispose);
	const send = (
		frame: object,
		options: { origin?: string; source?: Window | null } = {}
	) => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					source: "r-state-tree:extension",
					version: 1,
					id: "request-a",
					type: "query",
					instanceId,
					request: { op: "roots" },
					...frame,
				},
				origin: options.origin ?? location.origin,
				source: options.source === undefined ? window : options.source,
			})
		);
	};
	return { query, dispose, send };
}
test("extension page bridge checks origin, top window source, protocol, target, and bounded literal requests; never inserts UI", () => {
	const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
	const { query, send } = fixture();
	const before = document.body.innerHTML;
	send({}, { origin: "https://attacker.example" });
	send({}, { source: null });
	send({ instanceId: "other" });
	send({ version: 2 });
	send({ source: "other" });
	send({ id: "bad id" });
	expect(query).not.toHaveBeenCalled();
	send({ request: { op: "eval", expression: "document.cookie" } });
	expect(query).not.toHaveBeenCalled();
	expect(post.mock.calls.at(-1)?.[0].response.error).toContain(
		"Inspection failed"
	);
	send({});
	expect(query).toHaveBeenCalledWith({ op: "roots" });
	expect(post.mock.calls.at(-1)).toEqual([
		expect.objectContaining({
			source: "r-state-tree:page",
			instanceId: "instance-a",
			response: { value: { roots: [] } },
		}),
		location.origin,
	]);
	query.mockClear();
	send({
		request: {
			op: "set",
			rootId: "a",
			field: "name",
			value: "界".repeat(400000),
		},
	});
	expect(query).not.toHaveBeenCalled();
	expect(document.body.innerHTML).toBe(before);
});

test("discovery addresses independent live instances; async replies are correlated, bounded, sanitized, and dropped after disposal", async () => {
	const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
	const a = fixture("instance-a"),
		b = fixture("instance-b");
	post.mockClear();
	a.send({ type: "discover" });
	expect(post.mock.calls.map((call) => call[0].instanceId).sort()).toEqual([
		"instance-a",
		"instance-b",
	]);
	let resolve!: (value: any) => void;
	a.query.mockImplementation(
		() =>
			new Promise((r) => {
				resolve = r;
			})
	);
	a.send({ id: "async" });
	expect(b.query).not.toHaveBeenCalled();
	resolve("界".repeat(400000));
	await Promise.resolve();
	expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
		id: "async",
		response: { error: expect.stringContaining("byte limit") },
	});
	a.query.mockRejectedValueOnce(new Error("PRIVATE ERROR"));
	a.send({});
	await Promise.resolve();
	expect(JSON.stringify(post.mock.calls)).not.toContain("PRIVATE ERROR");
	a.send({});
	a.dispose();
	const count = post.mock.calls.length;
	resolve({ roots: [] });
	await Promise.resolve();
	expect(post.mock.calls).toHaveLength(count);
	a.query.mockClear();
	a.send({});
	expect(a.query).not.toHaveBeenCalled();
});
