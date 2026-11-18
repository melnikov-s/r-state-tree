import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { lstat, readFile } from "node:fs/promises";
import { relayRequest, type RelayRecord } from "./relay.js";
import {
	isRecord,
	validateRequest,
	type InspectionRequest,
} from "./protocol.js";

export async function readRelayRecord(file: string): Promise<RelayRecord> {
	const stat = await lstat(file);
	if (
		!stat.isFile() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o077) !== 0 ||
		(process.getuid && stat.uid !== process.getuid()) ||
		stat.size > 4096
	)
		throw new Error("Relay file must be an owner-only regular file");
	return JSON.parse(await readFile(file, "utf8")) as RelayRecord;
}
const properties = {
	tabId: {
		type: "string",
		description: "Required when more than one tab is connected",
	},
	rootId: { type: "string" },
	path: {
		type: "array",
		items: { type: "string", maxLength: 256 },
		maxItems: 16,
		description:
			"Field segments from the registered root, including array indices. Child fields use retained storage. Traversing a computed requires rst_inspect with evaluateComputeds:true.",
	},
};
const bounds = {
	depth: { type: "integer", minimum: 1, maximum: 8 },
	maxEntries: { type: "integer", minimum: 1, maximum: 500 },
};
const tools = [
	{
		name: "rst_list_operations",
		description:
			"Read bounded opt-in automatic method/write activity grouped by synchronous batch, plus optional app-operation labels. Fields follow root-path and $operations redaction. Values are shallow summaries; no call arguments/results, replay or cancellation guarantees. Async continuation writes are not attributed to earlier calls; unobserved is not proof work stopped.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
		inputSchema: {
			type: "object",
			properties: { tabId: properties.tabId },
			additionalProperties: false,
		},
	},
	{
		name: "rst_list_tabs",
		description:
			"List connected RStateTree browser tabs. Requires Vite dev server and an open app tab.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "rst_list_roots",
		description: "List explicitly registered live roots, not snapshots.",
		inputSchema: {
			type: "object",
			properties: { tabId: properties.tabId },
			additionalProperties: false,
		},
	},
	{
		name: "rst_inspect",
		description:
			"Inspect a bounded live tree/subtree. Defaults to structure-only, without computed or key evaluation. Set evaluateComputeds:true to evaluate declared computeds; undeclared accessors never evaluate. Synchronous Store child reads use retained storage without initialization or reconciliation. RStateTree computed caches are bypassed, but native Signals and other app caches may retain values or errors from inspection. Computeds execute trusted app code and may throw, mutate state, or schedule side effects. No sandbox, atomic snapshot, history or replay.",
		inputSchema: {
			type: "object",
			properties: {
				...properties,
				...bounds,
				evaluateComputeds: { type: "boolean", default: false },
			},
			required: ["rootId"],
			additionalProperties: false,
		},
	},
	{
		name: "rst_inspect_context",
		description:
			"Explicitly read an available/declaration-inferred Store Context using its normal consume receiver. May execute application providers and their side effects. No controls opt-in required; redacted selections are blocked. contextId is page-local and valid only with the selected registered root/path. Returned values are bounded, not navigation/control capabilities.",
		inputSchema: {
			type: "object",
			properties: {
				...properties,
				...bounds,
				contextId: { type: "string", maxLength: 100 },
			},
			required: ["rootId", "contextId"],
			additionalProperties: false,
		},
	},
	{
		name: "rst_initialize_child",
		description:
			"Explicitly initialize a declared lazy Store child using its normal getter/lifecycle. levels > 1 deliberately materializes descendants (depth <= 4, attempts <= 50). A getter may create a whole keyed list or initialize other children indirectly; these user-code effects cannot be preempted.",
		inputSchema: {
			type: "object",
			properties: {
				...properties,
				field: { type: "string" },
				levels: { type: "integer", minimum: 1, maximum: 4 },
				maxInitializations: { type: "integer", minimum: 1, maximum: 50 },
			},
			required: ["rootId", "field"],
			additionalProperties: false,
		},
	},
	{
		name: "rst_set_field",
		description:
			"Set an existing writable field on a registered object. Requires createInspector({ controls: true }). Executes normal setters/reactions and may affect real services. Cannot replace declared children, overwrite methods, or access redacted paths. Failure/timeout is not rollback; inspect state before retrying.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: true,
		},
		inputSchema: {
			type: "object",
			properties: {
				...properties,
				field: { type: "string", maxLength: 256 },
				value: {
					description:
						"Plain JSON value; at most 64 KiB, 1000 entries, depth 16. No prototype keys.",
				},
			},
			required: ["rootId", "field", "value"],
			additionalProperties: false,
		},
	},
	{
		name: "rst_call_method",
		description:
			"Invoke an application method on a registered object with JSON arguments and its normal this binding. Requires controls: true; inspect to discover methods. Awaits async results for up to 4 seconds and returns a bounded/redacted inspection of the result. Calls can have real external effects. Cancellation/timeout does not stop execution: never retry automatically.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: true,
		},
		inputSchema: {
			type: "object",
			properties: {
				...properties,
				...bounds,
				method: { type: "string", maxLength: 256 },
				args: {
					type: "array",
					items: {},
					maxItems: 32,
					description:
						"JSON argument array; shared 64 KiB / 1000-entry / depth-16 limit.",
				},
			},
			required: ["rootId", "method"],
			additionalProperties: false,
		},
	},
];
const toolOperations = new Map<string, InspectionRequest["op"]>([
	["rst_list_roots", "roots"],
	["rst_list_operations", "operations"],
	["rst_inspect", "inspect"],
	["rst_inspect_context", "context"],
	["rst_initialize_child", "initialize"],
	["rst_set_field", "set"],
	["rst_call_method", "call"],
]);
export function createInspectorMcpServer(
	getRecord: () => Promise<RelayRecord>
) {
	const server = new Server(
		{ name: "r-state-tree-inspector", version: "0.1.0" },
		{ capabilities: { tools: {} } }
	);
	server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
	server.setRequestHandler(
		CallToolRequestSchema,
		async ({ params }, { signal }) => {
			try {
				const tool = tools.find((t) => t.name === params.name);
				if (!tool) throw new Error("Unknown tool");
				const args = params.arguments ?? {};
				if (
					!isRecord(args) ||
					Object.keys(args).some(
						(k) =>
							!Object.prototype.hasOwnProperty.call(
								tool.inputSchema.properties,
								k
							)
					)
				)
					throw new Error("Unknown argument");
				const { tabId, ...rest } = args;
				if (
					tabId !== undefined &&
					(typeof tabId !== "string" || tabId.length > 100)
				)
					throw new Error("Invalid tabId");
				let request: InspectionRequest | { op: "tabs" };
				if (params.name === "rst_list_tabs") request = { op: "tabs" };
				else {
					request = {
						...rest,
						op: toolOperations.get(params.name),
					} as InspectionRequest;
					validateRequest(request);
				}
				const response = await relayRequest(
					await getRecord(),
					request,
					tabId as string | undefined,
					7000,
					signal
				);
				const isError =
					isRecord(response) &&
					(typeof response.error === "string" ||
						((request.op === "set" ||
							request.op === "call" ||
							request.op === "context") &&
							isRecord(response.value) &&
							response.value.ok === false) ||
						(request.op === "initialize" &&
							isRecord(response.value) &&
							Array.isArray(response.value.errors) &&
							response.value.errors.length > 0));
				return {
					content: [{ type: "text", text: JSON.stringify(response) }],
					...(request.op === "operations" && isRecord(response)
						? { structuredContent: response }
						: {}),
					isError,
				};
			} catch (error) {
				// Connection and validation errors only; runtime exception details never leave the page.
				return {
					content: [
						{
							type: "text",
							text:
								error instanceof Error
									? error.message
									: "Inspector request failed",
						},
					],
					isError: true,
				};
			}
		}
	);
	return server;
}
