import { SPEC_TOOLS } from "pi-spec-graph/tools";
import type { Static, TObject } from "typebox";
import { Value } from "typebox/value";
import type { McpToolHandle } from "./protocol";

function firstSchemaError(schema: TObject, args: Record<string, unknown>): string {
	const [first] = Value.Errors(schema, args);
	return first
		? `${first.instancePath || "arguments"}: ${first.message}`
		: "arguments do not match";
}

export function mcpToolsFor(cwd: string): McpToolHandle[] {
	return SPEC_TOOLS.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.parameters,
		async call(args) {
			if (!Value.Check(tool.parameters, args)) {
				return {
					text: `Invalid arguments for ${tool.name} — ${firstSchemaError(tool.parameters, args)}`,
					isError: true,
				};
			}
			const outcome = await tool.run(args as Static<TObject>, cwd);
			const failed =
				typeof outcome.details === "object" &&
				outcome.details !== null &&
				"error" in outcome.details;
			return { text: outcome.text, ...(failed ? { isError: true } : {}) };
		},
	}));
}
