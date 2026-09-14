import { pluginToolId } from "@thinkrail/plugin-api";
import { definePluginWeb } from "@thinkrail/plugin-api/web";
import { createElement, Fragment } from "react";
import type { ClaudeCodeStatusPush, claudeCodeContract, IdeActionRequest } from "../contracts";
import { CLAUDE_CODE_ID } from "../manifest";
import { createClaudeCodeChip } from "./ClaudeCodeChip";
import { createClaudeCodeSettings } from "./ClaudeCodeSettings";
import { createClaudeConfigPanel } from "./ClaudeConfigPanel";
import { createClaudeGlyph } from "./ClaudeGlyph";
import { createClaudeLauncher } from "./ClaudeLauncher";
import { createClaudeTerminalFacts } from "./ClaudeTerminalFacts";
import { notifyClaudeCode } from "./claudeCodeNotify";
import { CLAUDE_MODELS, claudeLaunchCommand, shellQuotePath, withLaunchEnv } from "./claudeLaunch";
import { createIdeActionHandler } from "./ideActions";
import { useClaudeCodeStore } from "./store";

export default definePluginWeb<typeof claudeCodeContract>({
	activate(ctx) {
		const ClaudeConfigPanel = createClaudeConfigPanel(ctx);
		const ClaudeLauncher = createClaudeLauncher(ctx);
		const ClaudeGlyph = createClaudeGlyph(ctx);
		const ClaudeCodeChip = createClaudeCodeChip(ctx);
		const handleIdeAction = createIdeActionHandler(ctx);

		const unsubscribeStatus = ctx.subscribe("status", (push: ClaudeCodeStatusPush) => {
			useClaudeCodeStore.getState().applyPush(push);
			notifyClaudeCode(push.status, push.report);
		});
		const hydrated = new Set<string>();
		function ensureHydrated(workspaceId: string): void {
			if (hydrated.has(workspaceId)) return;
			hydrated.add(workspaceId);
			void ctx
				.request("statusSnapshot", { workspaceId })
				.then((rows) => {
					for (const row of rows) useClaudeCodeStore.getState().applyPush(row);
				})
				.catch(() => {});
		}

		ctx.onWorkspaceRemoved((workspaceId) => {
			hydrated.delete(workspaceId);
			useClaudeCodeStore.getState().evictWorkspace(workspaceId);
		});

		ctx.settingsSection({
			label: "Claude Code",
			icon: ClaudeGlyph,
			component: createClaudeCodeSettings(ctx),
		});

		ctx.sideTool({
			tool: pluginToolId(CLAUDE_CODE_ID, "config"),
			component: ({ workspaceId }) => {
				ensureHydrated(workspaceId);
				return createElement(ClaudeConfigPanel, { workspaceId });
			},
		});

		ctx.launcher({
			id: "claude",
			label: "Claude Code",
			icon: ClaudeGlyph,
			models: CLAUDE_MODELS.map((model) => ({ ...model, icon: ClaudeGlyph })),
			terminalCommand: (options) => {
				const settings = ctx.host().config.plugins[CLAUDE_CODE_ID] ?? {};
				const command = settings.command;
				const base = (typeof command === "string" ? command.trim() : "") || "claude";
				const parts: string[] = [];
				if (options.model) parts.push(`--model ${options.model}`);
				if (options.systemPrompt) {
					parts.push(`--append-system-prompt ${shellQuotePath(options.systemPrompt)}`);
				}
				if (options.resume) {
					parts.push(
						options.resume.sessionId ? `--resume ${options.resume.sessionId}` : "--continue",
					);
				} else if (options.initialPrompt) {
					parts.push(shellQuotePath(options.initialPrompt));
				}
				const line = claudeLaunchCommand(base, parts.join(" "));
				if (settings.disableAgentView === false) return line;
				const host = ctx.host();
				return withLaunchEnv(line, {
					platform: host.hostPlatform ?? undefined,
					windowsShell: host.config.terminalWindowsShell,
				});
			},
			useAvailable: () => ({ available: true }),
		});

		ctx.workspaceAction({ id: "claude-launch", component: ClaudeLauncher });

		ctx.tabDecoration((tab) => {
			if (tab.kind === "terminal") {
				const agent = ctx
					.host()
					.terminals[tab.workspaceId]?.find((candidate) => candidate.tabKey === tab.tabKey)?.agent;
				if (agent?.kind !== "claude") return null;
				ensureHydrated(tab.workspaceId);
				const state = useClaudeCodeStore.getState().byWorkspace[tab.workspaceId]?.[tab.tabKey];
				return {
					icon: ClaudeGlyph,
					...(state ? { adornment: statusAdornment(state.status) } : {}),
				};
			}
			if (tab.kind === "tool" && tab.tool === pluginToolId(CLAUDE_CODE_ID, "config")) {
				return { icon: ClaudeGlyph };
			}
			return null;
		});

		const ClaudeTerminalFacts = createClaudeTerminalFacts(ctx);
		ctx.terminalAccessory({
			component: ({ terminal }) => {
				const agent = ctx
					.host()
					.terminals[terminal.workspaceId]?.find(
						(candidate) => candidate.tabKey === terminal.tabKey,
					)?.agent;
				return createElement(Fragment, null, [
					createElement(ClaudeCodeChip, {
						key: "chip",
						visible: agent?.kind === "claude",
					}),
					createElement(ClaudeTerminalFacts, { key: "facts", terminal }),
				]);
			},
		});

		const stopEditorEvents = ctx.editors.onEvent((event) => {
			if (event.kind === "selection") {
				void ctx
					.request("selectionChanged", {
						workspaceId: event.editor.workspaceId,
						path: event.editor.path,
						text: event.selection?.text ?? "",
						selection: event.selection ?? {
							startLine: 1,
							startColumn: 1,
							endLine: 1,
							endColumn: 1,
						},
					})
					.catch(() => {});
			} else if (event.kind === "closed") {
				void ctx
					.request("documentClosed", {
						workspaceId: event.editor.workspaceId,
						path: event.editor.path,
					})
					.catch(() => {});
			}
		});

		const stopIdeAction = ctx.subscribe("ideAction", (request: IdeActionRequest) => {
			void handleIdeAction(request);
		});

		return () => {
			unsubscribeStatus();
			stopEditorEvents();
			stopIdeAction();
		};
	},
});

function statusAdornment(
	status: ClaudeCodeStatusPush["status"],
): ReturnType<typeof createElement> | undefined {
	if (status === "running") {
		return createElement("span", {
			"data-testid": "terminal-claude-code-status",
			"data-status": "running",
			className:
				"size-8 shrink-0 animate-spin rounded-full border-2 border-text-muted border-t-transparent motion-reduce:animate-none",
		});
	}
	if (status === "blocked") {
		return createElement("span", {
			"data-testid": "terminal-claude-code-status",
			"data-status": "blocked",
			role: "status",
			"aria-label": "Claude needs your input",
			title: "Claude needs your input",
			className:
				"size-8 shrink-0 animate-pulse rounded-full bg-feedback-warning motion-reduce:animate-none",
		});
	}
	if (status === "done") {
		return createElement("span", {
			"data-testid": "terminal-claude-code-status",
			"data-status": "done",
			"aria-label": "Claude finished",
			className: "size-8 shrink-0 rounded-full bg-feedback-success",
		});
	}
	if (status === "failed") {
		return createElement("span", {
			"data-testid": "terminal-claude-code-status",
			"data-status": "failed",
			"aria-label": "Claude hit an error",
			className: "size-8 shrink-0 rounded-full bg-feedback-error",
		});
	}
	return undefined;
}
