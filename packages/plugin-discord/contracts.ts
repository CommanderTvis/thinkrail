import { definePluginContract } from "@thinkrail/plugin-api";
import { type Static, Type } from "typebox";
import { DISCORD_APPLICATION_ID, THINKRAIL_DISCORD_APPLICATION_ID } from "./webValues";

export { DISCORD_APPLICATION_ID, THINKRAIL_DISCORD_APPLICATION_ID };

/** What the client believes is worth publishing. The host decides whether any of it may leave. */
export const DiscordPresenceSchema = Type.Object({
	projectId: Type.String(),
	projectName: Type.String(),
	/** Worktree-relative path of the focused editor tab, or null when none is focused. */
	filePath: Type.Union([Type.String(), Type.Null()]),
});
export type DiscordPresence = Static<typeof DiscordPresenceSchema>;

export const DiscordConnectionStateSchema = Type.Union([
	Type.Literal("unconfigured"),
	Type.Literal("unavailable"),
	Type.Literal("connecting"),
	Type.Literal("connected"),
]);
export type DiscordConnectionState = Static<typeof DiscordConnectionStateSchema>;

export const DiscordStatusSchema = Type.Object({
	state: DiscordConnectionStateSchema,
	/** What is on the user's profile right now, exactly as Discord received it. */
	published: Type.Union([
		Type.Object({ details: Type.Union([Type.String(), Type.Null()]), state: Type.String() }),
		Type.Null(),
	]),
	/** Why nothing is published, in the words the settings pane shows. */
	detail: Type.Union([Type.String(), Type.Null()]),
});
export type DiscordStatus = Static<typeof DiscordStatusSchema>;

export const discordContract = definePluginContract({
	id: "discord",
	wireVersion: 1,
	methods: {
		presence: {
			params: Type.Object({ presence: Type.Union([DiscordPresenceSchema, Type.Null()]) }),
			result: DiscordStatusSchema,
		},
		status: {
			params: Type.Object({}),
			result: DiscordStatusSchema,
		},
	},
	channels: {
		status: {
			kind: "state",
			payload: DiscordStatusSchema,
			snapshot: "status",
			key: [],
		},
	},
	settings: Type.Object({
		applicationId: Type.Optional(Type.String({ default: THINKRAIL_DISCORD_APPLICATION_ID })),
		/** Projects that never reach Discord at all — not even as an anonymous "working on something". */
		blockedProjectIds: Type.Optional(Type.Array(Type.String(), { default: [] })),
		/** Whether the file name is published alongside the project name. */
		shareFileName: Type.Optional(Type.Boolean({ default: true })),
	}),
});
