import { definePluginManifest, PLUGIN_API_GENERATION } from "@thinkrail/plugin-api";

export const FILE_ICONS_ID = "file-icons";

export const manifest = definePluginManifest({
	id: FILE_ICONS_ID,
	label: "File Icons",
	description: "File-type glyphs from material-icon-theme for the file tree and tabs.",
	icon: "file-text",
	version: "0.1.0",
	apiGeneration: PLUGIN_API_GENERATION,
	wireVersion: 1,
	enabledByDefault: true,
	dependsOn: [],
	web: "./web/index.tsx",
	assets: "assets",
	contributes: {
		sideTools: [],
		fileViewers: [],
	},
});
