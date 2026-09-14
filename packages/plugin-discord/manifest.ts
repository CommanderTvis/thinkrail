import { definePluginManifest, PLUGIN_API_GENERATION } from "@thinkrail/plugin-api";

export const DISCORD_ID = "discord";

export const manifest = definePluginManifest({
	id: DISCORD_ID,
	label: "Discord",
	description: "Shows what you're working on as Discord Rich Presence.",
	icon: "discord",
	version: "0.1.0",
	apiGeneration: PLUGIN_API_GENERATION,
	wireVersion: 1,
	enabledByDefault: false,
	dependsOn: [],
	host: "./host/index.ts",
	web: "./web/index.ts",
	contributes: {
		sideTools: [],
		fileViewers: [],
	},
});
