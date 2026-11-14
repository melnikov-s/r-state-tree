import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createInspectorMcpServer } from "../devtools/src/inspection/mcp";
import { relayRequest } from "../devtools/src/inspection/relay";
import type { RelayRecord } from "../devtools/src/inspection/relay";

vi.mock("../devtools/src/inspection/relay", () => ({ relayRequest: vi.fn() }));

test("MCP advertises and explicitly requests structured operation records without control capabilities", async () => {
	const server = createInspectorMcpServer(async () => ({}) as RelayRecord);
	const client = new Client({ name: "operations-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(a);
		await client.connect(b);
		const tools = (await client.listTools()).tools;
		expect(
			tools.find((tool) => tool.name === "rst_list_operations")
		).toMatchObject({ annotations: { readOnlyHint: true } });
		expect(tools.some((tool) => tool.name === "rst_clear_operations")).toBe(
			false
		);
		const response = {
			value: {
				enabled: true,
				canClear: false,
				records: [
					{
						id: "1",
						name: "Save",
						status: "succeeded",
						startedAt: 1,
						durationMs: 2,
						abortRequested: false,
					},
				],
			},
		};
		vi.mocked(relayRequest).mockResolvedValue(response);
		const result = await client.callTool({
			name: "rst_list_operations",
			arguments: { tabId: "one" },
		});
		expect(relayRequest).toHaveBeenCalledWith(
			{},
			{ op: "operations" },
			"one",
			7000,
			expect.anything()
		);
		expect(result.structuredContent).toEqual(response);
		expect(result.isError).toBe(false);
		vi.mocked(relayRequest).mockClear();
		const invalid = await client.callTool({
			name: "rst_list_operations",
			arguments: { rootId: "not permitted" },
		});
		expect(invalid.isError).toBe(true);
		expect(relayRequest).not.toHaveBeenCalled();
	} finally {
		await client.close();
		await server.close();
	}
});
