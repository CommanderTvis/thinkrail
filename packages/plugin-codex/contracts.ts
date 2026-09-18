import { definePluginContract } from "@thinkrail/plugin-api";
import { type Static, Type } from "typebox";

export const CodexInstructionsTargetSchema = Type.Union([
	Type.Literal("global"),
	Type.Literal("project"),
	Type.Literal("project-override"),
]);
export type CodexInstructionsTarget = Static<typeof CodexInstructionsTargetSchema>;

export const CodexStatusSchema = Type.Union([
	Type.Literal("idle"),
	Type.Literal("running"),
	Type.Literal("blocked"),
	Type.Literal("done"),
]);
export type CodexStatus = Static<typeof CodexStatusSchema>;

export const CodexStatusPushSchema = Type.Object({
	workspaceId: Type.String(),
	tabKey: Type.String(),
	status: CodexStatusSchema,
	event: Type.String(),
	model: Type.Optional(Type.String()),
	cwd: Type.Optional(Type.String()),
	sessionId: Type.Optional(Type.String()),
});
export type CodexStatusPush = Static<typeof CodexStatusPushSchema>;

export const CodexScopeSchema = Type.Union([
	Type.Literal("project"),
	Type.Literal("user"),
	Type.Literal("system"),
]);
export type CodexScope = Static<typeof CodexScopeSchema>;

export const CodexWritableScopeSchema = Type.Union([Type.Literal("project"), Type.Literal("user")]);
export type CodexWritableScope = Static<typeof CodexWritableScopeSchema>;

export const CodexLayerSchema = Type.Object({
	scope: CodexScopeSchema,
	path: Type.String(),
	exists: Type.Boolean(),
	/** A project layer Codex skips because the project is not trusted. */
	ignored: Type.Boolean(),
	error: Type.Optional(Type.String()),
});
export type CodexLayer = Static<typeof CodexLayerSchema>;

export const CodexSettingSchema = Type.Object({
	key: Type.String(),
	keyPath: Type.Array(Type.String()),
	value: Type.Unknown(),
	scope: CodexScopeSchema,
	path: Type.String(),
	shadowed: Type.Array(
		Type.Object({ value: Type.Unknown(), scope: CodexScopeSchema, path: Type.String() }),
	),
});

export const CodexValueSchema = Type.Union([
	Type.String(),
	Type.Number(),
	Type.Boolean(),
	Type.Array(Type.String()),
]);
export type CodexValue = Static<typeof CodexValueSchema>;
export type CodexSetting = Static<typeof CodexSettingSchema>;

export const CodexMcpServerSchema = Type.Object({
	name: Type.String(),
	scope: CodexScopeSchema,
	path: Type.String(),
	target: Type.String(),
});
export type CodexMcpServer = Static<typeof CodexMcpServerSchema>;

export const CodexInstructionsSchema = Type.Object({
	scope: Type.Union([Type.Literal("global"), Type.Literal("project")]),
	path: Type.String(),
	/** Worktree-relative, when the file lives in the worktree and can open in an editor tab. */
	relativePath: Type.Optional(Type.String()),
	bytes: Type.Number(),
});
export type CodexInstructions = Static<typeof CodexInstructionsSchema>;

export const CodexConfigSnapshotSchema = Type.Object({
	home: Type.String(),
	layers: Type.Array(CodexLayerSchema),
	settings: Type.Array(CodexSettingSchema),
	mcpServers: Type.Array(CodexMcpServerSchema),
	instructions: Type.Array(CodexInstructionsSchema),
	projectTrusted: Type.Boolean(),
	hooksInstalled: Type.Boolean(),
	/** Codex skips a hook until `/hooks` has trusted it. */
	hooksTrusted: Type.Boolean(),
});
export type CodexConfigSnapshot = Static<typeof CodexConfigSnapshotSchema>;

export const CodexUsageWindowSchema = Type.Object({
	id: Type.String(),
	label: Type.String(),
	usedPercent: Type.Number(),
	windowDurationMins: Type.Union([Type.Number(), Type.Null()]),
	resetsAt: Type.Union([Type.Number(), Type.Null()]),
});

export const CodexAccountSchema = Type.Object({
	loggedIn: Type.Boolean(),
	requiresOpenaiAuth: Type.Boolean(),
	authMethod: Type.Optional(Type.String()),
	email: Type.Optional(Type.String()),
	plan: Type.Optional(Type.String()),
	usage: Type.Array(CodexUsageWindowSchema),
	usageFetchedAt: Type.Optional(Type.String()),
	usageError: Type.Optional(Type.String()),
});
export type CodexAccount = Static<typeof CodexAccountSchema>;

const IdePositionSchema = Type.Object({
	line: Type.Integer({ minimum: 0 }),
	character: Type.Integer({ minimum: 0 }),
});
const IdeRangeSchema = Type.Object({ start: IdePositionSchema, end: IdePositionSchema });
const IdeFileSchema = Type.Object({ label: Type.String(), path: Type.String() });
export const CodexIdeContextSchema = Type.Object({
	openTabs: Type.Array(IdeFileSchema),
	activeFile: Type.Union([
		Type.Object({
			...IdeFileSchema.properties,
			selection: IdeRangeSchema,
			activeSelectionContent: Type.String(),
		}),
		Type.Null(),
	]),
});
export type CodexIdeContext = Static<typeof CodexIdeContextSchema>;

export const codexContract = definePluginContract({
	id: "codex",
	wireVersion: 2,
	methods: {
		ideReply: {
			params: Type.Object({
				requestId: Type.String(),
				workspaceId: Type.String(),
				focused: Type.Boolean(),
				context: CodexIdeContextSchema,
			}),
			result: Type.Null(),
		},
		account: {
			params: Type.Object({}),
			result: CodexAccountSchema,
		},
		configGet: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: CodexConfigSnapshotSchema,
		},
		/** Sets or, with `null`, removes one top-level key of a config.toml. */
		setValue: {
			params: Type.Object({
				workspaceId: Type.String(),
				scope: CodexWritableScopeSchema,
				keyPath: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
				value: Type.Union([CodexValueSchema, Type.Null()]),
			}),
			result: CodexConfigSnapshotSchema,
		},
		createInstructions: {
			params: Type.Object({ workspaceId: Type.String(), target: CodexInstructionsTargetSchema }),
			result: Type.Object({ path: Type.String(), relativePath: Type.Optional(Type.String()) }),
		},
		installHooks: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: CodexConfigSnapshotSchema,
		},
		statusSnapshot: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: Type.Array(CodexStatusPushSchema),
		},
	},
	channels: {
		ideRequest: {
			kind: "event",
			payload: Type.Object({ requestId: Type.String(), workspaceId: Type.String() }),
		},
		status: {
			kind: "state",
			payload: CodexStatusPushSchema,
			snapshot: "statusSnapshot",
			key: ["workspaceId"],
		},
	},
	settings: Type.Object({
		hideSubscriptionNotice: Type.Optional(Type.Boolean({ default: false })),
		command: Type.Optional(Type.String({ default: "codex" })),
		permissionMode: Type.Optional(
			Type.Union(
				[
					Type.Literal("default"),
					Type.Literal("sandbox-read-only"),
					Type.Literal("sandbox-workspace-write"),
					Type.Literal("sandbox-danger-full-access"),
					Type.Literal("full-auto"),
					Type.Literal("yolo"),
				],
				{ default: "default" },
			),
		),
		/** Hands every launched session ThinkRail's MCP server. */
		mcp: Type.Optional(Type.Boolean({ default: true })),
	}),
});
