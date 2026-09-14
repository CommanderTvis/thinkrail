import { definePluginHost } from "@thinkrail/plugin-api/host";
import { FIELDS, list, SpecIndex, type SpecNode, scalar } from "pi-spec-graph/core";
import { SPEC_TOOLS } from "pi-spec-graph/tools";
import { type SpecGraphNode, type SpecGraphSnapshot, specDialectContract } from "../contracts";
import { manifest } from "../manifest";

function toWireNode(node: SpecNode): SpecGraphNode {
	const status = scalar(node.frontmatter, FIELDS.status);
	const parent = scalar(node.frontmatter, FIELDS.parent);
	return {
		id: node.id,
		type: node.type,
		title: node.title ?? node.id,
		...(status !== undefined ? { status } : {}),
		path: node.path,
		...(parent !== undefined ? { parent } : {}),
		dependsOn: list(node.frontmatter, FIELDS.dependsOn),
		references: list(node.frontmatter, FIELDS.references),
		implements: list(node.frontmatter, FIELDS.implements),
		tags: list(node.frontmatter, FIELDS.tags),
	};
}

export default definePluginHost({
	manifest,
	contract: specDialectContract,
	activate(ctx) {
		const indexes = new Map<string, SpecIndex>();

		function indexFor(workspaceId: string, root: string): SpecIndex {
			let index = indexes.get(workspaceId);
			if (!index) {
				index = new SpecIndex(root);
				indexes.set(workspaceId, index);
			}
			return index;
		}

		async function graph(workspaceId: string): Promise<SpecGraphSnapshot> {
			const workspace = ctx.workspace(workspaceId);
			if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);
			await ctx.watchWorkspace(workspaceId);
			const nodes = [...indexFor(workspaceId, workspace.worktreePath).graph().nodes.values()].map(
				toWireNode,
			);
			return { nodes };
		}

		ctx.method("graph", (params) => graph(params.workspaceId));

		ctx.onWorkspace((event) => {
			if (event.kind === "removed") indexes.delete(event.id);
		});

		for (const tool of SPEC_TOOLS) {
			ctx.tool({
				name: tool.name,
				label: tool.label,
				description: tool.description,
				promptSnippet: tool.promptSnippet,
				parameters: tool.parameters,
				surfaces: ["mcp"],
				async run(params, toolCtx) {
					const outcome = await tool.run(params, toolCtx.cwd);
					const failed =
						typeof outcome.details === "object" &&
						outcome.details !== null &&
						"error" in outcome.details;
					return {
						text: outcome.text,
						details: outcome.details,
						...(failed ? { isError: true } : {}),
					};
				},
			});
		}
	},
});
