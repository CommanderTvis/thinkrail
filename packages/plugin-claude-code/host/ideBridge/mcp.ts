// The MCP/JSON-RPC shapes a `claude` CLI expects from an IDE. Reverse-engineered from the official VS Code
// extension: undocumented, and therefore pinned by ideBridge.test.ts rather than trusted to stay stable.

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export const IDE_AUTH_HEADER = "x-claude-code-ide-authorization";

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: string | number;
	method: string;
	params?: unknown;
}

export interface JsonRpcSuccess {
	jsonrpc: "2.0";
	id: string | number;
	result: unknown;
}

export interface JsonRpcFailure {
	jsonrpc: "2.0";
	id: string | number;
	error: { code: number; message: string };
}

export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INTERNAL_ERROR = -32603;

export function parseJsonRpc(raw: string): JsonRpcRequest | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const message = parsed as Record<string, unknown>;
	if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return null;
	const id = message.id;
	if (id !== undefined && typeof id !== "string" && typeof id !== "number") return null;
	return {
		jsonrpc: "2.0",
		method: message.method,
		...(id === undefined ? {} : { id }),
		...(message.params === undefined ? {} : { params: message.params }),
	};
}

export function success(id: string | number, result: unknown): string {
	return JSON.stringify({ jsonrpc: "2.0", id, result } satisfies JsonRpcSuccess);
}

export function failure(id: string | number, code: number, message: string): string {
	return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } } satisfies JsonRpcFailure);
}

/** A server→client MCP notification: no id, never answered. */
export function notification(method: string, params: unknown): string {
	return JSON.stringify({ jsonrpc: "2.0", method, params });
}

/** Every tool wraps its payload as MCP content; the CLI reads `content[0].text` and JSON-parses it. */
export function toolContent(value: unknown): { content: { type: "text"; text: string }[] } {
	return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export interface McpToolDefinition {
	name: string;
	description: string;
	inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

const NO_ARGS = { type: "object", properties: {} } as const;

export const IDE_TOOLS: readonly McpToolDefinition[] = [
	{
		name: "openFile",
		description: "Open a file in the editor, optionally selecting a range matched by text.",
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string" },
				preview: { type: "boolean" },
				startText: { type: "string" },
				endText: { type: "string" },
			},
			required: ["filePath"],
		},
	},
	{
		name: "openDiff",
		description: "Show a diff between a file on disk and proposed contents.",
		inputSchema: {
			type: "object",
			properties: {
				old_file_path: { type: "string" },
				new_file_path: { type: "string" },
				new_file_contents: { type: "string" },
			},
		},
	},
	{
		name: "getCurrentSelection",
		description: "The active editor's current selection.",
		inputSchema: NO_ARGS,
	},
	{
		name: "getLatestSelection",
		description: "The most recent selection, even if the editor no longer has focus.",
		inputSchema: NO_ARGS,
	},
	{ name: "getOpenEditors", description: "The list of open editor tabs.", inputSchema: NO_ARGS },
	{
		name: "getWorkspaceFolders",
		description: "The workspace folders this IDE window has open.",
		inputSchema: NO_ARGS,
	},
	{
		name: "checkDocumentDirty",
		description: "Whether a file has unsaved changes.",
		inputSchema: {
			type: "object",
			properties: { filePath: { type: "string" } },
			required: ["filePath"],
		},
	},
	{
		name: "saveDocument",
		description: "Save a file's unsaved changes.",
		inputSchema: {
			type: "object",
			properties: { filePath: { type: "string" } },
			required: ["filePath"],
		},
	},
	{
		name: "close_tab",
		description: "Close an editor tab by name.",
		inputSchema: {
			type: "object",
			properties: { tab_name: { type: "string" } },
			required: ["tab_name"],
		},
	},
	{ name: "closeAllDiffTabs", description: "Close every open diff tab.", inputSchema: NO_ARGS },
];
