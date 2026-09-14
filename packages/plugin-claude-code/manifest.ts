import { definePluginManifest, PLUGIN_API_GENERATION, pluginToolId } from "@thinkrail/plugin-api";

export const CLAUDE_CODE_ID = "claude-code";

export const manifest = definePluginManifest({
	id: CLAUDE_CODE_ID,
	label: "Claude Code",
	description: "Runs Claude Code in the terminal with an IDE bridge and live status.",
	icon: "claude",
	version: "0.2.0",
	apiGeneration: PLUGIN_API_GENERATION,
	wireVersion: 1,
	enabledByDefault: false,
	dependsOn: [],
	host: "./host/index.ts",
	web: "./web/index.ts",
	assets: "assets",
	contributes: {
		sideTools: [
			{
				tool: pluginToolId(CLAUDE_CODE_ID, "config"),
				label: "Claude Code",
				icon: "claude",
				defaultSide: "right",
			},
		],
		fileViewers: [],
	},
});
