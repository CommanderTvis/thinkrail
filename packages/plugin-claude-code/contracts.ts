import { definePluginContract } from "@thinkrail/plugin-api";
import { type Static, Type } from "typebox";

// ---------------------------------------------------------------------------
// claudeConfig domain — moved from packages/contracts/src/claudeConfig.ts
// ---------------------------------------------------------------------------

export const CLAUDE_CONFIG_SCOPE_ORDER = [
	"managed",
	"local",
	"project",
	"user",
	"default",
] as const;

export const ClaudeConfigScopeSchema = Type.Union([
	Type.Literal("managed"),
	Type.Literal("local"),
	Type.Literal("project"),
	Type.Literal("user"),
	Type.Literal("default"),
]);
export type ClaudeConfigScope = Static<typeof ClaudeConfigScopeSchema>;

export const ClaudeConfigOriginSchema = Type.Object({
	scope: ClaudeConfigScopeSchema,
	path: Type.Union([Type.String(), Type.Null()]),
	/** Where inside `path` the value is declared, as JSON object keys. Absent when the file *is* the value. */
	keyPath: Type.Optional(Type.Array(Type.String())),
});
export type ClaudeConfigOrigin = Static<typeof ClaudeConfigOriginSchema>;

export const ClaudeSettingValueSchema = Type.Object({
	key: Type.String(),
	value: Type.Unknown(),
	origin: ClaudeConfigOriginSchema,
	shadowed: Type.Array(Type.Object({ value: Type.Unknown(), origin: ClaudeConfigOriginSchema })),
	/** The key's entry in Claude Code's settings reference. Absent for a key that reference does not list. */
	docsUrl: Type.Optional(Type.String()),
});
export type ClaudeSettingValue = Static<typeof ClaudeSettingValueSchema>;

export const CLAUDE_CONTEXT_KINDS = [
	"instructions",
	"local-instructions",
	"rules",
	"memory",
	"import",
] as const;
export const ClaudeContextKindSchema = Type.Union([
	Type.Literal("instructions"),
	Type.Literal("local-instructions"),
	Type.Literal("rules"),
	Type.Literal("memory"),
	Type.Literal("import"),
]);
export type ClaudeContextKind = Static<typeof ClaudeContextKindSchema>;

export const ClaudeContextLayerSchema = Type.Object({
	kind: ClaudeContextKindSchema,
	label: Type.String(),
	path: Type.String(),
	origin: ClaudeConfigOriginSchema,
	bytes: Type.Number(),
	pathGlobs: Type.Optional(Type.Array(Type.String())),
	lazy: Type.Optional(Type.Boolean()),
	/** Nesting under the file that `@`-imported this one; absent for a layer loaded in its own right. */
	depth: Type.Optional(Type.Number()),
});
export type ClaudeContextLayer = Static<typeof ClaudeContextLayerSchema>;

export const CLAUDE_CAPABILITY_KINDS = [
	"mcp",
	"plugin",
	"skill",
	"agent",
	"hook",
	"marketplace",
] as const;
export const ClaudeCapabilityKindSchema = Type.Union([
	Type.Literal("mcp"),
	Type.Literal("plugin"),
	Type.Literal("skill"),
	Type.Literal("agent"),
	Type.Literal("hook"),
	Type.Literal("marketplace"),
]);
export type ClaudeCapabilityKind = Static<typeof ClaudeCapabilityKindSchema>;

export const ClaudeCapabilitySchema = Type.Object({
	kind: ClaudeCapabilityKindSchema,
	name: Type.String(),
	origin: ClaudeConfigOriginSchema,
	enabled: Type.Boolean(),
	detail: Type.Optional(Type.String()),
	/** The setting that switched this off, when something did. Absent for a capability nothing disables. */
	disabledBy: Type.Optional(ClaudeConfigOriginSchema),
});
export type ClaudeCapability = Static<typeof ClaudeCapabilitySchema>;

export const ClaudeUsageSeveritySchema = Type.Union([
	Type.Literal("normal"),
	Type.Literal("warning"),
	Type.Literal("critical"),
]);
export type ClaudeUsageSeverity = Static<typeof ClaudeUsageSeveritySchema>;

export const ClaudeUsageWindowSchema = Type.Object({
	id: Type.String(),
	label: Type.String(),
	percent: Type.Number(),
	severity: ClaudeUsageSeveritySchema,
	resetsAt: Type.Optional(Type.String()),
});
export type ClaudeUsageWindow = Static<typeof ClaudeUsageWindowSchema>;

export const ClaudeAccountSchema = Type.Object({
	loggedIn: Type.Boolean(),
	email: Type.Optional(Type.String()),
	organization: Type.Optional(Type.String()),
	subscription: Type.Optional(Type.String()),
	authMethod: Type.Optional(Type.String()),
	usage: Type.Array(ClaudeUsageWindowSchema),
	/** When Claude Code last refreshed the usage it caches; absent when it never has. */
	usageFetchedAt: Type.Optional(Type.String()),
});
export type ClaudeAccount = Static<typeof ClaudeAccountSchema>;

export const ClaudeConfigProblemSchema = Type.Object({
	severity: Type.Union([Type.Literal("warning"), Type.Literal("info")]),
	title: Type.String(),
	detail: Type.String(),
	path: Type.Optional(Type.String()),
});
export type ClaudeConfigProblem = Static<typeof ClaudeConfigProblemSchema>;

export const ClaudeConfigSnapshotSchema = Type.Object({
	workspaceId: Type.String(),
	root: Type.String(),
	context: Type.Array(ClaudeContextLayerSchema),
	settings: Type.Array(ClaudeSettingValueSchema),
	capabilities: Type.Array(ClaudeCapabilitySchema),
	problems: Type.Array(ClaudeConfigProblemSchema),
	inspected: Type.Array(
		Type.Object({ path: Type.String(), scope: ClaudeConfigScopeSchema, exists: Type.Boolean() }),
	),
	/** Every key Claude Code documents, so a key can be added without already appearing in a file. */
	knownSettingKeys: Type.Array(Type.String()),
});
export type ClaudeConfigSnapshot = Static<typeof ClaudeConfigSnapshotSchema>;

export const THINKRAIL_PLUGIN_STATES = ["enabled", "outdated", "absent", "unknown"] as const;
export const ThinkrailPluginStateSchema = Type.Union([
	Type.Literal("enabled"),
	Type.Literal("outdated"),
	Type.Literal("absent"),
	Type.Literal("unknown"),
]);
export type ThinkrailPluginState = Static<typeof ThinkrailPluginStateSchema>;

export const ThinkrailPluginStatusSchema = Type.Object({
	state: ThinkrailPluginStateSchema,
	installedVersion: Type.Union([Type.String(), Type.Null()]),
	availableVersion: Type.String(),
	pendingChange: Type.Union([Type.String(), Type.Null()]),
});
export type ThinkrailPluginStatus = Static<typeof ThinkrailPluginStatusSchema>;

export const ClaudeWritableScopeSchema = Type.Union([
	Type.Literal("user"),
	Type.Literal("project"),
	Type.Literal("local"),
]);
export type ClaudeWritableScope = Static<typeof ClaudeWritableScopeSchema>;

export {
	CLAUDE_PLUGIN_SCOPE_WORDING,
	CLAUDE_SCOPE_WORDING,
	CLAUDE_WRITABLE_SCOPES,
} from "./webValues";

export const ClaudeMarketplaceActionSchema = Type.Union([
	Type.Object({
		kind: Type.Literal("add"),
		source: Type.String(),
		scope: ClaudeWritableScopeSchema,
	}),
	Type.Object({
		kind: Type.Literal("remove"),
		name: Type.String(),
		scope: ClaudeWritableScopeSchema,
	}),
	Type.Object({ kind: Type.Literal("update"), name: Type.String() }),
]);
export type ClaudeMarketplaceAction = Static<typeof ClaudeMarketplaceActionSchema>;

export const CLAUDE_FILE_TEMPLATES = [
	"project-local-instructions",
	"project-instructions",
] as const;
export const ClaudeFileTemplateSchema = Type.Union([
	Type.Literal("project-local-instructions"),
	Type.Literal("project-instructions"),
]);
export type ClaudeFileTemplate = Static<typeof ClaudeFileTemplateSchema>;

/** What a settings key may be set to from the pane. `null` removes the key. */
export const ClaudeSettingInputSchema = Type.Union([
	Type.Boolean(),
	Type.Number(),
	Type.String(),
	Type.Array(Type.String()),
	Type.Null(),
]);
export type ClaudeSettingInput = Static<typeof ClaudeSettingInputSchema>;

export const ClaudeMcpTransportSchema = Type.Union([
	Type.Literal("stdio"),
	Type.Literal("http"),
	Type.Literal("sse"),
]);
export type ClaudeMcpTransport = Static<typeof ClaudeMcpTransportSchema>;

export const ClaudeMcpServerDraftSchema = Type.Object({
	transport: ClaudeMcpTransportSchema,
	command: Type.Optional(Type.String()),
	args: Type.Optional(Type.Array(Type.String())),
	env: Type.Optional(Type.Record(Type.String(), Type.String())),
	url: Type.Optional(Type.String()),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
});
export type ClaudeMcpServerDraft = Static<typeof ClaudeMcpServerDraftSchema>;

export { CLAUDE_HOOK_EVENTS } from "./webValues";

export const ClaudeHookEventSchema = Type.Union([
	Type.Literal("PreToolUse"),
	Type.Literal("PostToolUse"),
	Type.Literal("UserPromptSubmit"),
	Type.Literal("Notification"),
	Type.Literal("Stop"),
	Type.Literal("SubagentStop"),
	Type.Literal("SessionStart"),
	Type.Literal("SessionEnd"),
	Type.Literal("PreCompact"),
]);
export type ClaudeHookEvent = Static<typeof ClaudeHookEventSchema>;

export const ClaudeMarketplaceSourceSchema = Type.Union([
	Type.Object({ kind: Type.Literal("github"), repo: Type.String() }),
	Type.Object({ kind: Type.Literal("directory"), path: Type.String() }),
]);
export type ClaudeMarketplaceSource = Static<typeof ClaudeMarketplaceSourceSchema>;

export const ClaudeEditSchema = Type.Union([
	Type.Object({
		kind: Type.Literal("setting"),
		key: Type.String(),
		value: ClaudeSettingInputSchema,
	}),
	Type.Object({ kind: Type.Literal("mcp"), server: Type.String(), allowed: Type.Boolean() }),
	Type.Object({
		kind: Type.Literal("mcp-add"),
		server: Type.String(),
		draft: ClaudeMcpServerDraftSchema,
	}),
	Type.Object({ kind: Type.Literal("plugin"), name: Type.String(), enabled: Type.Boolean() }),
	Type.Object({
		kind: Type.Literal("plugin-add"),
		marketplace: Type.String(),
		source: ClaudeMarketplaceSourceSchema,
		plugin: Type.String(),
	}),
	Type.Object({
		kind: Type.Literal("hook"),
		event: ClaudeHookEventSchema,
		matcher: Type.String(),
		command: Type.String(),
	}),
	Type.Object({
		kind: Type.Literal("skill-create"),
		name: Type.String(),
		description: Type.String(),
	}),
	Type.Object({ kind: Type.Literal("skill"), name: Type.String(), enabled: Type.Boolean() }),
	Type.Object({ kind: Type.Literal("file"), template: ClaudeFileTemplateSchema }),
]);
export type ClaudeEdit = Static<typeof ClaudeEditSchema>;

export { CLAUDE_SKILL_SCOPES, CLAUDE_TEMPLATE_SCOPE, claudeEditScopes } from "./webValues";

export const ClaudeEditRequestSchema = Type.Object({
	workspaceId: Type.String(),
	scope: ClaudeWritableScopeSchema,
	edit: ClaudeEditSchema,
});
export type ClaudeEditRequest = Static<typeof ClaudeEditRequestSchema>;

export const ClaudeDiffLineSchema = Type.Object({
	/** `gap` is elided unchanged text, carrying how many lines it stands for rather than showing them. */
	kind: Type.Union([
		Type.Literal("context"),
		Type.Literal("add"),
		Type.Literal("remove"),
		Type.Literal("gap"),
	]),
	text: Type.String(),
});
export type ClaudeDiffLine = Static<typeof ClaudeDiffLineSchema>;

export const ClaudeEditPlanSchema = Type.Object({
	path: Type.String(),
	exists: Type.Boolean(),
	/** One sentence naming both the change and who it affects. */
	summary: Type.String(),
	diff: Type.Array(ClaudeDiffLineSchema),
	/** Reasons the write may not do what the user expects; never a reason to refuse it. */
	warnings: Type.Array(Type.String()),
	/** The content this plan was built from, so applying can refuse if the file moved underneath it. */
	baseHash: Type.String(),
	/** False when the edit would leave the file exactly as it is. */
	changes: Type.Boolean(),
});
export type ClaudeEditPlan = Static<typeof ClaudeEditPlanSchema>;

export const FileWriteResultSchema = Type.Union([
	Type.Object({ written: Type.Literal(true), hash: Type.String() }),
	Type.Object({
		written: Type.Literal(false),
		disk: Type.Object({ content: Type.String(), hash: Type.String() }),
	}),
]);
export type FileWriteResult = Static<typeof FileWriteResultSchema>;

// ---------------------------------------------------------------------------
// ideBridge domain — moved from packages/contracts/src/ideBridge.ts
// ---------------------------------------------------------------------------

export const IdeSelectionSchema = Type.Object({
	startLine: Type.Number(),
	startColumn: Type.Number(),
	endLine: Type.Number(),
	endColumn: Type.Number(),
});
export type IdeSelection = Static<typeof IdeSelectionSchema>;

/** Pushed by the client on every selection/active-file change, live, while the plugin is active. */
export const IdeSelectionChangedSchema = Type.Object({
	workspaceId: Type.String(),
	path: Type.String(),
	text: Type.String(),
	selection: IdeSelectionSchema,
});
export type IdeSelectionChanged = Static<typeof IdeSelectionChangedSchema>;

/** Pushed by the client when a tab holding one of these paths closes. */
export const IdeDocumentClosedSchema = Type.Object({
	workspaceId: Type.String(),
	path: Type.String(),
});
export type IdeDocumentClosed = Static<typeof IdeDocumentClosedSchema>;

export const IDE_ACTION_KINDS = [
	"openFile",
	"openDiff",
	"getOpenEditors",
	"checkDocumentDirty",
	"saveDocument",
	"closeTab",
	"closeAllDiffTabs",
] as const;
export const IdeActionKindSchema = Type.Union([
	Type.Literal("openFile"),
	Type.Literal("openDiff"),
	Type.Literal("getOpenEditors"),
	Type.Literal("checkDocumentDirty"),
	Type.Literal("saveDocument"),
	Type.Literal("closeTab"),
	Type.Literal("closeAllDiffTabs"),
]);
export type IdeActionKind = Static<typeof IdeActionKindSchema>;

export const IdeOpenFileParamsSchema = Type.Object({
	path: Type.String(),
	preview: Type.Optional(Type.Boolean()),
	startText: Type.Optional(Type.String()),
	endText: Type.Optional(Type.String()),
});
export type IdeOpenFileParams = Static<typeof IdeOpenFileParamsSchema>;

export const IdeOpenDiffParamsSchema = Type.Object({
	oldPath: Type.Optional(Type.String()),
	newPath: Type.Optional(Type.String()),
	newContent: Type.Optional(Type.String()),
});
export type IdeOpenDiffParams = Static<typeof IdeOpenDiffParamsSchema>;

export const IdeCheckDocumentDirtyParamsSchema = Type.Object({ path: Type.String() });
export type IdeCheckDocumentDirtyParams = Static<typeof IdeCheckDocumentDirtyParamsSchema>;

export const IdeSaveDocumentParamsSchema = Type.Object({ path: Type.String() });
export type IdeSaveDocumentParams = Static<typeof IdeSaveDocumentParamsSchema>;

export const IdeCloseTabParamsSchema = Type.Object({ tabName: Type.String() });
export type IdeCloseTabParams = Static<typeof IdeCloseTabParamsSchema>;

export const IdeActionParamsSchema = Type.Union([
	IdeOpenFileParamsSchema,
	IdeOpenDiffParamsSchema,
	IdeCheckDocumentDirtyParamsSchema,
	IdeSaveDocumentParamsSchema,
	IdeCloseTabParamsSchema,
	Type.Object({}),
]);
export type IdeActionParams = Static<typeof IdeActionParamsSchema>;

/** A host-initiated action, pushed to the client that owns the terminal; exactly one reply is expected. */
export const IdeActionRequestSchema = Type.Object({
	id: Type.String(),
	workspaceId: Type.String(),
	kind: IdeActionKindSchema,
	params: IdeActionParamsSchema,
});
export type IdeActionRequest = Static<typeof IdeActionRequestSchema>;

export const IdeOpenEditorInfoSchema = Type.Object({
	path: Type.String(),
	isDirty: Type.Boolean(),
});
export type IdeOpenEditorInfo = Static<typeof IdeOpenEditorInfoSchema>;

export const IdeActionResultSchema = Type.Union([
	Type.Object({ ok: Type.Literal(true), value: Type.Unknown() }),
	Type.Object({ ok: Type.Literal(false), error: Type.String() }),
]);
export type IdeActionResult = Static<typeof IdeActionResultSchema>;

export const IdeActionReplySchema = Type.Object({
	id: Type.String(),
	result: IdeActionResultSchema,
});
export type IdeActionReply = Static<typeof IdeActionReplySchema>;

// ---------------------------------------------------------------------------
// agent status domain — moved from packages/contracts/src/agentStatus.ts
// ---------------------------------------------------------------------------

export const CLAUDE_CODE_STATUSES = ["idle", "running", "blocked", "done", "failed"] as const;
export const ClaudeCodeStatusSchema = Type.Union([
	Type.Literal("idle"),
	Type.Literal("running"),
	Type.Literal("blocked"),
	Type.Literal("done"),
	Type.Literal("failed"),
]);
export type ClaudeCodeStatus = Static<typeof ClaudeCodeStatusSchema>;

export const AGENT_TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export const AgentTodoStatusSchema = Type.Union([
	Type.Literal("pending"),
	Type.Literal("in_progress"),
	Type.Literal("completed"),
]);
export type AgentTodoStatus = Static<typeof AgentTodoStatusSchema>;

/** One item of the agent's own plan — Claude Code's TodoWrite list, relayed as it was written. */
export const AgentTodoItemSchema = Type.Object({
	content: Type.String(),
	status: AgentTodoStatusSchema,
	activeForm: Type.Optional(Type.String()),
});
export type AgentTodoItem = Static<typeof AgentTodoItemSchema>;

export const AgentStatusReportSchema = Type.Object({
	event: Type.String(),
	session_id: Type.Optional(Type.String()),
	cwd: Type.Optional(Type.String()),
	project: Type.Optional(Type.String()),
	summary: Type.Optional(Type.String()),
	query: Type.Optional(Type.String()),
	response: Type.Optional(Type.String()),
	tool_name: Type.Optional(Type.String()),
	error_type: Type.Optional(Type.String()),
	/** What the session is running on right now — both can change mid-chat. */
	model: Type.Optional(Type.String()),
	effort: Type.Optional(Type.String()),
	/** `false` when the event settles status only — a continuation's Stop, which must not notify twice. */
	notify: Type.Optional(Type.Boolean()),
	/** The agent's whole current plan; present only on a report that rewrote it. */
	todos: Type.Optional(Type.Array(AgentTodoItemSchema)),
});
export type AgentStatusReport = Static<typeof AgentStatusReportSchema>;

export { parseAgentTodos } from "./webValues";

/** `"facts"` is an event that says what the session is running on without saying what it is doing. */
const STATUS_BY_EVENT: Record<string, ClaudeCodeStatus | "facts"> = {
	session_start: "idle",
	prompt_submit: "running",
	tool_complete: "running",
	permission_request: "blocked",
	stop: "done",
	stop_failure: "failed",
	interrupted: "idle",
	model_switch: "facts",
};

/** Null for an event this version does not know; a newer hook must not move a badge by accident. */
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

export const ClaudeCodeSessionStateSchema = Type.Object({
	status: Type.Union([ClaudeCodeStatusSchema, Type.Null()]),
	model: Type.Optional(Type.String()),
	effort: Type.Optional(Type.String()),
	cwd: Type.Optional(Type.String()),
	summary: Type.Optional(Type.String()),
	todos: Type.Optional(Type.Array(AgentTodoItemSchema)),
});
export type ClaudeCodeSessionState = Static<typeof ClaudeCodeSessionStateSchema>;

export const ClaudeCodeStatusPushSchema = Type.Object({
	workspaceId: Type.String(),
	tabKey: Type.String(),
	/** Null when the report only carries facts: the badge keeps whatever it last had. */
	status: Type.Union([ClaudeCodeStatusSchema, Type.Null()]),
	report: AgentStatusReportSchema,
});
export type ClaudeCodeStatusPush = Static<typeof ClaudeCodeStatusPushSchema>;

// ---------------------------------------------------------------------------
// The wire contract
// ---------------------------------------------------------------------------

const AckSchema = Type.Object({ ok: Type.Literal(true) });

export const claudeCodeContract = definePluginContract({
	id: "claude-code",
	wireVersion: 1,
	methods: {
		configGet: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: ClaudeConfigSnapshotSchema,
		},
		account: {
			params: Type.Object({ refresh: Type.Optional(Type.Boolean()) }),
			result: ClaudeAccountSchema,
		},
		pluginStatus: { params: Type.Object({}), result: ThinkrailPluginStatusSchema },
		installPlugin: { params: Type.Object({}), result: ThinkrailPluginStatusSchema },
		pluginUninstallPlan: {
			params: Type.Object({
				workspaceId: Type.String(),
				name: Type.String(),
				scope: ClaudeWritableScopeSchema,
			}),
			result: Type.Object({ command: Type.Array(Type.String()) }),
		},
		pluginUninstall: {
			params: Type.Object({
				workspaceId: Type.String(),
				name: Type.String(),
				scope: ClaudeWritableScopeSchema,
			}),
			result: Type.Object({ output: Type.String() }),
		},
		pluginMovePlan: {
			params: Type.Object({
				workspaceId: Type.String(),
				name: Type.String(),
				from: ClaudeWritableScopeSchema,
				to: ClaudeWritableScopeSchema,
			}),
			result: Type.Object({ commands: Type.Array(Type.Array(Type.String())) }),
		},
		pluginMove: {
			params: Type.Object({
				workspaceId: Type.String(),
				name: Type.String(),
				from: ClaudeWritableScopeSchema,
				to: ClaudeWritableScopeSchema,
			}),
			result: Type.Object({ output: Type.String() }),
		},
		marketplacePlan: {
			params: Type.Object({ workspaceId: Type.String(), action: ClaudeMarketplaceActionSchema }),
			result: Type.Object({ command: Type.Array(Type.String()) }),
		},
		marketplaceRun: {
			params: Type.Object({ workspaceId: Type.String(), action: ClaudeMarketplaceActionSchema }),
			result: Type.Object({ output: Type.String() }),
		},
		/** The servers Claude itself reaches — claude.ai connectors, plugin servers — that no file declares. */
		mcpList: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: Type.Object({ capabilities: Type.Array(ClaudeCapabilitySchema) }),
		},
		readFile: {
			params: Type.Object({ workspaceId: Type.String(), path: Type.String() }),
			result: Type.Object({ content: Type.String(), hash: Type.String() }),
		},
		writeFile: {
			params: Type.Object({
				workspaceId: Type.String(),
				path: Type.String(),
				content: Type.String(),
				baseHash: Type.String(),
			}),
			result: FileWriteResultSchema,
		},
		planEdit: { params: ClaudeEditRequestSchema, result: ClaudeEditPlanSchema },
		applyEdit: {
			params: Type.Object({
				workspaceId: Type.String(),
				scope: ClaudeWritableScopeSchema,
				edit: ClaudeEditSchema,
				baseHash: Type.String(),
			}),
			result: ClaudeEditPlanSchema,
		},
		selectionChanged: { params: IdeSelectionChangedSchema, result: AckSchema },
		documentClosed: { params: IdeDocumentClosedSchema, result: AckSchema },
		actionReply: { params: IdeActionReplySchema, result: AckSchema },
		statusSnapshot: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: Type.Array(ClaudeCodeStatusPushSchema),
		},
	},
	channels: {
		status: {
			kind: "state",
			payload: ClaudeCodeStatusPushSchema,
			snapshot: "statusSnapshot",
			key: ["workspaceId"],
		},
		ideAction: {
			kind: "event",
			payload: IdeActionRequestSchema,
		},
	},
	settings: Type.Object({
		command: Type.Optional(Type.String({ default: "claude" })),
		disableAgentView: Type.Optional(Type.Boolean({ default: true })),
	}),
});
