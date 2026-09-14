import { definePluginWeb } from "@thinkrail/plugin-api/web";
import type { specDialectContract } from "../contracts";
import { SPECS_TOOL } from "../manifest";
import { createSpecsPanel } from "./SpecsPanel";
import { SpecToolCard, specToolPaths, specToolSummary } from "./SpecToolCard";
import { syncWorkspaceSpecs } from "./specSync";
import { evictWorkspace, specPathMatcher, useSpecStore } from "./store";

const SPEC_TOOL_NAMES = [
	"spec_grep",
	"spec_get",
	"spec_graph",
	"spec_create",
	"spec_update",
	"spec_delete",
	"spec_validate",
] as const;

export default definePluginWeb<typeof specDialectContract>({
	activate(ctx) {
		ctx.sideTool({
			tool: SPECS_TOOL,
			component: createSpecsPanel(ctx),
			railDefault: async (workspaceId) => {
				const snapshot = await ctx.request("graph", { workspaceId });
				return snapshot.nodes.length > 0;
			},
		});

		for (const toolName of SPEC_TOOL_NAMES) {
			ctx.toolRenderer(toolName, SpecToolCard, { summary: specToolSummary });
		}

		const initialHost = ctx.host();
		if (initialHost.activeWorkspaceId) {
			syncWorkspaceSpecs(
				ctx,
				initialHost.activeWorkspaceId,
				initialHost.workspaceRevisions[initialHost.activeWorkspaceId] ?? 0,
			);
		}
		ctx.watchHost(
			(host) => ({
				workspaceId: host.activeWorkspaceId,
				revision: host.activeWorkspaceId
					? (host.workspaceRevisions[host.activeWorkspaceId] ?? 0)
					: 0,
			}),
			({ workspaceId, revision }) => {
				if (workspaceId) syncWorkspaceSpecs(ctx, workspaceId, revision);
			},
		);

		ctx.slot("documentLink", (workspaceId, href) => {
			if (!href.startsWith("spec:")) return null;
			const target = decodeURIComponent(href.slice("spec:".length));
			if (!target) return null;
			const nodes = useSpecStore.getState().specsByWorkspace[workspaceId] ?? [];
			const node = nodes.find((candidate) => candidate.id === target);
			return node ? { path: node.path } : null;
		});

		ctx.slot("writtenPathGroup", (workspaceId, path) => {
			const nodes = useSpecStore.getState().specsByWorkspace[workspaceId];
			if (!nodes) return null;
			const isSpec = specPathMatcher(nodes);
			if (!isSpec(path)) return null;
			return {
				id: "specs",
				label: (n: number) => `${n} ${n === 1 ? "spec" : "specs"}`,
				tool: SPECS_TOOL,
			};
		});

		const unsubscribeRemoved = ctx.onWorkspaceRemoved(evictWorkspace);

		return () => {
			unsubscribeRemoved();
		};
	},
});

export { specToolPaths };
