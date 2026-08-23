import { describe, expect, test } from "bun:test";
import {
	failure,
	IDE_AUTH_HEADER,
	IDE_TOOLS,
	JSON_RPC_METHOD_NOT_FOUND,
	MCP_PROTOCOL_VERSION,
	notification,
	parseJsonRpc,
	success,
	toolContent,
} from "./mcp";

describe("parseJsonRpc", () => {
	test("reads a request with an id", () => {
		expect(parseJsonRpc('{"jsonrpc":"2.0","id":1,"method":"initialize"}')).toEqual({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
		});
	});

	test("reads a notification, which carries no id", () => {
		const parsed = parseJsonRpc('{"jsonrpc":"2.0","method":"notifications/initialized"}');
		expect(parsed?.method).toBe("notifications/initialized");
		expect(parsed?.id).toBeUndefined();
	});

	test("keeps params when present, and omits the key when absent", () => {
		expect(
			parseJsonRpc('{"jsonrpc":"2.0","id":"a","method":"m","params":{"x":1}}')?.params,
		).toEqual({
			x: 1,
		});
		expect(parseJsonRpc('{"jsonrpc":"2.0","id":"a","method":"m"}')).not.toHaveProperty("params");
	});

	test("rejects anything that is not a JSON-RPC 2.0 request", () => {
		expect(parseJsonRpc("not json")).toBeNull();
		expect(parseJsonRpc("null")).toBeNull();
		expect(parseJsonRpc('"a string"')).toBeNull();
		expect(parseJsonRpc('{"jsonrpc":"1.0","method":"m"}')).toBeNull();
		expect(parseJsonRpc('{"jsonrpc":"2.0"}')).toBeNull();
		expect(parseJsonRpc('{"jsonrpc":"2.0","method":42}')).toBeNull();
	});

	test("rejects an id that is neither string nor number, rather than answering to it", () => {
		expect(parseJsonRpc('{"jsonrpc":"2.0","id":{"nested":1},"method":"m"}')).toBeNull();
	});
});

describe("framing", () => {
	test("success and failure both echo the id they answer", () => {
		expect(JSON.parse(success(7, { ok: 1 }))).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: 1 } });
		expect(JSON.parse(failure("x", JSON_RPC_METHOD_NOT_FOUND, "nope"))).toEqual({
			jsonrpc: "2.0",
			id: "x",
			error: { code: JSON_RPC_METHOD_NOT_FOUND, message: "nope" },
		});
	});

	test("a notification carries no id — that is what makes it unanswerable", () => {
		expect(JSON.parse(notification("selection_changed", { a: 1 }))).toEqual({
			jsonrpc: "2.0",
			method: "selection_changed",
			params: { a: 1 },
		});
	});

	test("a tool result is JSON inside MCP text content, which is how the CLI reads it back", () => {
		const wrapped = toolContent({ success: true, filePath: "/a/b.ts" });
		expect(wrapped.content[0]?.type).toBe("text");
		expect(JSON.parse(wrapped.content[0]?.text ?? "")).toEqual({
			success: true,
			filePath: "/a/b.ts",
		});
	});
});

describe("the pinned protocol constants", () => {
	// Undocumented and reverse-engineered: a bump here is a deliberate act, never an incidental edit.
	test("the auth header and protocol version are the ones the CLI expects", () => {
		expect(IDE_AUTH_HEADER).toBe("x-claude-code-ide-authorization");
		expect(MCP_PROTOCOL_VERSION).toBe("2024-11-05");
	});

	test("every tool the official extension exposes is advertised, under its exact name", () => {
		expect(IDE_TOOLS.map((tool) => tool.name).sort()).toEqual([
			"checkDocumentDirty",
			"closeAllDiffTabs",
			"close_tab",
			"getCurrentSelection",
			"getLatestSelection",
			"getOpenEditors",
			"getWorkspaceFolders",
			"openDiff",
			"openFile",
			"saveDocument",
		]);
	});

	test("each tool advertises an object schema, so the CLI can validate a call before making it", () => {
		for (const tool of IDE_TOOLS) {
			expect(tool.inputSchema.type).toBe("object");
			expect(tool.description.length).toBeGreaterThan(0);
		}
	});
});
