export type ClaudeConfigScope = "managed" | "local" | "project" | "user" | "default";

export const CLAUDE_CONFIG_SCOPE_ORDER: readonly ClaudeConfigScope[] = [
	"managed",
	"local",
	"project",
	"user",
	"default",
];

export interface ClaudeConfigOrigin {
	scope: ClaudeConfigScope;
	path: string | null;
	/** Where inside `path` the value is declared, as JSON object keys. Absent when the file *is* the value. */
	keyPath?: readonly string[];
}

export interface ClaudeSettingValue {
	key: string;
	value: unknown;
	origin: ClaudeConfigOrigin;
	shadowed: { value: unknown; origin: ClaudeConfigOrigin }[];
	/** The key's entry in Claude Code's settings reference. Absent for a key that reference does not list. */
	docsUrl?: string;
}

export type ClaudeContextKind =
	| "instructions"
	| "local-instructions"
	| "rules"
	| "memory"
	| "import";

export interface ClaudeContextLayer {
	kind: ClaudeContextKind;
	label: string;
	path: string;
	origin: ClaudeConfigOrigin;
	bytes: number;
	pathGlobs?: string[];
	lazy?: boolean;
	/** Nesting under the file that `@`-imported this one; 0 (absent) for a layer loaded in its own right. */
	depth?: number;
}

export type ClaudeCapabilityKind = "mcp" | "plugin" | "skill" | "agent" | "hook" | "marketplace";

export interface ClaudeCapability {
	kind: ClaudeCapabilityKind;
	name: string;
	origin: ClaudeConfigOrigin;
	enabled: boolean;
	detail?: string;
	/** The setting that switched this off, when something did. Absent for a capability nothing disables. */
	disabledBy?: ClaudeConfigOrigin;
}

export interface ClaudeConfigProblem {
	severity: "warning" | "info";
	title: string;
	detail: string;
	path?: string;
}

export interface ClaudeConfigSnapshot {
	workspaceId: string;
	root: string;
	context: ClaudeContextLayer[];
	settings: ClaudeSettingValue[];
	capabilities: ClaudeCapability[];
	problems: ClaudeConfigProblem[];
	inspected: { path: string; scope: ClaudeConfigScope; exists: boolean }[];
	/** Every key Claude Code documents, so a key can be added without already appearing in a file. */
	knownSettingKeys: readonly string[];
}

export type ThinkrailPluginState = "enabled" | "outdated" | "absent" | "unknown";

export interface ThinkrailPluginStatus {
	state: ThinkrailPluginState;
	installedVersion: string | null;
	availableVersion: string;
	pendingChange: string | null;
}

/** Scopes an edit may target. `managed` is deliberately absent: it belongs to whoever deploys it. */
export type ClaudeWritableScope = Extract<ClaudeConfigScope, "user" | "project" | "local">;

export const CLAUDE_WRITABLE_SCOPES: readonly ClaudeWritableScope[] = ["user", "project", "local"];

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

/** One of Claude Code's own `plugin marketplace` subcommands, host-composed and approved as argv. */
export type ClaudeMarketplaceAction =
	| { kind: "add"; source: string; scope: ClaudeWritableScope }
	| { kind: "remove"; name: string; scope: ClaudeWritableScope }
	| { kind: "update"; name: string };

export type ClaudeFileTemplate = "project-local-instructions" | "project-instructions";

/** What a settings key may be set to from the pane. `null` removes the key. */
export type ClaudeSettingInput = boolean | number | string | string[] | null;

export type ClaudeMcpTransport = "stdio" | "http" | "sse";

export interface ClaudeMcpServerDraft {
	transport: ClaudeMcpTransport;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
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

export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

export type ClaudeMarketplaceSource =
	| { kind: "github"; repo: string }
	| { kind: "directory"; path: string };

export type ClaudeEdit =
	| { kind: "setting"; key: string; value: ClaudeSettingInput }
	| { kind: "mcp"; server: string; allowed: boolean }
	| { kind: "mcp-add"; server: string; draft: ClaudeMcpServerDraft }
	| { kind: "plugin"; name: string; enabled: boolean }
	| { kind: "plugin-add"; marketplace: string; source: ClaudeMarketplaceSource; plugin: string }
	| { kind: "hook"; event: ClaudeHookEvent; matcher: string; command: string }
	| { kind: "skill-create"; name: string; description: string }
	| { kind: "skill"; name: string; enabled: boolean }
	| { kind: "file"; template: ClaudeFileTemplate };

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

export interface ClaudeEditRequest {
	workspaceId: string;
	scope: ClaudeWritableScope;
	edit: ClaudeEdit;
}

export interface ClaudeDiffLine {
	/** `gap` is elided unchanged text, carrying how many lines it stands for rather than showing them. */
	kind: "context" | "add" | "remove" | "gap";
	text: string;
}

export interface ClaudeEditPlan {
	path: string;
	exists: boolean;
	/** One sentence naming both the change and who it affects. */
	summary: string;
	diff: ClaudeDiffLine[];
	/** Reasons the write may not do what the user expects; never a reason to refuse it. */
	warnings: string[];
	/** The content this plan was built from, so applying can refuse if the file moved underneath it. */
	baseHash: string;
	/** False when the edit would leave the file exactly as it is. */
	changes: boolean;
}
