export interface DiscordSettings {
	/**
	 * The whole integration. Off until asked for: presence is broadcast to everyone who can see the
	 * user's Discord profile, so it is the one setting where a default of "on" would publish something
	 * the user never chose to publish.
	 */
	enabled: boolean;
	/**
	 * The Discord application whose name and artwork the presence wears. Rich Presence has no anonymous
	 * mode — Discord shows the *application's* name, so there is nothing to show until the user registers
	 * one and pastes its id here. Empty means "not configured yet", not "broken".
	 */
	applicationId: string;
	/** Projects that never reach Discord at all — not even as an anonymous "working on something". */
	blockedProjectIds: string[];
	/** Whether the file name is published alongside the project name. */
	shareFileName: boolean;
}

export const DEFAULT_DISCORD_SETTINGS: DiscordSettings = {
	enabled: false,
	applicationId: "",
	blockedProjectIds: [],
	shareFileName: true,
};

/** Discord application ids are snowflakes: a decimal integer, 17-20 digits today. */
export const DISCORD_APPLICATION_ID = /^\d{15,25}$/;

/** What the client believes is worth publishing. The host decides whether any of it may leave. */
export interface DiscordPresence {
	projectId: string;
	projectName: string;
	/** Worktree-relative path of the focused editor tab, or null when none is focused. */
	filePath: string | null;
}

export type DiscordConnectionState =
	| "off"
	| "unconfigured"
	| "unavailable"
	| "connecting"
	| "connected";

export interface DiscordStatus {
	state: DiscordConnectionState;
	/** What is on the user's profile right now, exactly as Discord received it. */
	published: { details: string | null; state: string } | null;
	/** Why nothing is published, in the words the settings pane shows. */
	detail: string | null;
}
