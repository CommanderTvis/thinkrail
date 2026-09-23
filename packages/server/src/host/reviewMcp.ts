import type { TerminalRef } from "@thinkrail/plugin-api";
import { Value } from "typebox/value";
import {
	RESOLVE_COMMENT_DESCRIPTION,
	RESOLVE_COMMENT_TOOL_NAME,
	ResolveCommentSchema,
} from "../agent";
import type { McpToolHandle } from "../mcp";
import { resolveCommentFromTerminal } from "../reviews";

export function reviewMcpTools(owner: TerminalRef): McpToolHandle[] {
	return [
		{
			name: RESOLVE_COMMENT_TOOL_NAME,
			description: RESOLVE_COMMENT_DESCRIPTION,
			inputSchema: ResolveCommentSchema,
			call(args) {
				if (!Value.Check(ResolveCommentSchema, args)) {
					return { text: "resolve_comment needs a string commentId.", isError: true };
				}
				resolveCommentFromTerminal(owner, args.commentId, args.note);
				return { text: `Resolved review comment ${args.commentId}.` };
			},
		},
	];
}
