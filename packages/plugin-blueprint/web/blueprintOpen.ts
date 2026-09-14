import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import type { BlueprintAuthor, BlueprintState, blueprintContract } from "../contracts";
import { useBlueprintStore } from "./store";

export const BLUEPRINT_TERMINAL_TAB_KEY = "blueprint-author";

type Ctx = PluginWebContext<typeof blueprintContract>;

export function createBlueprintOpener(ctx: Ctx) {
	const openingByWorkspace = new Map<string, Promise<void>>();

	async function restoreAuthor(
		workspaceId: string,
		author: Extract<BlueprintAuthor, { kind: "terminal" }> & { agentSessionId: string },
	): Promise<void> {
		const claudeLauncher = ctx.launchers().find((launcher) => launcher.id === "claude");
		if (!claudeLauncher) return;
		const command = claudeLauncher.terminalCommand({
			resume: { sessionId: author.agentSessionId },
		});
		await ctx.openTerminal(workspaceId, { command, tabKey: author.tabKey });
		ctx.focusCompanion({ kind: "terminal", workspaceId, key: author.tabKey }, "blueprint");
	}

	async function startAuthor(workspaceId: string, state: BlueprintState | null): Promise<void> {
		const { opening } = await ctx.request("open", {
			workspaceId,
			source: state?.source ?? { kind: "product" },
			agentId: "pi",
		});
		const { sessionId } = await ctx.openChat(workspaceId, { prompt: opening });
		await ctx.request("setAuthor", {
			workspaceId,
			author: { kind: "chat", sessionId },
		});
		ctx.focusCompanion({ kind: "chat", workspaceId, key: sessionId }, "blueprint");
	}

	async function openBlueprintPairOnce(workspaceId: string): Promise<void> {
		let state: BlueprintState | null | undefined =
			useBlueprintStore.getState().byWorkspace[workspaceId];
		if (state === undefined || state === null) {
			state = await ctx
				.request("get", { workspaceId })
				.then((result) => result.state)
				.catch(() => null);
			useBlueprintStore.getState().setState(workspaceId, state);
		}
		const author = state?.author;
		if (author?.kind === "chat") {
			try {
				const { sessionId } = await ctx.openChat(workspaceId, { sessionId: author.sessionId });
				await ctx.request("setAuthor", { workspaceId, author: { kind: "chat", sessionId } });
				ctx.focusCompanion({ kind: "chat", workspaceId, key: sessionId }, "blueprint");
				return;
			} catch {}
		}
		if (author?.kind === "terminal") {
			if (ctx.host().terminals[workspaceId]?.some((tab) => tab.tabKey === author.tabKey)) {
				await ctx.openTerminal(workspaceId, { tabKey: author.tabKey });
				ctx.focusCompanion({ kind: "terminal", workspaceId, key: author.tabKey }, "blueprint");
				return;
			}
			if (author.agentSessionId && ctx.launchers().some((launcher) => launcher.id === "claude")) {
				await restoreAuthor(workspaceId, { ...author, agentSessionId: author.agentSessionId });
				return;
			}
		}
		await startAuthor(workspaceId, state);
	}

	function openBlueprintPair(workspaceId: string): Promise<void> {
		const opening = openingByWorkspace.get(workspaceId);
		if (opening) return opening;
		const next = openBlueprintPairOnce(workspaceId).finally(() => {
			openingByWorkspace.delete(workspaceId);
		});
		openingByWorkspace.set(workspaceId, next);
		return next;
	}

	return { openBlueprintPair };
}
