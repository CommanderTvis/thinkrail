import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { BLUEPRINT_FILE } from "../blueprintFile";
import type { BlueprintAuthor, BlueprintState, blueprintContract } from "../contracts";
import { useBlueprintStore } from "./store";

type Ctx = PluginWebContext<typeof blueprintContract>;

export function createBlueprintOpener(ctx: Ctx) {
	async function restoreAuthor(
		workspaceId: string,
		author: Extract<BlueprintAuthor, { kind: "terminal" }>,
	): Promise<void> {
		const claudeLauncher = ctx.launchers().find((launcher) => launcher.id === "claude");
		if (!claudeLauncher) {
			await ctx.editors.open(workspaceId, BLUEPRINT_FILE, { raw: true });
			return;
		}
		const command = claudeLauncher.terminalCommand({
			resume: author.agentSessionId ? { sessionId: author.agentSessionId } : {},
		});
		await ctx.openTerminal(workspaceId, { command, tabKey: author.tabKey });
		ctx.focusCompanion({ kind: "terminal", workspaceId, key: author.tabKey }, "blueprint");
	}

	async function openBlueprintPair(workspaceId: string): Promise<void> {
		let state: BlueprintState | null | undefined =
			useBlueprintStore.getState().byWorkspace[workspaceId];
		if (state === undefined) {
			state = await ctx
				.request("get", { workspaceId })
				.then((result) => result.state)
				.catch(() => null);
			useBlueprintStore.getState().setState(workspaceId, state);
		}
		const author = state?.author;
		if (author?.kind === "chat") {
			ctx.focusCompanion({ kind: "chat", workspaceId, key: author.sessionId }, "blueprint");
			return;
		}
		if (author?.kind === "terminal") {
			if (ctx.host().terminals[workspaceId]?.some((tab) => tab.tabKey === author.tabKey)) {
				ctx.focusCompanion({ kind: "terminal", workspaceId, key: author.tabKey }, "blueprint");
			} else {
				await restoreAuthor(workspaceId, author);
			}
			return;
		}
		await ctx.editors.open(workspaceId, BLUEPRINT_FILE, { raw: true });
	}

	return { openBlueprintPair };
}
