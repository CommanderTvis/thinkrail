import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveMcp } from "./index";
import { handleMcpMessage, type McpToolHandle } from "./protocol";

const IDENTITY = { name: "test", version: "0" };

const ECHO: McpToolHandle = {
	name: "echo",
	description: "echoes",
	inputSchema: { type: "object" },
	call: (args) => ({ text: `echo:${String(args.value)}` }),
};

function request(method: string, params?: unknown, id: unknown = 1): unknown {
	return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

function resultOf(reply: { body: unknown }): Record<string, unknown> {
	return (reply.body as { result: Record<string, unknown> }).result;
}

test("initialize negotiates a known protocol version and advertises tools", async () => {
	const reply = await handleMcpMessage(
		request("initialize", { protocolVersion: "2025-03-26" }),
		IDENTITY,
		[ECHO],
	);
	const result = resultOf(reply);
	expect(result.protocolVersion).toBe("2025-03-26");
	expect(result.capabilities).toEqual({ tools: { listChanged: false } });
	expect(result.serverInfo).toEqual({ name: "test", version: "0" });
});

test("an unknown requested protocol version falls back to the latest we speak", async () => {
	const reply = await handleMcpMessage(
		request("initialize", { protocolVersion: "1999-01-01" }),
		IDENTITY,
		[],
	);
	expect(resultOf(reply).protocolVersion).toBe("2025-06-18");
});

test("a notification is acknowledged with 202 and no body", async () => {
	const reply = await handleMcpMessage(
		{ jsonrpc: "2.0", method: "notifications/initialized" },
		IDENTITY,
		[],
	);
	expect(reply.status).toBe(202);
	expect(reply.body).toBeNull();
});

test("tools/list serves each tool's schema verbatim", async () => {
	const reply = await handleMcpMessage(request("tools/list"), IDENTITY, [ECHO]);
	expect(resultOf(reply).tools).toEqual([
		{ name: "echo", description: "echoes", inputSchema: { type: "object" } },
	]);
});

test("tools/call runs the tool; a throw becomes an isError result, not a protocol error", async () => {
	const ok = await handleMcpMessage(
		request("tools/call", { name: "echo", arguments: { value: "hi" } }),
		IDENTITY,
		[ECHO],
	);
	expect(resultOf(ok)).toEqual({ content: [{ type: "text", text: "echo:hi" }] });

	const boom: McpToolHandle = {
		...ECHO,
		name: "boom",
		call: () => {
			throw new Error("nope");
		},
	};
	const failed = await handleMcpMessage(
		request("tools/call", { name: "boom", arguments: {} }),
		IDENTITY,
		[boom],
	);
	expect(resultOf(failed)).toEqual({
		content: [{ type: "text", text: "Tool failed: nope" }],
		isError: true,
	});
});

test("unknown tool and unknown method are JSON-RPC errors; a batch is refused", async () => {
	const missing = await handleMcpMessage(
		request("tools/call", { name: "ghost", arguments: {} }),
		IDENTITY,
		[],
	);
	expect((missing.body as { error: { code: number } }).error.code).toBe(-32602);

	const unknown = await handleMcpMessage(request("resources/list"), IDENTITY, []);
	expect((unknown.body as { error: { code: number } }).error.code).toBe(-32601);

	const batch = await handleMcpMessage([request("ping")], IDENTITY, []);
	expect((batch.body as { error: { code: number } }).error.code).toBe(-32600);
});

async function callSpecTool(
	cwd: string,
	name: string,
	args: Record<string, unknown>,
): Promise<{ text: string; isError?: boolean }> {
	const reply = await serveMcp(request("tools/call", { name, arguments: args }), { cwd });
	const result = resultOf(reply) as {
		content: [{ text: string }];
		isError?: boolean;
	};
	return { text: result.content[0].text, ...(result.isError ? { isError: true } : {}) };
}

test("the spec_* tools are served end to end: create, get, and schema rejection", async () => {
	const root = mkdtempSync(join(tmpdir(), "mcp-spec-"));
	try {
		const listed = await serveMcp(request("tools/list"), { cwd: root });
		const names = (resultOf(listed).tools as { name: string }[]).map((tool) => tool.name);
		expect(names).toContain("spec_create");
		expect(names).toContain("spec_grep");

		const created = await callSpecTool(root, "spec_create", {
			path: "SPEC.md",
			id: "root-spec",
			type: "module-design",
			title: "The root",
		});
		expect(created.isError).toBeUndefined();
		expect(readFileSync(join(root, "SPEC.md"), "utf8")).toContain("id: root-spec");

		const got = await callSpecTool(root, "spec_get", { id: "root-spec" });
		expect(got.text).toContain("root-spec [module-design]");

		const rejected = await callSpecTool(root, "spec_get", { wrong: true });
		expect(rejected.isError).toBe(true);
		expect(rejected.text).toContain("Invalid arguments for spec_get");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
