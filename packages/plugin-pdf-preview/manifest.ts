import { definePluginManifest, PLUGIN_API_GENERATION } from "@thinkrail/plugin-api";

export const PDF_PREVIEW_ID = "pdf-preview";

export const manifest = definePluginManifest({
	id: PDF_PREVIEW_ID,
	label: "PDF Preview",
	description: "Opens PDF files in a viewer tab.",
	icon: "file-pdf-2",
	version: "0.1.0",
	apiGeneration: PLUGIN_API_GENERATION,
	wireVersion: 1,
	enabledByDefault: true,
	dependsOn: [],
	web: "./web/index.ts",
	contributes: {
		sideTools: [],
		fileViewers: [{ extensions: ["pdf"], names: [], read: "none" }],
	},
});
