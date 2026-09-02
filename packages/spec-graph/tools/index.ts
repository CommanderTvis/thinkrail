import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TObject } from "typebox";
import { specCreate } from "./create.ts";
import { specDelete } from "./delete.ts";
import { specGet } from "./get.ts";
import { specGraph } from "./graph.ts";
import { specGrep } from "./grep.ts";
import type { SpecToolDef } from "./shared.ts";
import { specUpdate } from "./update.ts";
import { specValidate } from "./validate.ts";

export type { SpecToolDef, SpecToolOutcome } from "./shared.ts";

export const SPEC_TOOLS: readonly SpecToolDef<TObject, unknown>[] = [
	specGrep,
	specGet,
	specGraph,
	specCreate,
	specUpdate,
	specDelete,
	specValidate,
];

function registerSpecTool<P extends TObject, T>(pi: ExtensionAPI, tool: SpecToolDef<P, T>): void {
	pi.registerTool<P, T>({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		promptSnippet: tool.promptSnippet,
		parameters: tool.parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<T>> {
			const outcome = await tool.run(params, ctx.cwd);
			return { content: [{ type: "text", text: outcome.text }], details: outcome.details };
		},
	});
}

export function registerSpecTools(pi: ExtensionAPI): void {
	for (const tool of SPEC_TOOLS) {
		registerSpecTool(pi, tool);
	}
}
