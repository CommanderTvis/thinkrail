import { definePluginWeb } from "@thinkrail/plugin-api/web";
import type { discordContract } from "../contracts";
import { DiscordMark } from "./DiscordMark";
import { createDiscordSettings } from "./DiscordSettings";
import { initDiscordPresenceReporting } from "./reportPresence";

export default definePluginWeb<typeof discordContract>({
	activate(ctx) {
		ctx.settingsSection({
			label: "Discord",
			icon: DiscordMark,
			component: createDiscordSettings(ctx),
		});

		initDiscordPresenceReporting(ctx);
	},
});
