import { definePluginManifest, PLUGIN_API_GENERATION, pluginToolId } from "@thinkrail/plugin-api";

export const SPEC_DIALECT_ID = "spec-dialect";
export const SPECS_TOOL = pluginToolId(SPEC_DIALECT_ID, "specs");

export const manifest = definePluginManifest({
	id: SPEC_DIALECT_ID,
	label: "Specs",
	description: "Reads the project's spec graph and shows it in a Specs panel.",
	icon: "book-open",
	version: "0.1.0",
	apiGeneration: PLUGIN_API_GENERATION,
	wireVersion: 1,
	enabledByDefault: true,
	dependsOn: [],
	host: "./host/index.ts",
	web: "./web/index.ts",
	contributes: {
		sideTools: [{ tool: SPECS_TOOL, label: "Specs", icon: "book-open", defaultSide: "right" }],
		fileViewers: [],
	},
	pi: {
		extensions: ["pi-spec-graph"],
		skills: ["pi-spec-graph/skills"],
		reachesSubagents: true,
		modifiesSystemPrompt: true,
	},
});
