import { definePluginManifest, PLUGIN_API_GENERATION } from "@thinkrail/plugin-api";
import { BLUEPRINT_FILE } from "./blueprintFile";

export const BLUEPRINT_ID = "blueprint";

export const manifest = definePluginManifest({
	id: BLUEPRINT_ID,
	label: "Blueprint",
	description: "Authors interactive Blueprint specs and reacts to their edits.",
	icon: "pencil-ruler-2",
	version: "0.1.0",
	apiGeneration: PLUGIN_API_GENERATION,
	wireVersion: 1,
	enabledByDefault: true,
	dependsOn: [{ id: "spec-dialect", wireVersion: 1 }],
	host: "./host/index.ts",
	web: "./web/index.ts",
	contributes: {
		sideTools: [],
		fileViewers: [{ extensions: [], names: [BLUEPRINT_FILE], read: "none" }],
	},
});
