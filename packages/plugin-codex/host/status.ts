import type { CodexStatus, CodexStatusPush } from "../contracts";

const STATUS_OF_EVENT: Record<string, CodexStatus> = {
	SessionStart: "idle",
	UserPromptSubmit: "running",
	PostToolUse: "running",
	PermissionRequest: "blocked",
	Stop: "done",
	Interrupt: "idle",
};

export interface CodexHookReport {
	event: string;
	status: CodexStatus;
	sessionId?: string;
	model?: string;
	cwd?: string;
	transcriptPath?: string;
}

function text(fields: Record<string, unknown>, key: string): string | undefined {
	const value = fields[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** One Codex hook's stdin, as the hook command POSTs it verbatim. */
export function parseHookReport(body: unknown): CodexHookReport | null {
	if (typeof body !== "object" || body === null) return null;
	const fields = body as Record<string, unknown>;
	const event = text(fields, "hook_event_name");
	const status = event ? STATUS_OF_EVENT[event] : undefined;
	if (!event || !status) return null;
	const sessionId = text(fields, "session_id");
	const model = text(fields, "model");
	const cwd = text(fields, "cwd");
	const transcriptPath = text(fields, "transcript_path");
	return {
		event,
		status,
		...(sessionId ? { sessionId } : {}),
		...(model ? { model } : {}),
		...(cwd ? { cwd } : {}),
		...(transcriptPath ? { transcriptPath } : {}),
	};
}

export function createStatusStore() {
	const byWorkspace = new Map<string, Map<string, CodexStatusPush>>();
	return {
		record(push: CodexStatusPush): void {
			const tabs = byWorkspace.get(push.workspaceId) ?? new Map<string, CodexStatusPush>();
			byWorkspace.set(push.workspaceId, tabs);
			const cwd = push.cwd ?? tabs.get(push.tabKey)?.cwd;
			tabs.set(push.tabKey, { ...push, ...(cwd ? { cwd } : {}) });
		},
		snapshot(workspaceId: string): CodexStatusPush[] {
			return [...(byWorkspace.get(workspaceId)?.values() ?? [])];
		},
		forget(workspaceId: string, tabKey: string): void {
			byWorkspace.get(workspaceId)?.delete(tabKey);
		},
	};
}
