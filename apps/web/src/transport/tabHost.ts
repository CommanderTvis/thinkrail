import { DEFAULT_GIT_CORS_PROXY, TAB_HOST_OPFS_DIRECTORY } from "@thinkrail/contracts";
import type { HostSocket } from "./transport";

export type HostMode = "process" | "tab";

const HOST_MODE_KEY = "thinkrail.hostMode";
const HOST_URL_KEY = "thinkrail.hostUrl";
const FILES_WORKER = `${import.meta.env.BASE_URL}tab-host-files-sw.js`;
const BYTES_REQUEST = "thinkrail-tab-host-bytes";
const CORS_PROXY_KEY = "thinkrail.gitCorsProxy";

/** A build that is only the Playground: no host to connect to, whatever the browser stored. */
export const playgroundOnly = import.meta.env.VITE_HOST_MODE === "tab";

export function hostMode(): HostMode {
	if (playgroundOnly) return "tab";
	try {
		return localStorage.getItem(HOST_MODE_KEY) === "tab" ? "tab" : "process";
	} catch {
		return "process";
	}
}

let waitingForOtherTab = false;
const waitingListeners = new Set<() => void>();

/** Whether this tab's Playground waits for another tab that holds it. */
export function playgroundWaiting(): boolean {
	return waitingForOtherTab;
}

export function subscribePlaygroundWaiting(listener: () => void): () => void {
	waitingListeners.add(listener);
	return () => waitingListeners.delete(listener);
}

function setPlaygroundWaiting(next: boolean): void {
	if (waitingForOtherTab === next) return;
	waitingForOtherTab = next;
	for (const listener of waitingListeners) listener();
}

/** The CORS proxy clones in this tab go through; an empty string clones without one. */
export function gitCorsProxy(): string {
	try {
		return localStorage.getItem(CORS_PROXY_KEY) ?? DEFAULT_GIT_CORS_PROXY;
	} catch {
		return DEFAULT_GIT_CORS_PROXY;
	}
}

export function setGitCorsProxy(proxy: string): void {
	try {
		localStorage.setItem(CORS_PROXY_KEY, proxy.trim());
	} catch {
		return;
	}
}

/** The host address this page dials in host mode: one the user entered, else this page's own origin. */
export function hostUrl(): string | undefined {
	try {
		return localStorage.getItem(HOST_URL_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * Accepts `host:port`, an http(s) URL or a ws(s) URL and returns the socket URL; empty means this
 * page's own origin.
 */
export function normalizeHostAddress(address: string): string | undefined {
	const trimmed = address.trim();
	if (!trimmed) return undefined;
	const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
	const url = new URL(withScheme);
	url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
	if (url.pathname === "/" || url.pathname === "") url.pathname = "/ws";
	return url.toString();
}

/** Connects to a process host at `address` (empty: this page's origin) and reloads. */
export function connectToHost(address: string): void {
	const url = normalizeHostAddress(address);
	try {
		if (url) localStorage.setItem(HOST_URL_KEY, url);
		else localStorage.removeItem(HOST_URL_KEY);
	} catch {
		return;
	}
	switchHostMode("process");
}

/** Switches where the host runs and reloads, since the transport is chosen once at boot. */
export function switchHostMode(mode: HostMode): void {
	try {
		if (mode === "tab") localStorage.setItem(HOST_MODE_KEY, "tab");
		else localStorage.removeItem(HOST_MODE_KEY);
	} catch {
		return;
	}
	void (mode === "tab" ? Promise.resolve() : unregisterFilesWorker()).then(() => location.reload());
}

/** In host mode the host itself serves `/files/` and `/blob/`, so a leftover tab-mode worker must go. */
export async function unregisterFilesWorker(): Promise<void> {
	const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
	await Promise.all(
		registrations
			.filter((registration) => registration.active?.scriptURL.endsWith(FILES_WORKER))
			.map((registration) => registration.unregister()),
	);
}

/**
 * Lets `/files/` and `/blob/` URLs (images, PDFs, a markdown file's pictures) resolve in tab mode: a
 * service worker forwards each such request here, and this page asks the tab host for the bytes.
 */
function serveFilesFrom(worker: Worker): void {
	if (!navigator.serviceWorker) return;
	let seq = 0;
	const waiting = new Map<number, MessagePort>();
	worker.addEventListener("message", (event: MessageEvent) => {
		const reply = event.data as { bytesReply?: { id: number } } | string;
		if (typeof reply === "string" || !reply.bytesReply) return;
		waiting.get(reply.bytesReply.id)?.postMessage(reply.bytesReply);
		waiting.delete(reply.bytesReply.id);
	});
	navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
		const request = event.data as { type?: string; pathname?: string };
		const [port] = event.ports;
		if (request.type !== BYTES_REQUEST || !port) return;
		const id = ++seq;
		waiting.set(id, port);
		worker.postMessage({ bytes: { id, pathname: request.pathname } });
	});
	void navigator.serviceWorker.register(FILES_WORKER).catch((error: unknown) => {
		console.error("ThinkRail could not serve tab files to viewers", error);
	});
}

/**
 * A WebSocket-shaped carrier to the host running in a worker of this tab. It opens on the host's first
 * frame, so a tab waiting for another tab to release the volume reads as still connecting.
 */
let playgroundWorker: Worker | null = null;

/**
 * Deletes everything the Playground stored in this browser: projects, chats, credentials, settings and
 * its file-serving worker. The tab host stops first so it cannot write the volume back; then the page reloads.
 */
export async function deletePlaygroundData(): Promise<void> {
	playgroundWorker?.terminate();
	playgroundWorker = null;
	const storage = await navigator.storage.getDirectory();
	await storage
		.removeEntry(TAB_HOST_OPFS_DIRECTORY, { recursive: true })
		.catch((error: unknown) => {
			if ((error as { name?: string }).name !== "NotFoundError") throw error;
		});
	await unregisterFilesWorker();
	try {
		localStorage.removeItem(CORS_PROXY_KEY);
	} finally {
		location.reload();
	}
}

export function openTabHostSocket(): HostSocket {
	const worker = new Worker(new URL("@thinkrail/tab-host/worker", import.meta.url), {
		type: "module",
		name: "thinkrail-tab-host",
	});
	playgroundWorker = worker;
	const socket: HostSocket = {
		readyState: WebSocket.CONNECTING,
		send: (data) => worker.postMessage(data),
		close: () => undefined,
		onopen: null,
		onmessage: null,
		onclose: null,
		onerror: null,
	};
	serveFilesFrom(worker);
	worker.addEventListener("message", (event: MessageEvent) => {
		if (typeof event.data !== "string") {
			if ((event.data as { waitingForOtherTab?: boolean }).waitingForOtherTab)
				setPlaygroundWaiting(true);
			return;
		}
		setPlaygroundWaiting(false);
		if (socket.readyState === WebSocket.CONNECTING) {
			(socket as { readyState: number }).readyState = WebSocket.OPEN;
			socket.onopen?.call(socket as WebSocket, new Event("open"));
		}
		socket.onmessage?.call(socket as WebSocket, event);
	});
	worker.addEventListener("error", (event) => {
		console.error("ThinkRail tab host failed", event.message);
		worker.terminate();
		(socket as { readyState: number }).readyState = WebSocket.CLOSED;
		socket.onclose?.call(socket as WebSocket, new CloseEvent("close"));
	});
	return socket;
}
