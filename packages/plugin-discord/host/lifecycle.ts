import type { DiscordPresence, DiscordStatus } from "../contracts";
import { DiscordIpc } from "./ipc";
import { type DiscordSettings, decidePresence, statusFor } from "./presence";

const RETRY_FLOOR_MS = 5_000;

export interface DiscordRuntime {
	publishPresence(presence: DiscordPresence | null): Promise<DiscordStatus>;
	getStatus(): Promise<DiscordStatus>;
	applySettingsChange(): void;
	stop(): void;
}

/** Owns one Discord IPC connection's lifecycle for the plugin's activation lifetime. */
export function createDiscordRuntime(
	getSettings: () => DiscordSettings,
	announce: (status: DiscordStatus) => void,
): DiscordRuntime {
	let ipc: DiscordIpc | null = null;
	let latest: DiscordPresence | null = null;
	let projectStartedAt = Date.now();
	let startedForProjectId: string | null = null;
	let failure: string | null = null;
	let lastAttempt = 0;
	let connecting = false;

	function disconnect(): void {
		ipc?.close();
		ipc = null;
		failure = null;
	}

	function status(): DiscordStatus {
		return statusFor(
			decidePresence(latest, getSettings(), projectStartedAt),
			ipc?.connected === true,
			failure,
		);
	}

	function report(): DiscordStatus {
		const next = status();
		announce(next);
		return next;
	}

	async function ensureConnected(applicationId: string): Promise<void> {
		if (ipc?.connected || connecting) return;
		if (failure && Date.now() - lastAttempt < RETRY_FLOOR_MS) return;

		connecting = true;
		lastAttempt = Date.now();
		const client = new DiscordIpc();
		try {
			await client.connect(applicationId, () => {
				if (ipc === client) {
					ipc = null;
					failure = "Discord closed the connection.";
					report();
				}
			});
			ipc = client;
			failure = null;
		} catch (error) {
			client.close();
			failure = error instanceof Error ? error.message : "Could not reach Discord.";
		} finally {
			connecting = false;
		}
	}

	async function publishPresence(presence: DiscordPresence | null): Promise<DiscordStatus> {
		if (presence?.projectId !== startedForProjectId) {
			startedForProjectId = presence?.projectId ?? null;
			projectStartedAt = Date.now();
		}
		latest = presence;

		const settings = getSettings();
		const decision = decidePresence(latest, settings, projectStartedAt);
		if (decision.kind === "silent") {
			disconnect();
			return report();
		}

		await ensureConnected(settings.applicationId);
		if (ipc) {
			ipc.setActivity(decision.kind === "publish" ? decision.activity : null);
			if (ipc.lastError) {
				failure = ipc.lastError;
				ipc.lastError = null;
			}
		}
		return report();
	}

	return {
		publishPresence,

		async getStatus() {
			const settings = getSettings();
			const decision = decidePresence(latest, settings, projectStartedAt);
			if (decision.kind !== "silent" && !ipc?.connected)
				await ensureConnected(settings.applicationId);
			if (ipc?.lastError) {
				failure = ipc.lastError;
				ipc.lastError = null;
			}
			return status();
		},

		applySettingsChange() {
			failure = null;
			lastAttempt = 0;
			void publishPresence(latest);
		},

		stop() {
			ipc?.setActivity(null);
			disconnect();
			latest = null;
			startedForProjectId = null;
		},
	};
}
