import { handleMcpMessage, type McpHttpReply } from "./protocol";
import { mcpToolsFor } from "./tools";

export type { McpHttpReply } from "./protocol";

const IDENTITY = {
	name: "thinkrail",
	version: "1",
	instructions:
		"ThinkRail's project tools for the workspace this session runs in. The spec_* tools read and write the project's spec-graph — its living design docs; reach for spec_grep/spec_get before exploring code.",
};

export function serveMcp(body: unknown, context: { cwd: string }): Promise<McpHttpReply> {
	return handleMcpMessage(body, IDENTITY, mcpToolsFor(context.cwd));
}
