import { definePluginManifest, PLUGIN_API_GENERATION, pluginToolId } from "@thinkrail/plugin-api";

export const CODEX_ID = "codex";

export const manifest = definePluginManifest({
	id: CODEX_ID,
	label: "Codex",
	description: "Runs OpenAI Codex in the terminal with live status and ThinkRail's MCP tools.",
	icon: "openai",
	version: "0.1.0",
	apiGeneration: PLUGIN_API_GENERATION,
	wireVersion: 2,
	enabledByDefault: false,
	dependsOn: [],
	host: "./host/index.ts",
	web: "./web/index.ts",
	contributes: {
		sideTools: [
			{
				tool: pluginToolId(CODEX_ID, "config"),
				label: "Codex",
				icon: "openai",
				defaultSide: "right",
			},
		],
		fileViewers: [],
	},
});
