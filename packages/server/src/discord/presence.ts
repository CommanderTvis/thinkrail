import { basename } from "node:path";
import {
	DISCORD_APPLICATION_ID,
	type DiscordPresence,
	type DiscordSettings,
	type DiscordStatus,
} from "@thinkrail/contracts";
import type { DiscordActivity } from "./ipc";

export type PresenceDecision =
	| { kind: "publish"; activity: DiscordActivity }
	| { kind: "clear"; detail: string }
	| { kind: "silent"; state: "off" | "unconfigured"; detail: string };

export function decidePresence(
	presence: DiscordPresence | null,
	settings: DiscordSettings,
	startedAt: number,
): PresenceDecision {
	if (!settings.enabled) return { kind: "silent", state: "off", detail: "Rich Presence is off." };
	if (!DISCORD_APPLICATION_ID.test(settings.applicationId))
		return {
			kind: "silent",
			state: "unconfigured",
			detail: "Add a Discord application id to start publishing.",
		};
	if (!presence) return { kind: "clear", detail: "No project is open." };
	if (settings.blockedProjectIds.includes(presence.projectId))
		return { kind: "clear", detail: `${presence.projectName} is blocked from Discord.` };

	const file = settings.shareFileName && presence.filePath ? basename(presence.filePath) : null;
	return {
		kind: "publish",
		activity: {
			details: file ? `Editing ${file}` : null,
			state: presence.projectName,
			startedAt,
		},
	};
}

export function statusFor(
	decision: PresenceDecision,
	connected: boolean,
	failure: string | null,
): DiscordStatus {
	if (decision.kind === "silent")
		return { state: decision.state, published: null, detail: decision.detail };
	if (failure) return { state: "unavailable", published: null, detail: failure };
	if (!connected) return { state: "connecting", published: null, detail: null };
	if (decision.kind === "clear")
		return { state: "connected", published: null, detail: decision.detail };
	return {
		state: "connected",
		published: { details: decision.activity.details, state: decision.activity.state },
		detail: null,
	};
}
