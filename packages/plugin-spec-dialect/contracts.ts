import { definePluginContract } from "@thinkrail/plugin-api";
import { type Static, Type } from "typebox";

export const SpecGraphNodeSchema = Type.Object({
	id: Type.String(),
	type: Type.String(),
	title: Type.String(),
	status: Type.Optional(Type.String()),
	path: Type.String(),
	parent: Type.Optional(Type.String()),
	dependsOn: Type.Array(Type.String()),
	references: Type.Array(Type.String()),
	implements: Type.Array(Type.String()),
	tags: Type.Array(Type.String()),
});

export type SpecGraphNode = Static<typeof SpecGraphNodeSchema>;

export const SpecGraphSnapshotSchema = Type.Object({
	nodes: Type.Array(SpecGraphNodeSchema),
});

export type SpecGraphSnapshot = Static<typeof SpecGraphSnapshotSchema>;

export const specDialectContract = definePluginContract({
	id: "spec-dialect",
	wireVersion: 1,
	methods: {
		graph: {
			params: Type.Object({ workspaceId: Type.String() }),
			result: SpecGraphSnapshotSchema,
		},
	},
	channels: {},
	settings: Type.Object({}),
});
