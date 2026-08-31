import type {
	ChatMessage,
	CompactionReason,
	MarkerMessage,
	NoticeLevel,
	RetryScope,
	StopReason,
	ToolCallBlock,
	TurnSettledMarker,
	UserMessage,
} from "@thinkrail/contracts";
import type { ChatMessageOrder } from "./messageOrder";
import { resolveProminence } from "./toolRegistry";
import { strArg } from "./tools/toolHelpers";
import type { FailureRecovery } from "./types";

export interface ToolStepData {
	block: ToolCallBlock;
	streaming: boolean;
}

export type RoutineToolStep = { kind: "tool"; id: string } & ToolStepData;

export interface ThinkingStep {
	kind: "thinking";
	id: string;
	text: string;
	streaming: boolean;
	tools: RoutineToolStep[];
}

export type ActivityStep = RoutineToolStep | ThinkingStep;

export interface RetryRowData {
	scope: RetryScope;
	attempt: number;
	maxAttempts: number;
	delayMs: number;
}

export interface LiveProgress {
	retries: Partial<Record<RetryScope, Omit<RetryRowData, "scope">>>;
	compacting: CompactionReason | null;
}

export type ChatRow =
	| { kind: "user"; id: string; message: UserMessage }
	| { kind: "notice"; id: string; level: NoticeLevel; text: string; recovery?: FailureRecovery }
	| { kind: "settled"; id: string; stopReason: StopReason; error?: string }
	| {
			kind: "compaction";
			id: string;
			reason: CompactionReason;
			summary: string;
			tokensBefore?: number;
	  }
	| ({ kind: "retry"; id: string } & RetryRowData)
	| { kind: "compacting"; id: string; reason: CompactionReason }
	| { kind: "markdown"; id: string; text: string }
	| ({ kind: "tool"; id: string } & ToolStepData)
	| { kind: "activity"; id: string; steps: ActivityStep[]; live: boolean }
	| { kind: "divider"; id: string; data: TurnDividerData };

export function projectRows(rows: ChatRow[], messageOrder: ChatMessageOrder): ChatRow[] {
	if (messageOrder === "oldest-first" || rows.length < 2) return rows;
	const groups: ChatRow[][] = [];
	let group: ChatRow[] = [];
	for (const row of rows) {
		if (row.kind === "user" && group.length > 0) {
			groups.push(group);
			group = [];
		}
		group.push(row);
	}
	if (group.length > 0) groups.push(group);

	const projected: ChatRow[] = [];
	for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
		const current = groups[groupIndex];
		if (!current) continue;
		for (let rowIndex = current.length - 1; rowIndex >= 0; rowIndex -= 1) {
			const row = current[rowIndex];
			if (row) projected.push(row);
		}
	}
	return projected;
}

const RETRY_SCOPES: readonly RetryScope[] = ["turn", "summarization"];

function nestRoutineRun(steps: ActivityStep[]): ActivityStep[] {
	const nested: ActivityStep[] = [];
	let currentThinking: ThinkingStep | undefined;
	for (const step of steps) {
		if (step.kind === "thinking") {
			currentThinking = { ...step, tools: [] };
			nested.push(currentThinking);
		} else if (currentThinking) {
			currentThinking.tools.push(step);
		} else {
			nested.push(step);
		}
	}
	return nested;
}

export function deriveRows(
	messages: ChatMessage[],
	isStreaming: boolean,
	progress: LiveProgress,
	isSpec?: (path: string) => boolean,
): ChatRow[] {
	const rows: ChatRow[] = [];
	let run: ActivityStep[] = [];

	const flushRun = (live = false) => {
		const first = run[0];
		if (!first) return;
		rows.push({ kind: "activity", id: `activity:${first.id}`, steps: nestRoutineRun(run), live });
		run = [];
	};

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (!message) continue;

		if (message.role === "assistant") {
			const streaming = message.endedAt === undefined;
			for (let b = 0; b < message.blocks.length; b++) {
				const block = message.blocks[b];
				if (!block) continue;
				if (block.type === "thinking") {
					if (block.text.trim().length === 0) continue;
					run.push({
						kind: "thinking",
						id: `${message.id}:thinking:${b}`,
						text: block.text,
						streaming,
						tools: [],
					});
				} else if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					flushRun();
					rows.push({ kind: "markdown", id: `${message.id}:text:${b}`, text: block.text });
				} else if (block.type === "toolCall") {
					if (resolveProminence(block.toolName).prominence === "primary") {
						flushRun();
						rows.push({ kind: "tool", id: block.toolCallId, block, streaming });
					} else {
						run.push({ kind: "tool", id: block.toolCallId, block, streaming });
					}
				}
			}
			continue;
		}

		if (message.role === "user") {
			flushRun();
			if (!message.hidden) rows.push({ kind: "user", id: message.id, message });
			continue;
		}

		const marker = message.marker;
		if (marker.kind === "questionAnswers") continue;

		flushRun();
		if (marker.kind === "notice") {
			rows.push({ kind: "notice", id: message.id, level: marker.level, text: marker.text });
		} else if (marker.kind === "compaction") {
			rows.push({
				kind: "compaction",
				id: message.id,
				reason: marker.reason,
				summary: marker.summary,
				...(marker.tokensBefore !== undefined ? { tokensBefore: marker.tokensBefore } : {}),
			});
		} else if (marker.kind === "turnSettled") {
			rows.push({
				kind: "settled",
				id: message.id,
				stopReason: marker.stopReason,
				...(marker.error !== undefined ? { error: marker.error } : {}),
			});
			const data = turnDivider(messages, i, isSpec);
			if (data) rows.push({ kind: "divider", id: `${message.id}:divider`, data });
		}
	}
	flushRun(isStreaming);

	for (const scope of RETRY_SCOPES) {
		const retry = progress.retries[scope];
		if (retry) rows.push({ kind: "retry", id: `retry:${scope}`, scope, ...retry });
	}
	if (progress.compacting) {
		rows.push({ kind: "compacting", id: "compacting", reason: progress.compacting });
	}

	return rows;
}

export interface TurnDividerData {
	elapsedMs: number | null;
	toolCount: number;
	specs: string[];
	changedFiles: string[];
}

const SPEC_WRITER_TOOL = "spec_create";

const FILE_WRITER_TOOLS = new Set(["write", "edit"]);

function isSettledMarker(
	message: ChatMessage | undefined,
): message is MarkerMessage<TurnSettledMarker> {
	return message?.role === "marker" && message.marker.kind === "turnSettled";
}

export function turnDivider(
	messages: ChatMessage[],
	endIndex: number,
	isSpec: (path: string) => boolean = () => false,
): TurnDividerData | null {
	const end = messages[endIndex];
	if (!isSettledMarker(end)) return null;

	let startIndex = -1;
	for (let i = endIndex - 1; i >= 0; i--) {
		if (messages[i]?.role === "user") {
			startIndex = i;
			break;
		}
	}

	let toolCount = 0;
	const written = new Map<string, boolean>();
	for (let i = startIndex + 1; i < endIndex; i++) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		for (const block of message.blocks) {
			if (block.type !== "toolCall") continue;
			toolCount++;
			const specWrite = block.toolName === SPEC_WRITER_TOOL;
			if (!specWrite && !FILE_WRITER_TOOLS.has(block.toolName)) continue;
			const path = strArg(block.arguments, "path");
			if (!path) continue;
			if (specWrite || isSpec(path)) written.set(path, true);
			else if (!written.has(path)) written.set(path, false);
		}
	}

	const elapsedMs =
		end.marker.startedAt !== undefined ? end.timestamp - end.marker.startedAt : null;

	const specs: string[] = [];
	const changedFiles: string[] = [];
	for (const [path, isSpecPath] of written) (isSpecPath ? specs : changedFiles).push(path);
	return { elapsedMs, toolCount, specs, changedFiles };
}

export function rowIndexForMessage(rows: ChatRow[], messageId: string): number {
	return rows.findIndex((r) => r.id === messageId || r.id.startsWith(`${messageId}:text:`));
}
