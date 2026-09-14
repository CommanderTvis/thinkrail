import { closeSync, openSync, readSync, statSync } from "node:fs";

export const INTERRUPT_POLL_MS = 1000;
export const INTERRUPT_CLOCK_SLACK_MS = 1000;
const TAIL_BYTES = 16 * 1024;
const INTERRUPT_MARKER = "[Request interrupted by user";

interface TranscriptLine {
	type?: unknown;
	timestamp?: unknown;
	message?: { content?: unknown };
}

function readTail(path: string): string | null {
	try {
		const size = statSync(path).size;
		const length = Math.min(size, TAIL_BYTES);
		const buffer = Buffer.alloc(length);
		const fd = openSync(path, "r");
		try {
			readSync(fd, buffer, 0, length, size - length);
		} finally {
			closeSync(fd);
		}
		return buffer.toString("utf8");
	} catch {
		return null;
	}
}

function parseLine(line: string): TranscriptLine | null {
	if (line === "") return null;
	try {
		const parsed: unknown = JSON.parse(line);
		return typeof parsed === "object" && parsed !== null ? (parsed as TranscriptLine) : null;
	} catch {
		return null;
	}
}

function isInterruptText(content: unknown): boolean {
	if (typeof content === "string") return content.startsWith(INTERRUPT_MARKER);
	if (!Array.isArray(content)) return false;
	return content.some(
		(block: unknown) =>
			typeof block === "object" &&
			block !== null &&
			(block as { type?: unknown }).type === "text" &&
			typeof (block as { text?: unknown }).text === "string" &&
			(block as { text: string }).text.startsWith(INTERRUPT_MARKER),
	);
}

/** Whether the conversation's last turn on disk is the user's interrupt, written at `since` or later. */
export function transcriptInterruptedSince(path: string, since: number): boolean {
	const tail = readTail(path);
	if (tail === null) return false;
	const lines = tail.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const entry = parseLine(lines[index] ?? "");
		if (entry === null || (entry.type !== "user" && entry.type !== "assistant")) continue;
		if (entry.type !== "user" || !isInterruptText(entry.message?.content)) return false;
		return typeof entry.timestamp === "string" && Date.parse(entry.timestamp) >= since;
	}
	return false;
}

export interface InterruptWatchDeps {
	probe?: (path: string, since: number) => boolean;
	now?: () => number;
	schedule?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
	cancel?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface InterruptWatch {
	/** Starts (or restarts, from now) watching a running turn; `locate` finds the transcript once it exists. */
	track(key: string, locate: () => string | null, onInterrupted: () => void): void;
	stop(key: string): void;
	stopAll(): void;
}

interface Tracked {
	locate: () => string | null;
	since: number;
	onInterrupted: () => void;
}

export function createInterruptWatch(deps: InterruptWatchDeps = {}): InterruptWatch {
	const probe = deps.probe ?? transcriptInterruptedSince;
	const now = deps.now ?? Date.now;
	const schedule = deps.schedule ?? ((fn, ms) => setInterval(fn, ms));
	const cancel = deps.cancel ?? ((handle) => clearInterval(handle));

	const tracked = new Map<string, Tracked>();
	let timer: ReturnType<typeof setInterval> | null = null;

	const stop = (key: string): void => {
		tracked.delete(key);
		if (tracked.size === 0 && timer !== null) {
			cancel(timer);
			timer = null;
		}
	};

	const sweep = (): void => {
		for (const [key, entry] of tracked) {
			const path = entry.locate();
			if (path === null || !probe(path, entry.since)) continue;
			stop(key);
			entry.onInterrupted();
		}
	};

	return {
		track(key, locate, onInterrupted) {
			tracked.set(key, { locate, since: now() - INTERRUPT_CLOCK_SLACK_MS, onInterrupted });
			if (timer === null) timer = schedule(sweep, INTERRUPT_POLL_MS);
		},
		stop,
		stopAll() {
			for (const key of [...tracked.keys()]) stop(key);
		},
	};
}
