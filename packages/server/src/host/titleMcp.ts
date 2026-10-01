import { Type } from "typebox";
import { Value } from "typebox/value";
import type { McpToolHandle } from "../mcp";
import { applyTerminalTitle } from "./titleTool";

const TerminalSetTitleSchema = Type.Object({
	workspace_name: Type.String({
		description:
			"2–5 words naming the task, in the user's language. For a PR, issue, or ticket: `<Verb> #<number> <its exact title>`.",
	}),
	branch: Type.Optional(
		Type.String({
			description:
				'Short English kebab-case slug for the workspace branch, e.g. "fix-auth-redirect".',
		}),
	),
});

const DESCRIPTION =
	"Name the ThinkRail workspace this terminal works in. Call it once, as soon as the task is clear, before your other tool calls. A name that is already set — by an earlier call or by the user — is kept; the result says what was applied, and a kept name is final.";

export function titleMcpTools(workspaceId: string): McpToolHandle[] {
	return [
		{
			name: "set_title",
			description: DESCRIPTION,
			inputSchema: TerminalSetTitleSchema,
			call(args) {
				if (!Value.Check(TerminalSetTitleSchema, args)) {
					return { text: "set_title needs a string workspace_name.", isError: true };
				}
				try {
					return { text: applyTerminalTitle(workspaceId, args) };
				} catch (error) {
					return { text: error instanceof Error ? error.message : String(error), isError: true };
				}
			},
		},
	];
}
