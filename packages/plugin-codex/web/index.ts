import { RiErrorWarningLine } from "@remixicon/react";
import { pluginToolId } from "@thinkrail/plugin-api";
import { definePluginWeb, type PluginWebContext } from "@thinkrail/plugin-api/web";
import { createElement } from "react";
import type { CodexStatus, CodexStatusPush, codexContract } from "../contracts";
import { type CodexLaunchOptions, codexLaunchLine } from "../launch";
import { CODEX_ID } from "../manifest";
import { createCodexGlyph } from "./CodexGlyph";
import { createCodexLauncher } from "./CodexLauncher";
import { createCodexPanel } from "./CodexPanel";
import { createCodexSettings } from "./CodexSettings";
import { createCodexTerminalFacts } from "./CodexTerminalFacts";
import { registerIdeContext } from "./ideContext";
import { useCodexStore } from "./store";

type Ctx = PluginWebContext<typeof codexContract>;

function launchLine(ctx: Ctx, options: Omit<CodexLaunchOptions, "mcp" | "windows"> = {}): string {
	const host = ctx.host();
	const settings = host.config.plugins[CODEX_ID] ?? {};
	return codexLaunchLine(typeof settings.command === "string" ? settings.command : "codex", {
		...options,
		permissionMode:
			typeof settings.permissionMode === "string" ? settings.permissionMode : "default",
		mcp: settings.mcp !== false,
		windows: (host.hostPlatform ?? "").toLowerCase().startsWith("win"),
	});
}

const ADORNMENT: Partial<Record<CodexStatus, { className: string; label: string }>> = {
	running: {
		label: "Codex is working",
		className:
			"size-8 shrink-0 animate-spin rounded-full border-2 border-text-muted border-t-transparent motion-reduce:animate-none",
	},
	blocked: {
		label: "Codex: Action required",
		className: "size-14 shrink-0 text-feedback-warning",
	},
	done: { label: "Codex finished", className: "size-8 shrink-0 rounded-full bg-feedback-success" },
};

function CodexStatusBadge({ workspaceId, tabKey }: { workspaceId: string; tabKey: string }) {
	const status = useCodexStore((s) => s.byWorkspace[workspaceId]?.[tabKey]?.status);
	const look = status ? ADORNMENT[status] : undefined;
	if (!look) return null;
	return createElement(
		"span",
		{
			"data-testid": "terminal-codex-status",
			"data-status": status,
			role: "status",
			"aria-label": look.label,
			title: look.label,
			className: look.className,
		},
		status === "blocked"
			? createElement(RiErrorWarningLine, { className: "size-full", "aria-hidden": true })
			: null,
	);
}

export default definePluginWeb<typeof codexContract>({
	activate(ctx) {
		const stopIdeContext = registerIdeContext(ctx);
		const launcherIdeContext = new Set<string>();
		const terminalId = (workspaceId: string, tabKey: string) => `${workspaceId}\u0000${tabKey}`;
		const CodexPanel = createCodexPanel(ctx);
		const CodexGlyph = createCodexGlyph(ctx);

		const unsubscribeStatus = ctx.subscribe("status", (push: CodexStatusPush) =>
			useCodexStore.getState().applyPush(push),
		);
		void ctx
			.request("models", {})
			.then(useCodexStore.getState().setModels)
			.catch(() => {});
		const hydrated = new Set<string>();
		function ensureHydrated(workspaceId: string): void {
			if (hydrated.has(workspaceId)) return;
			hydrated.add(workspaceId);
			void ctx
				.request("statusSnapshot", { workspaceId })
				.then((rows) => {
					for (const row of rows) useCodexStore.getState().applyPush(row);
				})
				.catch(() => {});
		}
		ctx.onWorkspaceRemoved((workspaceId) => {
			hydrated.delete(workspaceId);
			useCodexStore.getState().evictWorkspace(workspaceId);
		});

		ctx.settingsSection({
			label: "Codex",
			icon: CodexGlyph,
			component: createCodexSettings(ctx),
		});

		ctx.sideTool({
			tool: pluginToolId(CODEX_ID, "config"),
			component: ({ workspaceId }) => createElement(CodexPanel, { workspaceId }),
		});

		ctx.launcher({
			id: "codex",
			label: "Codex",
			icon: CodexGlyph,
			terminalCommand: (options) =>
				launchLine(ctx, {
					model: options.model,
					systemPrompt: options.systemPrompt,
					initialPrompt: options.initialPrompt,
					resume: options.resume,
				}),
			useAvailable: () => ({ available: true }),
		});

		ctx.workspaceAction({
			id: "codex-launch",
			component: createCodexLauncher(CodexGlyph, (workspaceId, groupId, preset) => {
				void ctx
					.openTerminal(workspaceId, { command: launchLine(ctx, { preset }), groupId })
					.then(({ tabKey }) => {
						if (ctx.host().config.plugins[CODEX_ID]?.ideContext !== true) return;
						launcherIdeContext.add(terminalId(workspaceId, tabKey));
					});
			}),
		});

		ctx.tabDecoration((tab) => {
			if (tab.kind === "terminal") {
				const agent = ctx
					.host()
					.terminals[tab.workspaceId]?.find((candidate) => candidate.tabKey === tab.tabKey)?.agent;
				if (agent?.kind !== "codex") return null;
				ensureHydrated(tab.workspaceId);
				return {
					icon: CodexGlyph,
					adornment: createElement(CodexStatusBadge, {
						workspaceId: tab.workspaceId,
						tabKey: tab.tabKey,
					}),
				};
			}
			if (tab.kind === "tool" && tab.tool === pluginToolId(CODEX_ID, "config")) {
				return { icon: CodexGlyph };
			}
			return null;
		});

		const CodexTerminalFacts = createCodexTerminalFacts(ctx, (terminal) =>
			launcherIdeContext.has(terminalId(terminal.workspaceId, terminal.tabKey)),
		);
		ctx.terminalAccessory({
			component: ({ terminal }) => createElement(CodexTerminalFacts, { terminal }),
		});

		return () => {
			stopIdeContext();
			unsubscribeStatus();
		};
	},
});
