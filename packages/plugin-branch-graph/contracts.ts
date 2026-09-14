import { definePluginContract } from "@thinkrail/plugin-api";
import { type Static, Type } from "typebox";

/** One commit as the graph draws it: its parents are the edges, its refs the labels. */
export const GitGraphCommitSchema = Type.Object({
	sha: Type.String(),
	shortSha: Type.String(),
	parents: Type.Array(Type.String()),
	/** Ref names pointing here, as `%D` reports them, already split. */
	refs: Type.Array(Type.String()),
	subject: Type.String(),
	author: Type.String(),
	committedAt: Type.String(),
});

export type GitGraphCommit = Static<typeof GitGraphCommitSchema>;

/** A worktree sitting on a commit — the workspace is absent for one ThinkRail does not own. */
export const GitGraphWorktreeSchema = Type.Object({
	sha: Type.String(),
	name: Type.String(),
	workspaceId: Type.Optional(Type.String()),
});

export type GitGraphWorktree = Static<typeof GitGraphWorktreeSchema>;

export const GitGraphSchema = Type.Object({
	commits: Type.Array(GitGraphCommitSchema),
	worktrees: Type.Array(GitGraphWorktreeSchema),
	/** True when older commits follow this page — see SPEC.md. */
	hasMore: Type.Boolean(),
});

export type GitGraph = Static<typeof GitGraphSchema>;

export const branchGraphContract = definePluginContract({
	id: "branch-graph",
	wireVersion: 1,
	methods: {
		graph: {
			params: Type.Object({ projectId: Type.String(), skip: Type.Optional(Type.Number()) }),
			result: GitGraphSchema,
		},
		patch: {
			params: Type.Object({ projectId: Type.String(), sha: Type.String() }),
			result: Type.Object({ patch: Type.String() }),
		},
	},
	channels: {},
	settings: Type.Object({}),
});
