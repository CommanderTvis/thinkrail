import { pluginRoute, type TerminalRef } from "@thinkrail/plugin-api";
import { definePluginHost, type PluginHostContext } from "@thinkrail/plugin-api/host";
import { type CodexStatusPush, codexContract } from "../contracts";
import {
	CODEX_PROMPT_JSON_ENV,
	codexLaunchLine,
	hasThinkrailPrompt,
	THINKRAIL_WORKTREES_ENV,
} from "../launch";
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

import { createModelReader } from "./models";
import {
	captureProcessCommand,
	captureProcessCwd,
	captureProcessSnapshot,
	runsInsideAgent,
} from "./processTree";
import { createRolloutReader } from "./rollout";
import { createStatusStore, parseHookReport } from "./status";
import {
	developerInstructionsJson,
	developerInstructionsPath,
	worktreesDirOf,
	writeDeveloperInstructions,
} from "./systemPrompt";

type Ctx = PluginHostContext<typeof codexContract>;

function worktreeOf(ctx: Ctx, workspaceId: string): string {
	const workspace = ctx.workspace(workspaceId);
	if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);
	return workspace.worktreePath;
}

function commandOf(ctx: Ctx): string {
	return ctx.settings().command?.trim() || "codex";
}

function withPrompt(command: string): string {
	return hasThinkrailPrompt(command)
		? command
		: codexLaunchLine(command, {
				mcp: false,
				windows: false,
				appendSystemPrompt: true,
			});
}

const tabIndex = (terminal: TerminalRef): string => `${terminal.workspaceId}/${terminal.tabKey}`;

function startedByAnotherAgent(ctx: Ctx, terminal: TerminalRef): boolean {
	const record = ctx.agentRecord(terminal);
	if (!record || record.kind === "codex") return false;
	const pid = ctx
		.terminals()
		.find((t) => t.workspaceId === terminal.workspaceId && t.tabKey === terminal.tabKey)?.pid;
	if (pid === null || pid === undefined) return false;
	const snapshot = captureProcessSnapshot();
	return snapshot !== null && runsInsideAgent(snapshot, pid, "codex", record.kind);
}

export default definePluginHost({
	manifest,
	contract: codexContract,
	async activate(ctx) {
		const stopIdeContext = registerIdeContext(ctx);
		const statuses = createStatusStore();
		const codexPidOfTab = new Map<string, number>();
		const scopeOf = (workspaceId: string, tabKey?: string): string => {
			const worktree = worktreeOf(ctx, workspaceId);
			if (!tabKey || ctx.agentRecord({ workspaceId, tabKey })?.kind !== "codex") return worktree;
			const pid = codexPidOfTab.get(tabIndex({ workspaceId, tabKey }));
			return (
				(pid ? captureProcessCwd(pid) : null) ??
				statuses.snapshot(workspaceId).find((push) => push.tabKey === tabKey)?.cwd ??
				worktree
			);
		};
		const snapshotOf = (workspaceId: string, tabKey?: string) => {
			const record = tabKey ? ctx.agentRecord({ workspaceId, tabKey }) : null;
			const promptFiles =
				record?.kind === "codex" && hasThinkrailPrompt(record.command)
					? [developerInstructionsPath()]
					: [];
			return resolveCodexConfig(
				worktreeOf(ctx, workspaceId),
				scopeOf(workspaceId, tabKey),
				promptFiles,
			);
		};
		const rollouts = createRolloutReader();
		const rolloutOfTab = new Map<string, string>();
		let account = createAccountReader(() => commandOf(ctx));
		let models = createModelReader(() => commandOf(ctx));
		let command = commandOf(ctx);
		ctx.onSettings(() => {
			const next = commandOf(ctx);
			if (next === command) return;
			command = next;
			void account.stop();
			void models.stop();
			account = createAccountReader(() => commandOf(ctx));
			models = createModelReader(() => commandOf(ctx));
		});
		ctx.method("account", () => account.read());
		ctx.method("models", () => models.read());

		ctx.externalFiles((workspaceId) => {
			const snapshots = [
				snapshotOf(workspaceId),
				...ctx
					.terminals()
					.filter((terminal) => terminal.workspaceId === workspaceId)
					.map((terminal) => snapshotOf(workspaceId, terminal.tabKey)),
			];
			return [
				...new Set(
					snapshots.flatMap((snapshot) =>
						[...snapshot.layers, ...snapshot.instructions].map((file) => file.path),
					),
				),
			];
		});
		ctx.method("configGet", (params) => snapshotOf(params.workspaceId, params.tabKey));
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
			return snapshotOf(params.workspaceId, params.tabKey);
		});
		ctx.method("statusSnapshot", (params) => statuses.snapshot(params.workspaceId));
		ctx.route(async (request, subpath) => {
			if (!subpath.startsWith("status/")) return new Response("not found", { status: 404 });
			if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
			const owner = ctx.terminalForToken(subpath.slice("status/".length));
			if (!owner) return new Response("unknown terminal", { status: 404 });
			const report = parseHookReport(await request.json().catch(() => null));
			if (!report || startedByAnotherAgent(ctx, owner)) return new Response("ignored");

			const appended = new URL(request.url).searchParams.get("thinkrail_prompt") === "1";
			if (report.sessionId) {
				const record = ctx.agentRecord(owner);
				const existing = record?.kind === "codex" ? record : null;
				let command = existing?.command ?? commandOf(ctx);
				if (appended) command = withPrompt(command);
				else if (existing?.sessionId !== report.sessionId && hasThinkrailPrompt(command))
					command = commandOf(ctx);
				if (existing?.sessionId !== report.sessionId || existing.command !== command) {
					ctx.setAgentRecord(owner, { kind: "codex", command, sessionId: report.sessionId });
				}
			}

			if (report.transcriptPath) rolloutOfTab.set(tabIndex(owner), report.transcriptPath);
			const facts = report.transcriptPath ? rollouts.read(report.transcriptPath) : {};
			const push: CodexStatusPush = {
				workspaceId: owner.workspaceId,
				tabKey: owner.tabKey,
				status: report.status,
				event: report.event,
				...(report.model ? { model: report.model } : {}),
				...(report.cwd ? { cwd: report.cwd } : {}),
				...(report.sessionId ? { sessionId: report.sessionId } : {}),
				...facts,
			};
			statuses.record(push);
			ctx.publish("status", push);
			return new Response("ok");
		});

		writeDeveloperInstructions();
		ctx.terminalEnv((terminal) => {
			const projectId = ctx.workspace(terminal.workspaceId)?.projectId;
			const slug = ctx.projects().find((project) => project.id === projectId)?.slug;
			return {
				[CODEX_PROMPT_JSON_ENV]: developerInstructionsJson(),
				...(slug ? { [THINKRAIL_WORKTREES_ENV]: worktreesDirOf(slug) } : {}),
				[STATUS_URL_ENV]: `${ctx.publicBaseUrl()}${pluginRoute(CODEX_ID, `status/${ctx.terminalToken(terminal)}`)}`,
			};
		});

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
			onAgentDetected: (workspaceId, tabKey, pid) => {
				const terminal = { workspaceId, tabKey };
				if (startedByAnotherAgent(ctx, terminal)) return;
				codexPidOfTab.set(tabIndex(terminal), pid);
				const record = ctx.agentRecord(terminal);
				const existing = record?.kind === "codex" ? record : null;
				ctx.setAgentRecord(terminal, {
					kind: "codex",
					command: captureProcessCommand(pid)?.includes(
						'developer_instructions="# You are running inside ThinkRail',
					)
						? withPrompt(existing?.command ?? commandOf(ctx))
						: (existing?.command ?? commandOf(ctx)),
					...(existing?.sessionId !== undefined ? { sessionId: existing.sessionId } : {}),
				});
			},
			onAgentCleared: (workspaceId, tabKey) => {
				ctx.setAgentRecord({ workspaceId, tabKey }, null);
			},
		});

		const forget = (terminal: TerminalRef): void => {
			codexPidOfTab.delete(tabIndex(terminal));
			statuses.forget(terminal.workspaceId, terminal.tabKey);
			const rollout = rolloutOfTab.get(tabIndex(terminal));
			rolloutOfTab.delete(tabIndex(terminal));
			if (rollout && ![...rolloutOfTab.values()].includes(rollout)) rollouts.forget(rollout);
		};
		ctx.onTerminal((event) => {
			if (event.kind === "spawned") {
				watch.poke();
			} else if (event.kind === "closed") {
				watch.forget(event.terminal.workspaceId, event.terminal.tabKey);
				forget(event.terminal);
			} else if (event.kind === "agentChanged" && event.record === null) {
				watch.forget(event.terminal.workspaceId, event.terminal.tabKey);
				forget(event.terminal);
			}
		});

		ctx.revivePrefill((_terminal, record) => {
			if (record.kind !== "codex") return null;
			const text = reviveCommand(record.command, record.sessionId, {
				mcp: ctx.settings().mcp !== false,
				permissionMode: ctx.settings().permissionMode,
				appendSystemPrompt: ctx.settings().appendSystemPrompt !== false,
				windows: process.platform === "win32",
			});
			return text ? { text } : null;
		});

		return () => {
			stopIdeContext();
			watch.stop();
			return Promise.all([account.stop(), models.stop()]).then(() => {});
		};
	},
});
