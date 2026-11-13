#!/usr/bin/env node
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createInspectorMcpServer, readRelayRecord } from "./inspection/mcp";

const file = resolve(
	process.env.RST_INSPECTOR_RELAY_FILE ?? ".r-state-tree-inspector.json"
);
const server = createInspectorMcpServer(() => readRelayRecord(file));
server.connect(new StdioServerTransport()).catch(() => {
	console.error("RStateTree inspector: failed to start stdio transport");
	process.exitCode = 1;
});
process.stdin.once("end", () => {
	void server.close();
});
