import { definePluginContract } from "@thinkrail/plugin-api";
import { type Static, Type } from "typebox";

export { BLUEPRINT_FILE } from "./blueprintFile";

export const BlueprintOptionSchema = Type.Object({
	id: Type.String(),
	label: Type.String(),
	axis: Type.String(),
});
export type BlueprintOption = Static<typeof BlueprintOptionSchema>;

export const BlueprintControlKindSchema = Type.Union([
	Type.Literal("select"),
	Type.Literal("multi"),
]);
export type BlueprintControlKind = Static<typeof BlueprintControlKindSchema>;

export const BlueprintControlSchema = Type.Object({
	id: Type.String(),
	kind: BlueprintControlKindSchema,
	title: Type.String(),
	options: Type.Array(BlueprintOptionSchema),
	selectedIds: Type.Array(Type.String()),
	pending: Type.Boolean(),
	locked: Type.Boolean(),
});
export type BlueprintControl = Static<typeof BlueprintControlSchema>;

export const BlueprintBlockSchema = Type.Union([
	Type.Object({ kind: Type.Literal("prose"), id: Type.String(), text: Type.String() }),
	Type.Object({
		kind: Type.Literal("control"),
		id: Type.String(),
		control: BlueprintControlSchema,
	}),
]);
export type BlueprintBlock = Static<typeof BlueprintBlockSchema>;

export const BlueprintBlockLinesSchema = Type.Object({
	startLine: Type.Number(),
	endLine: Type.Number(),
});
export type BlueprintBlockLines = Static<typeof BlueprintBlockLinesSchema>;

export const BlueprintDocSchema = Type.Object({
	blocks: Type.Array(BlueprintBlockSchema),
	frontmatter: Type.String(),
});
export type BlueprintDoc = Static<typeof BlueprintDocSchema>;

export const BlueprintAgentIdSchema = Type.Union([Type.Literal("pi"), Type.Literal("claude")]);
export type BlueprintAgentId = Static<typeof BlueprintAgentIdSchema>;

export const BlueprintSourceSchema = Type.Union([
	Type.Object({ kind: Type.Literal("idea"), brief: Type.String() }),
	Type.Object({ kind: Type.Literal("product") }),
	Type.Object({ kind: Type.Literal("spec"), path: Type.String() }),
]);
export type BlueprintSource = Static<typeof BlueprintSourceSchema>;

export const BlueprintEditTargetSchema = Type.Union([
	Type.Object({ kind: Type.Literal("frontmatter") }),
	Type.Object({ kind: Type.Literal("prose"), blockId: Type.String() }),
	Type.Object({
		kind: Type.Literal("option-label"),
		controlId: Type.String(),
		optionId: Type.String(),
	}),
	Type.Object({
		kind: Type.Literal("option-axis"),
		controlId: Type.String(),
		optionId: Type.String(),
	}),
]);
export type BlueprintEditTarget = Static<typeof BlueprintEditTargetSchema>;

export const BlueprintEditSchema = Type.Object({
	target: BlueprintEditTargetSchema,
	before: Type.String(),
	after: Type.String(),
});
export type BlueprintEdit = Static<typeof BlueprintEditSchema>;

export const BlueprintChangeSchema = Type.Union([
	Type.Object({
		kind: Type.Literal("control-added"),
		controlId: Type.String(),
		title: Type.String(),
	}),
	Type.Object({
		kind: Type.Literal("control-removed"),
		controlId: Type.String(),
		title: Type.String(),
	}),
	Type.Object({
		kind: Type.Literal("control-reselected"),
		controlId: Type.String(),
		title: Type.String(),
		from: Type.String(),
		to: Type.String(),
	}),
	Type.Object({
		kind: Type.Literal("control-options-changed"),
		controlId: Type.String(),
		title: Type.String(),
	}),
	Type.Object({ kind: Type.Literal("prose-changed"), count: Type.Number() }),
]);
export type BlueprintChange = Static<typeof BlueprintChangeSchema>;

export const BlueprintAuthorSchema = Type.Union([
	Type.Object({ kind: Type.Literal("chat"), sessionId: Type.String() }),
	Type.Object({
		kind: Type.Literal("terminal"),
		tabKey: Type.String(),
		agentSessionId: Type.Optional(Type.String()),
	}),
]);
export type BlueprintAuthor = Static<typeof BlueprintAuthorSchema>;

export const BlueprintStateSchema = Type.Object({
	workspaceId: Type.String(),
	source: BlueprintSourceSchema,
	brief: Type.String(),
	agentId: BlueprintAgentIdSchema,
	author: Type.Union([BlueprintAuthorSchema, Type.Null()]),
	phase: Type.Union([Type.Literal("awaiting"), Type.Literal("ready")]),
	doc: BlueprintDocSchema,
	changes: Type.Array(BlueprintChangeSchema),
	pendingEdits: Type.Array(BlueprintEditSchema),
	lines: Type.Record(Type.String(), BlueprintBlockLinesSchema),
});
export type BlueprintState = Static<typeof BlueprintStateSchema>;

// The snapshot method (`get`) and the channel it feeds share this exact shape — the web loader's state-
// channel hydration passes a snapshot result straight through as the channel payload, and the channel's
// `key: ["workspaceId"]` needs that field at the payload's top level to scope on. See plugins/SPEC.md.
export const BlueprintChangedPayloadSchema = Type.Object({
	workspaceId: Type.String(),
	state: Type.Union([BlueprintStateSchema, Type.Null()]),
});
export type BlueprintChangedPayload = Static<typeof BlueprintChangedPayloadSchema>;

const AckSchema = Type.Object({ ok: Type.Literal(true) });

export const blueprintContract = definePluginContract({
	id: "blueprint",
	wireVersion: 1,
	methods: {
		open: {
			params: Type.Object({
				workspaceId: Type.String(),
				source: BlueprintSourceSchema,
				agentId: BlueprintAgentIdSchema,
			}),
			result: Type.Object({
				state: BlueprintStateSchema,
				opening: Type.String(),
				systemPrompt: Type.String(),
			}),
		},
		setAuthor: {
			params: Type.Object({ workspaceId: Type.String(), author: BlueprintAuthorSchema }),
			result: AckSchema,
		},
		close: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: AckSchema,
		},
		get: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: BlueprintChangedPayloadSchema,
		},
		select: {
			params: Type.Object({
				workspaceId: Type.String(),
				controlId: Type.String(),
				optionId: Type.String(),
			}),
			result: AckSchema,
		},
		edit: {
			params: Type.Object({
				workspaceId: Type.String(),
				target: BlueprintEditTargetSchema,
				text: Type.String(),
			}),
			result: AckSchema,
		},
		confirmEdits: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: AckSchema,
		},
		discardEdits: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: AckSchema,
		},
	},
	channels: {
		changed: {
			kind: "state",
			payload: BlueprintChangedPayloadSchema,
			snapshot: "get",
			key: ["workspaceId"],
		},
	},
	settings: Type.Object({}),
});
