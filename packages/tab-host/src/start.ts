import { TAB_HOST_OPFS_DIRECTORY, type WsServerMessage } from "@thinkrail/contracts";
import type { PluginManifest } from "@thinkrail/plugin-api";
import type { PluginHostModule } from "@thinkrail/plugin-api/host";
import { createTabFsMirror } from "./fs";
import { TabHost } from "./host";
import { tabVolume } from "./volume";

const FLUSH_DELAY_MS = 300;

export interface TabHostPort {
	postMessage(message: unknown): void;
	addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** A client frame is the same JSON a process host reads off its socket. */
type ClientFrame =
	| { id: string; method: string; params: unknown }
	| { ack: string[] }
	| { resume: string[] };

/**
 * Runs the tab host on `port`: restores the volume from OPFS, answers client frames, and flushes
 * the volume back shortly after each change.
 */
export async function startTabHost(
	port: TabHostPort,
	plugins: { modules: readonly PluginHostModule[]; manifests: readonly PluginManifest[] },
): Promise<void> {
	const queued: ClientFrame[] = [];
	let host: TabHost | null = null;
	port.addEventListener("message", (event) => {
		if (typeof event.data !== "string") {
			const request = (event.data as { bytes?: { id: number; pathname: string } }).bytes;
			if (request && host) void answerBytes(port, host, request);
			return;
		}
		const frame = JSON.parse(event.data) as ClientFrame;
		if (host) void receive(host, frame);
		else queued.push(frame);
	});

	const held = await navigator.locks.query();
	if (held.held?.some((lock) => lock.name === TAB_HOST_OPFS_DIRECTORY))
		port.postMessage({ waitingForOtherTab: true });
	await holdVolumeLock();
	const storage = await navigator.storage.getDirectory();
	const root = await storage.getDirectoryHandle(TAB_HOST_OPFS_DIRECTORY, { create: true });
	const mirror = createTabFsMirror(tabVolume, root);
	await mirror.restore();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const persist = () => {
		clearTimeout(timer);
		timer = setTimeout(() => void mirror.flush(), FLUSH_DELAY_MS);
	};

	host = new TabHost({
		fs: tabVolume,
		post: (message: WsServerMessage) => port.postMessage(JSON.stringify(message)),
		persist,
		plugins,
	});
	await host.start();
	for (const frame of queued.splice(0)) void receive(host, frame);
}

/**
 * One tab at a time owns the OPFS volume: each holds the whole tree in memory and flushes its diff, so a
 * second writer would delete what the first one wrote. A later tab waits here until the owner closes.
 */
function holdVolumeLock(): Promise<void> {
	return new Promise((acquired) => {
		void navigator.locks.request(TAB_HOST_OPFS_DIRECTORY, () => {
			acquired();
			return new Promise<never>(() => undefined);
		});
	});
}

async function answerBytes(
	port: TabHostPort,
	host: TabHost,
	request: { id: number; pathname: string },
): Promise<void> {
	try {
		const { bytes, mime } = await host.readBytes(request.pathname);
		port.postMessage({ bytesReply: { id: request.id, ok: true, bytes, mime } });
	} catch (error) {
		port.postMessage({
			bytesReply: { id: request.id, ok: false, error: (error as Error).message },
		});
	}
}

async function receive(host: TabHost, frame: ClientFrame): Promise<void> {
	if ("id" in frame) await host.handle(frame);
}
