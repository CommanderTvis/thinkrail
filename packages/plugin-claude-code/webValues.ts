import type {
	AgentTodoItem,
	AgentTodoStatus,
	ClaudeEdit,
	ClaudeFileTemplate,
	ClaudeWritableScope,
} from "./contracts";

/** Scopes an edit may target. `managed` is deliberately absent: it belongs to whoever deploys it. */
export const CLAUDE_WRITABLE_SCOPES = ["user", "project", "local"] as const;

/** Plain language, because naming the file is what the tool this replaces never does. */
export const CLAUDE_SCOPE_WORDING: Record<ClaudeWritableScope, string> = {
	user: "you, in every project on this machine",
	project: "everyone who works on this project (checked into git)",
	local: "you, in this project only (usually gitignored)",
};

/** Claude Code's own installer wording for plugin scopes, kept verbatim so both UIs say one thing. */
export const CLAUDE_PLUGIN_SCOPE_WORDING: Record<ClaudeWritableScope, string> = {
	user: "for you",
	project: "for all collaborators on this repository",
	local: "for you, in this repo only",
};

/** A template names one file, so it names one scope; offering three that write the same path is theatre. */
export const CLAUDE_TEMPLATE_SCOPE: Record<ClaudeFileTemplate, ClaudeWritableScope> = {
	"project-instructions": "project",
	"project-local-instructions": "local",
};

/** A skill is a directory Claude Code looks for in two places; there is no third, private one. */
export const CLAUDE_SKILL_SCOPES: readonly ClaudeWritableScope[] = ["user", "project"];

/** The scopes an edit can honestly land in. The pane offers these and the host refuses anything else. */
export function claudeEditScopes(edit: ClaudeEdit): readonly ClaudeWritableScope[] {
	if (edit.kind === "file") return [CLAUDE_TEMPLATE_SCOPE[edit.template]];
	if (edit.kind === "skill-create") return CLAUDE_SKILL_SCOPES;
	return CLAUDE_WRITABLE_SCOPES;
}

/** The hook events worth offering in a form. An unlisted one still resolves and still shows. */
export const CLAUDE_HOOK_EVENTS = [
	"PreToolUse",
	"PostToolUse",
	"UserPromptSubmit",
	"Notification",
	"Stop",
	"SubagentStop",
	"SessionStart",
	"SessionEnd",
	"PreCompact",
] as const;

const TODO_STATUS_SET = new Set<string>(["pending", "in_progress", "completed"]);

/** The items a renderer can trust, from a payload the hook wrote. */
export function parseAgentTodos(value: unknown): AgentTodoItem[] | null {
	if (!Array.isArray(value)) return null;
	const items: AgentTodoItem[] = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.content !== "string" || typeof record.status !== "string") continue;
		if (!TODO_STATUS_SET.has(record.status)) continue;
		items.push({
			content: record.content,
			status: record.status as AgentTodoStatus,
			...(typeof record.activeForm === "string" ? { activeForm: record.activeForm } : {}),
		});
	}
	return items;
}
