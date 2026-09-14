import { definePluginManifest, PLUGIN_API_GENERATION, pluginToolId } from "@thinkrail/plugin-api";

export const BRANCH_GRAPH_ID = "branch-graph";
export const GRAPH_TOOL = pluginToolId(BRANCH_GRAPH_ID, "graph");

export const manifest = definePluginManifest({
	id: BRANCH_GRAPH_ID,
	label: "Git Graph",
	description: "Shows the project's branch graph as a side tool.",
	icon: "git-branch",
	version: "0.1.0",
	apiGeneration: PLUGIN_API_GENERATION,
	wireVersion: 1,
	enabledByDefault: true,
	dependsOn: [],
	host: "./host/index.ts",
	web: "./web/index.ts",
	contributes: {
		sideTools: [
			{
				tool: GRAPH_TOOL,
				label: "Git Graph",
				icon: "git-branch",
				defaultSide: "right",
				requiresGit: true,
			},
		],
		fileViewers: [],
	},
});
