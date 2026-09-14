import { definePluginHost } from "@thinkrail/plugin-api/host";
import { specDialectContract } from "@thinkrail/plugin-spec-dialect/contracts";
import { Type } from "typebox";
import type { BlueprintAuthor } from "../contracts";
import { blueprintContract } from "../contracts";
import { manifest } from "../manifest";
import { BLUEPRINT_CHECK_DESCRIPTION, checkBlueprint } from "./check";
import { BLUEPRINT_FILE, readBlueprintFile, resolveBlueprintSource } from "./document";
import { BLUEPRINT_APPENDIX, existingBlueprintPrompt, openingPrompt } from "./prompts";
import {
	blueprintBrief,
	closeBlueprint,
	confirmBlueprintEdits,
	discardBlueprintEdits,
	editBlueprintText,
	getBlueprint,
	noteBlueprintAuthorSession,
	noteBlueprintFileChanged,
	openBlueprint,
	selectBlueprintOption,
	setBlueprintAuthor,
	setBlueprintPublisher,
	setBlueprintStore,
} from "./session";

export default definePluginHost({
	manifest,
	contract: blueprintContract,
	activate(ctx) {
		setBlueprintStore({
			read: () => ctx.readState("blueprints", {}),
			write: (value) => ctx.writeState("blueprints", value),
		});
		setBlueprintPublisher((payload) => ctx.publish("changed", payload));

		function deliver(workspaceId: string, author: BlueprintAuthor, text: string): void {
			if (author.kind === "chat") {
				void ctx.sendToSession(author.sessionId, text);
				return;
			}
			ctx.writeTerminal({ workspaceId, tabKey: author.tabKey }, `${text}\r`);
		}

		function deliverIfAny(workspaceId: string, reconcile: string | null): void {
			if (!reconcile) return;
			const author = blueprintBrief(workspaceId)?.author;
			if (author) deliver(workspaceId, author, reconcile);
		}

		ctx.method("open", (params) => {
			const workspace = ctx.workspace(params.workspaceId);
			if (!workspace) throw new Error(`Unknown workspace: ${params.workspaceId}`);
			const hasBlueprint = readBlueprintFile(workspace.worktreePath) !== null;
			const source = hasBlueprint
				? (params.source ?? { kind: "product" })
				: resolveBlueprintSource(workspace.worktreePath, params.source);
			const state = openBlueprint(
				params.workspaceId,
				workspace.worktreePath,
				source,
				params.agentId,
			);
			const opening = hasBlueprint ? existingBlueprintPrompt() : openingPrompt(source);
			return { state, opening, systemPrompt: BLUEPRINT_APPENDIX };
		});

		ctx.method("setAuthor", (params) => {
			setBlueprintAuthor(params.workspaceId, params.author);
			return { ok: true as const };
		});

		ctx.method("close", (params) => {
			closeBlueprint(params.workspaceId);
			return { ok: true as const };
		});

		ctx.method("get", (params) => {
			const workspace = ctx.workspace(params.workspaceId);
			return {
				workspaceId: params.workspaceId,
				state: getBlueprint(params.workspaceId, workspace?.worktreePath),
			};
		});

		ctx.method("select", (params) => {
			deliverIfAny(
				params.workspaceId,
				selectBlueprintOption(params.workspaceId, params.controlId, params.optionId),
			);
			return { ok: true as const };
		});

		ctx.method("edit", (params) => {
			editBlueprintText(params.workspaceId, params.target, params.text);
			return { ok: true as const };
		});

		ctx.method("confirmEdits", (params) => {
			deliverIfAny(params.workspaceId, confirmBlueprintEdits(params.workspaceId));
			return { ok: true as const };
		});

		ctx.method("discardEdits", (params) => {
			discardBlueprintEdits(params.workspaceId);
			return { ok: true as const };
		});

		ctx.onFsChanged((payload) => {
			// The author writes the spec with ordinary tools and reports to nobody, so the watcher is how
			// the panel learns it changed. A truncated path list means "something changed" — re-read anyway.
			if (payload.truncated || payload.paths.some((path) => path.endsWith(BLUEPRINT_FILE))) {
				noteBlueprintFileChanged(payload.workspaceId);
			}
		});

		ctx.onTerminal((event) => {
			if (event.kind !== "agentChanged" || !event.record?.sessionId) return;
			const author = blueprintBrief(event.terminal.workspaceId)?.author;
			if (author?.kind !== "terminal" || author.tabKey !== event.terminal.tabKey) return;
			noteBlueprintAuthorSession(
				event.terminal.workspaceId,
				event.terminal.tabKey,
				event.record.sessionId,
			);
		});

		ctx.revivePrefill((terminal) => {
			const author = blueprintBrief(terminal.workspaceId)?.author;
			if (author?.kind === "terminal" && author.tabKey === terminal.tabKey) return { submit: true };
			return null;
		});

		ctx.tool({
			name: "blueprint_check",
			label: "Check Blueprint",
			description: BLUEPRINT_CHECK_DESCRIPTION,
			parameters: Type.Object({}),
			surfaces: ["agent", "mcp"],
			async run(_params, toolCtx) {
				const outcome = checkBlueprint(toolCtx.cwd);
				if (outcome.isError) return { text: outcome.text, isError: true };
				let text = outcome.text;
				if (toolCtx.workspaceId) {
					try {
						const graph = await ctx
							.dependency(specDialectContract)
							.request("graph", { workspaceId: toolCtx.workspaceId });
						if (!graph.nodes.some((node) => node.path === BLUEPRINT_FILE)) {
							text += `\n\n${BLUEPRINT_FILE} is not indexed as a spec yet — open it with id/type/title frontmatter so the Specs tool lists it.`;
						}
					} catch {}
				}
				return { text };
			},
		});
	},
});
