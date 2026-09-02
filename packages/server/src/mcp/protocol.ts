export interface McpToolHandle {
	name: string;
	description: string;
	inputSchema: object;
	call(args: Record<string, unknown>): Promise<McpToolReply> | McpToolReply;
}

export interface McpToolReply {
	text: string;
	isError?: boolean;
}

export interface McpServerIdentity {
	name: string;
	version: string;
	instructions?: string;
}

export interface McpHttpReply {
	status: number;
	body: unknown | null;
}

const LATEST_PROTOCOL = "2025-06-18";
const KNOWN_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", LATEST_PROTOCOL]);

function rpcError(id: unknown, code: number, message: string): McpHttpReply {
	return { status: 200, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } };
}

function rpcResult(id: unknown, result: unknown): McpHttpReply {
	return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export async function handleMcpMessage(
	message: unknown,
	identity: McpServerIdentity,
	tools: readonly McpToolHandle[],
): Promise<McpHttpReply> {
	if (typeof message !== "object" || message === null || Array.isArray(message)) {
		return rpcError(null, -32600, "Expected a single JSON-RPC request object.");
	}
	const frame = message as Record<string, unknown>;
	if (frame.jsonrpc !== "2.0" || typeof frame.method !== "string") {
		return rpcError(frame.id, -32600, "Not a JSON-RPC 2.0 request.");
	}
	const { id, method } = frame;
	const params = asRecord(frame.params);

	if (id === undefined) return { status: 202, body: null };

	switch (method) {
		case "initialize": {
			const requested = params.protocolVersion;
			const protocolVersion =
				typeof requested === "string" && KNOWN_PROTOCOLS.has(requested)
					? requested
					: LATEST_PROTOCOL;
			return rpcResult(id, {
				protocolVersion,
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: identity.name, version: identity.version },
				...(identity.instructions === undefined ? {} : { instructions: identity.instructions }),
			});
		}
		case "ping":
			return rpcResult(id, {});
		case "tools/list":
			return rpcResult(id, {
				tools: tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
				})),
			});
		case "tools/call": {
			const name = params.name;
			const tool = tools.find((candidate) => candidate.name === name);
			if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
			let reply: McpToolReply;
			try {
				reply = await tool.call(asRecord(params.arguments));
			} catch (err) {
				reply = { text: `Tool failed: ${(err as Error).message}`, isError: true };
			}
			return rpcResult(id, {
				content: [{ type: "text", text: reply.text }],
				...(reply.isError === true ? { isError: true } : {}),
			});
		}
		default:
			return rpcError(id, -32601, `Method not found: ${method}`);
	}
}
