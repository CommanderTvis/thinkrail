import type {
	ChatBlock,
	ChatMessage,
	ConfigSummary,
	MessageId,
	SessionUsage,
	ToolCallId,
	ToolCallPatch,
} from "@thinkrail/contracts";

export const TRANSCRIPT_LOG_VERSION = 1;

export interface LogHead {
	t: "head";
	v: number;
	sessionId: string;
	workspaceId: string;
	cwd: string;
	agentId: string;
	createdAt: number;
}

export interface LogMessage {
	t: "msg";
	seed: ChatMessage;
}

export type LogPartBody =
	| { k: "chunk"; kind: "text" | "thinking"; d: string }
	| { k: "block"; block: ChatBlock };

export interface LogPart {
	t: "part";
	id: MessageId;
	b: number;
	body: LogPartBody;
}

export interface LogTool {
	t: "tool";
	id: ToolCallId;
	p: ToolCallPatch;
}

export interface LogPatch {
	t: "patch";
	id: MessageId;
	endedAt?: number;
	superseded?: boolean;
}

export interface LogState {
	t: "state";
	ts: number;
	title?: string;
	config?: ConfigSummary[];
	usage?: SessionUsage;
}

export type LogEntry = LogHead | LogMessage | LogPart | LogTool | LogPatch | LogState;

const ENTRY_TYPES: ReadonlySet<string> = new Set(["head", "msg", "part", "tool", "patch", "state"]);

export function encodeEntry(entry: LogEntry): string {
	return `${JSON.stringify(entry)}\n`;
}

export function decodeEntry(line: string): LogEntry | null {
	if (!line.trim()) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const kind = (parsed as { t?: unknown }).t;
	return typeof kind === "string" && ENTRY_TYPES.has(kind) ? (parsed as LogEntry) : null;
}

export interface DecodedLog {
	head: LogHead | null;
	entries: LogEntry[];
	completeBytes: number;
}

export function decodeLog(text: string): DecodedLog {
	const complete = text.slice(0, text.lastIndexOf("\n") + 1);
	const entries: LogEntry[] = [];
	let head: LogHead | null = null;
	for (const line of complete.split("\n")) {
		const entry = decodeEntry(line);
		if (!entry) continue;
		if (entry.t === "head") {
			head ??= entry;
			continue;
		}
		entries.push(entry);
	}
	return { head, entries, completeBytes: Buffer.byteLength(complete, "utf8") };
}
