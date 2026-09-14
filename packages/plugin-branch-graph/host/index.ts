import { definePluginHost } from "@thinkrail/plugin-api/host";
import type { GitGraph } from "../contracts";
import { branchGraphContract } from "../contracts";
import { manifest } from "../manifest";
import { emptyGraph, GRAPH_LOG_ARGS, parseGraphLog, parseWorktreeList } from "./graphBuild";

export default definePluginHost({
	manifest,
	contract: branchGraphContract,
	activate(ctx) {
		async function graph(projectId: string, skip: number): Promise<GitGraph> {
			const project = ctx.projects().find((p) => p.id === projectId);
			if (!project) throw new Error(`Unknown project: ${projectId}`);

			const log = await ctx.git(project.path, GRAPH_LOG_ARGS(skip));
			if (log.failure) throw new Error(`Could not read the history: ${log.err || "git failed"}`);
			if (!log.ok || !log.out) return emptyGraph();

			const { commits, hasMore } = parseGraphLog(log.out);

			const listed = await ctx.git(project.path, ["worktree", "list", "--porcelain"]);
			const worktrees = listed.ok ? parseWorktreeList(listed.out, ctx.workspaces(projectId)) : [];

			return { commits, worktrees, hasMore };
		}

		ctx.method("graph", (params) => graph(params.projectId, params.skip ?? 0));
	},
});
