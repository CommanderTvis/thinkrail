import { handleMcpMessage, type McpHttpReply, type McpToolHandle } from "./protocol";
import { mcpToolsFor } from "./tools";

export type { McpHttpReply, McpToolHandle } from "./protocol";
export { mcpToolsFor } from "./tools";

const IDENTITY = {
	name: "thinkrail",
	version: "1",
	instructions:
		"ThinkRail's project tools for the workspace this session runs in. The spec_* tools read and write the project's spec-graph — its living design docs; reach for spec_grep/spec_get before exploring code.",
};

export function serveMcp(
	body: unknown,
	context: { cwd: string; tools?: McpToolHandle[]; extraTools?: McpToolHandle[] },
): Promise<McpHttpReply> {
	// `tools` is the plugin-fed table (the caller supplies every tool, spec tools included if it wants
	// them); `extraTools` is the pre-plugin-API shape this module used to bake `mcpToolsFor` under, kept
	// as a compatibility fallback until every caller passes `tools`. See SPEC.md.
	const tools = context.tools ?? [...mcpToolsFor(context.cwd), ...(context.extraTools ?? [])];
	return handleMcpMessage(body, IDENTITY, tools);
}
