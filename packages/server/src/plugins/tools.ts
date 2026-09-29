import type {
	ExtensionAPI,
	ExtensionFactory,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { PluginToolDefinition, TerminalRef } from "@thinkrail/plugin-api";
import { Value } from "typebox/value";
import type { McpToolHandle } from "../mcp";
import { type ActivationTables, beginCall, endCall, type PluginRegistry } from "./registry";

export interface PluginToolScope {
	workspaceId: string | null;
	cwd: string;
}

interface ActiveTool {
	tool: PluginToolDefinition;
	activation: ActivationTables;
}

function activeTools(registry: PluginRegistry, surface: "agent" | "mcp"): ActiveTool[] {
	const tools: ActiveTool[] = [];
	for (const entry of registry.all()) {
		if (entry.state !== "active" || !entry.activation) continue;
		for (const tool of entry.activation.tools) {
			if (tool.surfaces.includes(surface)) tools.push({ tool, activation: entry.activation });
		}
	}
	return tools;
}

function adaptForAgent(
	{ tool, activation }: ActiveTool,
	scope: () => PluginToolScope,
): ToolDefinition {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		...(tool.promptSnippet !== undefined ? { promptSnippet: tool.promptSnippet } : {}),
		parameters: tool.parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { workspaceId, cwd } = scope();
			beginCall(activation);
			try {
				const result = await tool.run(params as Record<string, unknown>, {
					cwd,
					workspaceId,
					sessionId: ctx.sessionManager.getSessionId(),
				});
				if (result.isError) throw new Error(result.text);
				return { content: [{ type: "text", text: result.text }], details: result.details };
			} finally {
				endCall(activation);
			}
		},
	};
}

export function pluginToolsExtension(
	registry: PluginRegistry,
	scope: () => PluginToolScope,
): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		for (const active of activeTools(registry, "agent")) {
			pi.registerTool(adaptForAgent(active, scope));
		}
	};
}

export function pluginMcpTools(
	registry: PluginRegistry,
	owner: TerminalRef,
	cwd: string,
): McpToolHandle[] {
	return activeTools(registry, "mcp").map(({ tool, activation }) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.parameters,
		async call(args) {
			if (!Value.Check(tool.parameters, args)) {
				const [first] = Value.Errors(tool.parameters, args);
				return {
					text: `Invalid arguments for ${tool.name} — ${first?.instancePath || "arguments"}: ${first?.message ?? "do not match"}`,
					isError: true,
				};
			}
			beginCall(activation);
			try {
				const result = await tool.run(args, {
					cwd,
					workspaceId: owner.workspaceId,
					terminal: owner,
				});
				return { text: result.text, ...(result.isError ? { isError: true } : {}) };
			} finally {
				endCall(activation);
			}
		},
	}));
}
