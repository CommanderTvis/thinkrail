import { definePluginHost } from "@thinkrail/plugin-api/host";
import { discordContract, THINKRAIL_DISCORD_APPLICATION_ID } from "../contracts";
import { manifest } from "../manifest";
import { createDiscordRuntime } from "./lifecycle";

export default definePluginHost({
	manifest,
	contract: discordContract,
	activate(ctx) {
		const runtime = createDiscordRuntime(
			() => {
				const settings = ctx.settings();
				return {
					applicationId: settings.applicationId ?? THINKRAIL_DISCORD_APPLICATION_ID,
					blockedProjectIds: settings.blockedProjectIds ?? [],
					shareFileName: settings.shareFileName ?? true,
				};
			},
			(status) => ctx.publish("status", status),
		);

		ctx.method("presence", (params) => runtime.publishPresence(params.presence));
		ctx.method("status", () => runtime.getStatus());

		ctx.onSettings(() => runtime.applySettingsChange());

		return () => runtime.stop();
	},
});
