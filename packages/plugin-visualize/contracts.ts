import { definePluginContract } from "@thinkrail/plugin-api";
import { type Static, Type } from "typebox";

/**
 * A visualization drawn by the agent running in a terminal — the MCP `visualize` tool's live view.
 *
 * `args` is the tool call's arguments verbatim; the web renders them with the same card the chat uses
 * for pi's visualize tool, so both agents draw with one vocabulary. `revision` bumps on every rewrite:
 * the same terminal calling again updates its view in place rather than opening a second one.
 */
export const TerminalVisualizationSchema = Type.Object({
	title: Type.String(),
	args: Type.Record(Type.String(), Type.Unknown()),
	revision: Type.Number(),
});
export type TerminalVisualization = Static<typeof TerminalVisualizationSchema>;

// The snapshot method (`get`) and the channel it feeds share this exact shape — the web loader's state-
// channel hydration passes a snapshot result straight through as the channel payload, and the channel's
// `key: ["workspaceId"]` needs that field at the payload's top level to scope on. See plugins/SPEC.md.
export const VisualizationsChangedPayloadSchema = Type.Object({
	workspaceId: Type.String(),
	visualizations: Type.Record(Type.String(), TerminalVisualizationSchema),
});
export type VisualizationsChangedPayload = Static<typeof VisualizationsChangedPayloadSchema>;

const AckSchema = Type.Object({ ok: Type.Literal(true) });

export const visualizeContract = definePluginContract({
	id: "visualize",
	wireVersion: 1,
	methods: {
		report: {
			params: Type.Object({
				workspaceId: Type.String(),
				tabKey: Type.String(),
				revision: Type.Number(),
				error: Type.Optional(Type.String()),
			}),
			result: AckSchema,
		},
		get: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: VisualizationsChangedPayloadSchema,
		},
	},
	channels: {
		changed: {
			kind: "state",
			payload: VisualizationsChangedPayloadSchema,
			snapshot: "get",
			key: ["workspaceId"],
		},
	},
	settings: Type.Object({}),
});
