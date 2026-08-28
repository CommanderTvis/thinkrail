import {
	assistantToolCallsAreExecutable,
	type DelegationRunDetails,
	type LayoutToolId,
	type UserMessage,
} from "@thinkrail/contracts";
import type { ChatMessageOrder } from "./chatPreferences";
import { resolveProminence } from "./toolRegistry";
import { strArg } from "./tools/toolHelpers";
import type { ChatTurn, CompactionState, FailureRecovery, ToolResultState } from "./types";

// User-message collapse threshold (PlainUserTurn); also read by row height estimation.
export const LARGE_USER_MESSAGE = 500;

export interface ToolCallData {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	tool: ToolResultState | undefined;
	dead: boolean;
	streaming: boolean;
}

export type RoutineToolStep = { kind: "tool"; id: string } & ToolCallData;

export interface ThinkingStep {
	kind: "thinking";
	id: string;
	text: string;
	streaming: boolean;
	tools: RoutineToolStep[];
}

export type ActivityStep = RoutineToolStep | ThinkingStep;

export type ChatRow =
	| { kind: "user"; id: string; message: UserMessage; attachmentNames?: string[] }
	| { kind: "system"; id: string; text: string }
	| { kind: "error"; id: string; text: string; recovery?: FailureRecovery }
	| ({ kind: "compaction"; id: string } & CompactionState)
	| {
			kind: "retry";
			id: string;
			source: "turn" | "summarization";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
	  }
	| { kind: "markdown"; id: string; text: string }
	| { kind: "subagentCompletion"; id: string; details: DelegationRunDetails; text: string }
	| ({ kind: "tool"; id: string } & ToolCallData)
	| {
			kind: "activity";
			id: string;
			steps: ActivityStep[];
			live: boolean;
	  }
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
	turns: ChatTurn[],
	toolResults: Record<string, ToolResultState>,
	isStreaming: boolean,
	groupFor?: WrittenPathGroupResolver,
): ChatRow[] {
	const rows: ChatRow[] = [];
	let run: ActivityStep[] = [];

	const flushRun = (live = false) => {
		const first = run[0];
		if (!first) return;
		rows.push({ kind: "activity", id: `activity:${first.id}`, steps: nestRoutineRun(run), live });
		run = [];
	};

	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		if (!turn) continue;
		if (turn.kind === "assistant") {
			const { message } = turn;
			const dead = !assistantToolCallsAreExecutable(message.stopReason);
			for (let b = 0; b < message.content.length; b++) {
				const block = message.content[b];
				if (!block) continue;
				if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					run.push({
						kind: "thinking",
						id: `${turn.id}:thinking:${b}`,
						text: block.thinking,
						streaming: turn.streaming,
						tools: [],
					});
				} else if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					flushRun();
					rows.push({ kind: "markdown", id: `${turn.id}:text:${b}`, text: block.text });
				} else if (block.type === "toolCall") {
					const data: ToolCallData = {
						toolCallId: block.id,
						toolName: block.name,
						args: block.arguments,
						tool: toolResults[block.id],
						dead,
						streaming: turn.streaming,
					};
					if (resolveProminence(block.name).prominence === "primary") {
						flushRun();
						rows.push({ kind: "tool", id: block.id, ...data });
					} else {
						run.push({ kind: "tool", id: block.id, ...data });
					}
				}
			}
		} else {
			flushRun();
			switch (turn.kind) {
				case "user":
					rows.push({
						kind: "user",
						id: turn.id,
						message: turn.message,
						...(turn.attachmentNames ? { attachmentNames: turn.attachmentNames } : {}),
					});
					break;
				case "system":
					rows.push({ kind: "system", id: turn.id, text: turn.text });
					break;
				case "error":
					rows.push({
						kind: "error",
						id: turn.id,
						text: turn.text,
						...(turn.recovery ? { recovery: turn.recovery } : {}),
					});
					break;
				case "compaction":
					rows.push(turn);
					break;
				case "retry":
					rows.push({
						kind: "retry",
						id: turn.id,
						source: turn.source,
						attempt: turn.attempt,
						maxAttempts: turn.maxAttempts,
						delayMs: turn.delayMs,
					});
					break;
				case "subagentCompletion":
					rows.push({
						kind: "subagentCompletion",
						id: turn.id,
						details: turn.details,
						text: turn.text,
					});
					break;
			}
		}
		const roundEnded =
			turn.kind !== "user" &&
			(turns[i + 1]?.kind === "user" || (i === turns.length - 1 && !isStreaming));
		if (roundEnded) {
			flushRun();
			const data = turnDivider(turns, i, groupFor);
			if (data) rows.push({ kind: "divider", id: `${turn.id}:divider`, data });
		}
	}
	flushRun(isStreaming);
	return rows;
}

export interface TurnDividerGroupSpec {
	id: string;
	label: (count: number) => string;
	tool: LayoutToolId;
}

export interface TurnDividerGroup extends TurnDividerGroupSpec {
	paths: string[];
}

export interface TurnDividerData {
	elapsedMs: number | null;
	toolCount: number;
	groups: TurnDividerGroup[];
}

/** Which group a written path belongs to — `toolName` lets the core default keep spec_create's force-classify
 * behaviour without rows.ts naming that tool itself; `null` lands the path in the default "changed files" group. */
export type WrittenPathGroupResolver = (
	toolName: string,
	path: string,
) => TurnDividerGroupSpec | null;

const WRITE_TOOLS = new Set(["write", "edit", "spec_create"]);

const CHANGED_FILES_GROUP: TurnDividerGroupSpec = {
	id: "files",
	label: (n) => `${n} ${n === 1 ? "file changed" : "files changed"}`,
	tool: "changes",
};

export function turnDivider(
	turns: ChatTurn[],
	endIndex: number,
	groupFor: WrittenPathGroupResolver = () => null,
): TurnDividerData | null {
	let userIdx = -1;
	for (let i = endIndex; i >= 0; i--) {
		if (turns[i]?.kind === "user") {
			userIdx = i;
			break;
		}
	}
	if (userIdx < 0) return null;

	let toolCount = 0;
	const written = new Map<string, TurnDividerGroupSpec>();
	let endMs: number | null = null;
	for (let i = userIdx + 1; i <= endIndex; i++) {
		const turn = turns[i];
		if (turn?.kind === "assistant") {
			if (turn.message.timestamp) endMs = turn.message.timestamp;
			for (const block of turn.message.content) {
				if (block.type !== "toolCall") continue;
				toolCount++;
				if (!WRITE_TOOLS.has(block.name)) continue;
				const path = strArg(block.arguments, "path");
				if (!path) continue;
				const group = groupFor(block.name, path);
				if (group) written.set(path, group);
				else if (!written.has(path)) written.set(path, CHANGED_FILES_GROUP);
			}
		} else if (turn?.kind === "system" && turn.endedAt != null) {
			endMs = turn.endedAt;
		}
	}

	const user = turns[userIdx];
	const startMs = user?.kind === "user" ? user.message.timestamp : null;
	const elapsedMs = startMs != null && endMs != null ? endMs - startMs : null;

	const groupsById = new Map<string, TurnDividerGroup>();
	for (const [path, spec] of written) {
		const existing = groupsById.get(spec.id);
		if (existing) existing.paths.push(path);
		else groupsById.set(spec.id, { ...spec, paths: [path] });
	}
	return { elapsedMs, toolCount, groups: [...groupsById.values()] };
}

export function rowIndexForTurn(rows: ChatRow[], turnId: string): number {
	return rows.findIndex((r) => r.id === turnId || r.id.startsWith(`${turnId}:text:`));
}
