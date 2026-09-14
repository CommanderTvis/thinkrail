import { definePluginManifest, PLUGIN_API_GENERATION } from "@thinkrail/plugin-api";

export const VISUALIZE_ID = "visualize";

export const manifest = definePluginManifest({
	id: VISUALIZE_ID,
	label: "Visualize",
	description: "Gives the terminal agent a live drawing surface.",
	icon: "bar-chart-box",
	version: "0.1.0",
	apiGeneration: PLUGIN_API_GENERATION,
	wireVersion: 1,
	enabledByDefault: true,
	dependsOn: [],
	host: "./host/index.ts",
	web: "./web/index.ts",
	contributes: {
		sideTools: [],
		fileViewers: [],
	},
});
