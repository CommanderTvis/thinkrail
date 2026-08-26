import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const BLUEPRINT_CHECK_TOOL_NAME = "blueprint_check";

const BlueprintCheckSchema = Type.Object({});

export interface BlueprintCheckTool {
	description: string;
	run: (cwd: string) => { text: string; isError?: boolean };
}

let installed: BlueprintCheckTool | null = null;

export function setBlueprintCheckTool(tool: BlueprintCheckTool): void {
	installed = tool;
}

function createBlueprintCheckTool(
	tool: BlueprintCheckTool,
): ToolDefinition<typeof BlueprintCheckSchema> {
	return {
		name: BLUEPRINT_CHECK_TOOL_NAME,
		label: "Check Blueprint",
		description: tool.description,
		parameters: BlueprintCheckSchema,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const outcome = tool.run(ctx.cwd);
			if (outcome.isError) throw new Error(outcome.text);
			return { content: [{ type: "text", text: outcome.text }], details: {} };
		},
	};
}

/** No tool at all on a host that installed none, rather than one that always fails; see SPEC.md. */
export function blueprintToolExtension(pi: ExtensionAPI): void {
	if (installed) pi.registerTool(createBlueprintCheckTool(installed));
}
