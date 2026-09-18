import { pluginRoute, type TerminalRef } from "@thinkrail/plugin-api";
import { definePluginHost, type PluginHostContext } from "@thinkrail/plugin-api/host";
import { type CodexStatusPush, codexContract } from "../contracts";
import { CODEX_ID, manifest } from "../manifest";
import { createAccountReader } from "./account";
import { reviveCommand } from "./agentResume";
import { createAgentWatch } from "./agentWatch";
import {
	createInstructions,
	installHooks,
	resolveCodexConfig,
	STATUS_URL_ENV,
	writeCodexValue,
} from "./config";
import { registerIdeContext } from "./ideContext";
import { createStatusStore, parseHookReport } from "./status";

type Ctx = PluginHostContext<typeof codexContract>;

function worktreeOf(ctx: Ctx, workspaceId: string): string {
	const workspace = ctx.workspace(workspaceId);
	if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);
	return workspace.worktreePath;
}

function commandOf(ctx: Ctx): string {
	return ctx.settings().command?.trim() || "codex";
}

const tabIndex = (terminal: TerminalRef): string => `${terminal.workspaceId}/${terminal.tabKey}`;

export default definePluginHost({
	manifest,
	contract: codexContract,
	async activate(ctx) {
		const stopIdeContext = registerIdeContext(ctx);
		const statuses = createStatusStore();
		const lastPrompt = new Map<string, string>();
		let account = createAccountReader(() => commandOf(ctx));
		let command = commandOf(ctx);
		ctx.onSettings(() => {
			const next = commandOf(ctx);
			if (next === command) return;
			command = next;
			void account.stop();
			account = createAccountReader(() => commandOf(ctx));
		});
		ctx.method("account", () => account.read());

		ctx.externalFiles((workspaceId) => {
			const snapshot = resolveCodexConfig(worktreeOf(ctx, workspaceId));
			return [...snapshot.layers, ...snapshot.instructions].map((file) => file.path);
		});
		ctx.method("configGet", (params) => resolveCodexConfig(worktreeOf(ctx, params.workspaceId)));
		ctx.method("setValue", (params) => {
			const worktree = worktreeOf(ctx, params.workspaceId);
			writeCodexValue(worktree, params.scope, params.keyPath, params.value);
			return resolveCodexConfig(worktree);
		});
		ctx.method("createInstructions", (params) =>
			createInstructions(worktreeOf(ctx, params.workspaceId), params.target),
		);
		ctx.method("installHooks", (params) => {
			installHooks();
			return resolveCodexConfig(worktreeOf(ctx, params.workspaceId));
		});
		ctx.method("statusSnapshot", (params) => statuses.snapshot(params.workspaceId));

		ctx.route(async (request, subpath) => {
			if (!subpath.startsWith("status/")) return new Response("not found", { status: 404 });
			if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
			const owner = ctx.terminalForToken(subpath.slice("status/".length));
			if (!owner) return new Response("unknown terminal", { status: 404 });
			const report = parseHookReport(await request.json().catch(() => null));
			if (!report) return new Response("ignored");

			if (report.prompt) {
				lastPrompt.set(tabIndex(owner), report.prompt);
				ctx.suggestWorkspaceName(owner.workspaceId, { prompt: report.prompt });
			} else if (report.event === "Stop") {
				const prompt = lastPrompt.get(tabIndex(owner));
				if (prompt) {
					ctx.suggestWorkspaceName(owner.workspaceId, { prompt, turn: report.lastMessage ?? "" });
				}
			}

			if (report.sessionId) {
				const record = ctx.agentRecord(owner);
				const existing = record?.kind === "codex" ? record : null;
				if (existing?.sessionId !== report.sessionId) {
					ctx.setAgentRecord(owner, {
						kind: "codex",
						command: existing?.command ?? commandOf(ctx),
						sessionId: report.sessionId,
					});
				}
			}

			const push: CodexStatusPush = {
				workspaceId: owner.workspaceId,
				tabKey: owner.tabKey,
				status: report.status,
				event: report.event,
				...(report.model ? { model: report.model } : {}),
				...(report.cwd ? { cwd: report.cwd } : {}),
				...(report.sessionId ? { sessionId: report.sessionId } : {}),
			};
			statuses.record(push);
			ctx.publish("status", push);
			return new Response("ok");
		});

		ctx.terminalEnv((terminal) => ({
			[STATUS_URL_ENV]: `${ctx.publicBaseUrl()}${pluginRoute(
				CODEX_ID,
				`status/${ctx.terminalToken(terminal)}`,
			)}`,
		}));

		const watch = createAgentWatch({
			listTargets: () =>
				ctx
					.terminals()
					.flatMap((terminal) =>
						terminal.pid === null
							? []
							: [{ workspaceId: terminal.workspaceId, tabKey: terminal.tabKey, pid: terminal.pid }],
					),
			onWorkspaceChanged: () => {},
			onAgentDetected: (workspaceId, tabKey) => {
				const terminal = { workspaceId, tabKey };
				const record = ctx.agentRecord(terminal);
				const existing = record?.kind === "codex" ? record : null;
				ctx.setAgentRecord(terminal, {
					kind: "codex",
					command: commandOf(ctx),
					...(existing?.sessionId !== undefined ? { sessionId: existing.sessionId } : {}),
				});
			},
			onAgentCleared: (workspaceId, tabKey) => {
				ctx.setAgentRecord({ workspaceId, tabKey }, null);
			},
		});

		const forget = (terminal: TerminalRef): void => {
			statuses.forget(terminal.workspaceId, terminal.tabKey);
			lastPrompt.delete(tabIndex(terminal));
		};
		ctx.onTerminal((event) => {
			if (event.kind === "spawned") {
				watch.poke();
			} else if (event.kind === "closed") {
				watch.forget(event.terminal.workspaceId, event.terminal.tabKey);
				forget(event.terminal);
			} else if (event.kind === "agentChanged" && event.record === null) {
				forget(event.terminal);
			}
		});

		ctx.revivePrefill((_terminal, record) => {
			if (record.kind !== "codex") return null;
			const text = reviveCommand(record.command, record.sessionId, {
				mcp: ctx.settings().mcp !== false,
				permissionMode: ctx.settings().permissionMode,
				windows: process.platform === "win32",
			});
			return text ? { text } : null;
		});

		return () => {
			stopIdeContext();
			watch.stop();
			return account.stop();
		};
	},
});
