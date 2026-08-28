import type { DiscordPresence, DiscordSettings, DiscordStatus } from "@thinkrail/contracts";
import { logger } from "../log";

import { getConfig } from "../settings";
import { DiscordIpc } from "./ipc";
import { decidePresence, statusFor } from "./presence";

const log = logger("discord");
const RETRY_FLOOR_MS = 5_000;

type StatusPublisher = (status: DiscordStatus) => void;

let publishStatus: StatusPublisher | null = null;
let ipc: DiscordIpc | null = null;
let latest: DiscordPresence | null = null;
let projectStartedAt = Date.now();
let startedForProjectId: string | null = null;
let failure: string | null = null;
let lastAttempt = 0;
let connecting = false;

export function setDiscordStatusPublisher(fn: StatusPublisher | null): void {
	publishStatus = fn;
}

function settings(): DiscordSettings {
	return getConfig().discord;
}

function disconnect(): void {
	ipc?.close();
	ipc = null;
	failure = null;
}

function status(): DiscordStatus {
	return statusFor(
		decidePresence(latest, settings(), projectStartedAt),
		ipc?.connected === true,
		failure,
	);
}

function announce(): DiscordStatus {
	const next = status();
	publishStatus?.(next);
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
				announce();
			}
		});
		ipc = client;
		failure = null;
	} catch (error) {
		client.close();
		failure = error instanceof Error ? error.message : "Could not reach Discord.";
		log.debug(failure);
	} finally {
		connecting = false;
	}
}

export async function publishPresence(presence: DiscordPresence | null): Promise<DiscordStatus> {
	if (presence?.projectId !== startedForProjectId) {
		startedForProjectId = presence?.projectId ?? null;
		projectStartedAt = Date.now();
	}
	latest = presence;

	const current = settings();
	const decision = decidePresence(latest, current, projectStartedAt);
	if (decision.kind === "silent") {
		disconnect();
		return announce();
	}

	await ensureConnected(current.applicationId);
	if (ipc) {
		ipc.setActivity(decision.kind === "publish" ? decision.activity : null);
		if (ipc.lastError) {
			failure = ipc.lastError;
			ipc.lastError = null;
		}
	}
	return announce();
}

export async function getDiscordStatus(): Promise<DiscordStatus> {
	const current = settings();
	const decision = decidePresence(latest, current, projectStartedAt);
	if (decision.kind !== "silent" && !ipc?.connected) await ensureConnected(current.applicationId);
	if (ipc?.lastError) {
		failure = ipc.lastError;
		ipc.lastError = null;
	}
	return status();
}

export function applyDiscordSettings(): DiscordStatus {
	failure = null;
	lastAttempt = 0;
	if (!settings().enabled) {
		ipc?.setActivity(null);
		disconnect();
		return announce();
	}
	void publishPresence(latest);
	return status();
}

export function resetDiscordForTests(): void {
	ipc?.close();
	ipc = null;
	latest = null;
	projectStartedAt = Date.now();
	startedForProjectId = null;
	failure = null;
	lastAttempt = 0;
	connecting = false;
}

export function stopDiscord(): void {
	ipc?.setActivity(null);
	disconnect();
	latest = null;
	startedForProjectId = null;
}
