/**
 * What an agent running in a ThinkRail terminal reports about itself.
 *
 * The report is POSTed to the host by the Claude Code plugin, at an address the host stamps into that
 * terminal's environment. It used to ride OSC 777 — the escape sequence whose original meaning is "show
 * a desktop notification" — which every other OSC 777-aware terminal happily rendered as one, since a
 * terminal decides for itself what to do with a sequence and nothing filters on our target string. A
 * plugin installed in `~/.claude` is global, so that spammed sessions ThinkRail was not rendering at all.
 * See packages/claude-plugin/SPEC.md.
 */
export type ClaudeCodeStatus = "idle" | "running" | "blocked" | "done" | "failed";

export type AgentTodoStatus = "pending" | "in_progress" | "completed";

/** One item of the agent's own plan — Claude Code's TodoWrite list, relayed as it was written. */
export interface AgentTodoItem {
	content: string;
	status: AgentTodoStatus;
	activeForm?: string;
}

export interface AgentStatusReport {
	event: string;
	session_id?: string;
	cwd?: string;
	project?: string;
	summary?: string;
	query?: string;
	response?: string;
	tool_name?: string;
	error_type?: string;
	/** What the session is running on right now — both can change mid-chat. */
	model?: string;
	effort?: string;
	/** `false` when the event settles status only — a continuation's Stop, which must not notify twice. */
	notify?: boolean;
	/** The agent's whole current plan; present only on a report that rewrote it. */
	todos?: AgentTodoItem[];
}

const TODO_STATUSES = new Set<string>(["pending", "in_progress", "completed"]);

/** The items a renderer can trust, from a payload an external plugin wrote. */
export function parseAgentTodos(value: unknown): AgentTodoItem[] | null {
	if (!Array.isArray(value)) return null;
	const items: AgentTodoItem[] = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.content !== "string" || typeof record.status !== "string") continue;
		if (!TODO_STATUSES.has(record.status)) continue;
		items.push({
			content: record.content,
			status: record.status as AgentTodoStatus,
			...(typeof record.activeForm === "string" ? { activeForm: record.activeForm } : {}),
		});
	}
	return items;
}

/** `"facts"` is an event that says what the session is running on without saying what it is doing. */
const STATUS_BY_EVENT: Record<string, ClaudeCodeStatus | "facts"> = {
	session_start: "idle",
	prompt_submit: "running",
	tool_complete: "running",
	permission_request: "blocked",
	stop: "done",
	stop_failure: "failed",
	model_switch: "facts",
};

/** Null for an event this version does not know; a newer plugin must not move a badge by accident. */
export function statusForAgentEvent(event: string): ClaudeCodeStatus | null {
	const status = STATUS_BY_EVENT[event];
	return status === undefined || status === "facts" ? null : status;
}

/** Whether the event means anything here at all — a facts-only one does, without moving the badge. */
export function agentEventKnown(event: string): boolean {
	return STATUS_BY_EVENT[event] !== undefined;
}

export function parseAgentStatusReport(body: unknown): AgentStatusReport | null {
	if (typeof body !== "object" || body === null) return null;
	const record = body as Record<string, unknown>;
	return typeof record.event === "string" ? (record as unknown as AgentStatusReport) : null;
}

export interface ClaudeCodeStatusPush {
	workspaceId: string;
	tabKey: string;
	/** Null when the report only carries facts: the badge keeps whatever it last had. */
	status: ClaudeCodeStatus | null;
	report: AgentStatusReport;
}
