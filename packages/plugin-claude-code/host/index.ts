import { isAbsolute, join } from "node:path";
import { pluginRoute, type TerminalRef } from "@thinkrail/plugin-api";
import { definePluginHost, type PluginHostContext } from "@thinkrail/plugin-api/host";
import { type ClaudeCodeStatusPush, claudeCodeContract } from "../contracts";
import { CLAUDE_CODE_ID, manifest } from "../manifest";
import {
	agentSessionExists,
	agentTranscriptPath,
	continueCommand,
	resumeCommand,
} from "./agentResume";
import { createAgentWatch } from "./agentWatch";
import {
	applyClaudeEdit,
	claudeConfigFilePaths,
	installPlugin,
	listClaudeMcpServers,
	marketplaceCommand,
	mcpListCapabilities,
	moveClaudePlugin,
	planClaudeEdit,
	pluginMoveCommands,
	pluginStatusMaintained,
	pluginUninstallCommand,
	readClaudeAccount,
	readClaudeConfigFile,
	resolveClaudeConfig,
	runMarketplaceAction,
	setAssetsRoot,
	uninstallClaudePlugin,
	writeClaudeConfigFile,
} from "./claudeConfig";
import {
	applyDocumentClosed,
	applySelectionChanged,
	ideBridgePort,
	refreshIdeBridgeWorkspaces,
	SSE_PORT_ENV,
	setIdeBridgeDeps,
	settleAction,
	startIdeBridge,
	stopIdeBridge,
} from "./ideBridge";
import { createInterruptWatch } from "./interruptWatch";
import { captureProcessCommand, captureProcessSnapshot, runsInsideAgent } from "./processTree";
import { parseStatusDelivery } from "./statusReport";
import { forgetStatus, recordStatusPush, statusSnapshotOf } from "./statusStore";
import { createTranscriptUsage } from "./transcriptUsage";

function startedByAnotherAgent(
	ctx: PluginHostContext<typeof claudeCodeContract>,
	terminal: TerminalRef,
): boolean {
	const record = ctx.agentRecord(terminal);
	if (!record || record.kind === "claude") return false;
	const pid = ctx
		.terminals()
		.find((t) => t.workspaceId === terminal.workspaceId && t.tabKey === terminal.tabKey)?.pid;
	if (pid === null || pid === undefined) return false;
	const snapshot = captureProcessSnapshot();
	return snapshot !== null && runsInsideAgent(snapshot, pid, "claude", record.kind);
}

/** Not a UUID, so it can never be a real tab's key — see SPEC.md. */
const MCP_LIST_PROBE_TAB_KEY = "claude-config-mcp-probe";

function worktreeOf(
	ctx: PluginHostContext<typeof claudeCodeContract>,
	workspaceId: string,
): string {
	const workspace = ctx.workspace(workspaceId);
	if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);
	return workspace.worktreePath;
}

function absoluteInWorkspace(
	ctx: PluginHostContext<typeof claudeCodeContract>,
	workspaceId: string,
	path: string,
): string {
	if (isAbsolute(path)) return path;
	const workspace = ctx.workspace(workspaceId);
	return workspace ? join(workspace.worktreePath, path) : path;
}

function commandOf(ctx: PluginHostContext<typeof claudeCodeContract>): string {
	return ctx.settings().command?.trim() || "claude";
}

export default definePluginHost({
	manifest,
	contract: claudeCodeContract,
	async activate(ctx) {
		setAssetsRoot(ctx.assetsDir);
		const clientForWorkspace = new Map<string, string>();

		ctx.method("configGet", (params) =>
			resolveClaudeConfig(params.workspaceId, worktreeOf(ctx, params.workspaceId)),
		);
		ctx.method("account", (params) => readClaudeAccount(commandOf(ctx), params.refresh === true));
		ctx.method("pluginStatus", () => pluginStatusMaintained(commandOf(ctx)));
		ctx.method("installPlugin", () => installPlugin(commandOf(ctx)));
		ctx.method("pluginUninstallPlan", (params) => ({
			command: pluginUninstallCommand(commandOf(ctx), params.name, params.scope),
		}));
		ctx.method("pluginUninstall", (params) =>
			uninstallClaudePlugin(
				commandOf(ctx),
				params.name,
				params.scope,
				worktreeOf(ctx, params.workspaceId),
			),
		);
		ctx.method("pluginMovePlan", (params) => ({
			commands: pluginMoveCommands(commandOf(ctx), params.name, params.from, params.to),
		}));
		ctx.method("pluginMove", (params) =>
			moveClaudePlugin(
				commandOf(ctx),
				params.name,
				params.from,
				params.to,
				worktreeOf(ctx, params.workspaceId),
			),
		);
		ctx.method("marketplacePlan", (params) => ({
			command: marketplaceCommand(commandOf(ctx), params.action),
		}));
		ctx.method("marketplaceRun", (params) =>
			runMarketplaceAction(commandOf(ctx), params.action, worktreeOf(ctx, params.workspaceId)),
		);
		ctx.method("mcpList", async (params) => {
			const worktreePath = worktreeOf(ctx, params.workspaceId);
			const declared = new Set(
				resolveClaudeConfig(params.workspaceId, worktreePath)
					.capabilities.filter((item) => item.kind === "mcp")
					.map((item) => item.name),
			);
			// The health check reports our own MCP server broken unless it is handed the same token a real
			// terminal would carry — see SPEC.md.
			const probeUrl = `${ctx.publicBaseUrl()}/mcp/${ctx.terminalToken({
				workspaceId: params.workspaceId,
				tabKey: MCP_LIST_PROBE_TAB_KEY,
			})}`;
			const entries = await listClaudeMcpServers(commandOf(ctx), worktreePath, {
				...process.env,
				THINKRAIL_MCP_URL: probeUrl,
			});
			return { capabilities: mcpListCapabilities(entries, declared, worktreePath) };
		});
		ctx.externalFiles((workspaceId) =>
			claudeConfigFilePaths(workspaceId, worktreeOf(ctx, workspaceId)),
		);
		ctx.method("readFile", (params) =>
			readClaudeConfigFile(params.workspaceId, worktreeOf(ctx, params.workspaceId), params.path),
		);
		ctx.method("writeFile", (params) =>
			writeClaudeConfigFile(
				params.workspaceId,
				worktreeOf(ctx, params.workspaceId),
				params.path,
				params.content,
				params.baseHash,
			),
		);
		ctx.method("planEdit", (params) => planClaudeEdit(params, worktreeOf(ctx, params.workspaceId)));
		ctx.method("applyEdit", (params) =>
			applyClaudeEdit(params, worktreeOf(ctx, params.workspaceId)),
		);

		ctx.method("selectionChanged", (params, call) => {
			clientForWorkspace.set(params.workspaceId, call.clientKey);
			applySelectionChanged({
				...params,
				path: absoluteInWorkspace(ctx, params.workspaceId, params.path),
			});
			return { ok: true as const };
		});
		ctx.method("documentClosed", (params, call) => {
			clientForWorkspace.set(params.workspaceId, call.clientKey);
			applyDocumentClosed({
				...params,
				path: absoluteInWorkspace(ctx, params.workspaceId, params.path),
			});
			return { ok: true as const };
		});
		ctx.method("actionReply", (params) => {
			settleAction(params);
			return { ok: true as const };
		});
		ctx.method("statusSnapshot", (params) => statusSnapshotOf(params.workspaceId));

		setIdeBridgeDeps({
			dispatch: (request) => {
				const clientKey = clientForWorkspace.get(request.workspaceId);
				if (!clientKey) throw new Error("No ThinkRail client is connected");
				ctx.publish("ideAction", request, { clientKey });
			},
			listWorkspaceFolders: () => [
				...new Set(ctx.workspaces().map((workspace) => workspace.worktreePath)),
			],
			workspaceForProcess: ctx.workspaceForProcess,
		});
		try {
			await startIdeBridge();
		} catch (err) {
			ctx.log.warn(`could not start the IDE bridge: ${err instanceof Error ? err.message : err}`);
		}

		const interrupts = createInterruptWatch();
		const tabIndex = (terminal: { workspaceId: string; tabKey: string }): string =>
			`${terminal.workspaceId}\u0000${terminal.tabKey}`;
		const usage = createTranscriptUsage();
		const transcriptOfTab = new Map<string, string>();
		const forgetTab = (terminal: TerminalRef): void => {
			const key = tabIndex(terminal);
			const transcript = transcriptOfTab.get(key);
			transcriptOfTab.delete(key);
			if (transcript && ![...transcriptOfTab.values()].includes(transcript))
				usage.forget(transcript);
			interrupts.stop(key);
			forgetStatus(terminal.workspaceId, terminal.tabKey);
		};
		const publishStatus = (push: ClaudeCodeStatusPush): void => {
			recordStatusPush(push);
			ctx.publish("status", push);
		};

		ctx.route(async (request, subpath) => {
			if (!subpath.startsWith("status/")) return new Response("not found", { status: 404 });
			if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
			const owner = ctx.terminalForToken(subpath.slice("status/".length));
			if (!owner) return new Response("unknown terminal", { status: 404 });
			const body: unknown = await request.json().catch(() => null);
			const delivery = parseStatusDelivery(body);
			if (delivery === "unreadable" || startedByAnotherAgent(ctx, owner)) {
				return new Response("ignored");
			}

			const { event, query, response } = delivery.report;
			if (event === "prompt_submit" && query) {
				ctx.suggestWorkspaceName(owner.workspaceId, { prompt: query });
			} else if (event === "stop" && query) {
				ctx.suggestWorkspaceName(owner.workspaceId, { prompt: query, turn: response ?? "" });
			}

			if (delivery.report.session_id) {
				const existing = ctx.agentRecord(owner);
				if (existing?.sessionId !== delivery.report.session_id) {
					ctx.setAgentRecord(owner, {
						kind: existing?.kind ?? "claude",
						command: existing?.command ?? "claude",
						sessionId: delivery.report.session_id,
					});
				}
			}

			const { session_id: sessionId, cwd, project, transcript_path: reported } = delivery.report;
			const locateTranscript = (): string | null =>
				reported ?? (sessionId ? agentTranscriptPath(cwd ?? "", sessionId) : null);
			const transcript = locateTranscript();
			if (transcript) transcriptOfTab.set(tabIndex(owner), transcript);
			const push: ClaudeCodeStatusPush = {
				workspaceId: owner.workspaceId,
				tabKey: owner.tabKey,
				status: delivery.status,
				report: delivery.report,
				...(transcript ? { usage: usage.read(transcript) } : {}),
			};
			publishStatus(push);

			if (delivery.status === "running" && sessionId) {
				interrupts.track(tabIndex(owner), locateTranscript, () =>
					publishStatus({
						...push,
						status: "idle",
						report: {
							event: "interrupted",
							session_id: sessionId,
							...(cwd !== undefined ? { cwd } : {}),
							...(project !== undefined ? { project } : {}),
						},
					}),
				);
			} else if (delivery.status !== null) {
				interrupts.stop(tabIndex(owner));
			}
			return new Response("ok");
		});

		ctx.terminalEnv((terminal) => {
			const env: Record<string, string> = {
				THINKRAIL_AGENT_STATUS_URL: `${ctx.publicBaseUrl()}${pluginRoute(
					CLAUDE_CODE_ID,
					`status/${ctx.terminalToken(terminal)}`,
				)}`,
			};
			const bridgePort = ideBridgePort();
			if (bridgePort !== null) env[SSE_PORT_ENV] = String(bridgePort);
			return env;
		});

		const watch = createAgentWatch({
			listTargets: () =>
				ctx
					.terminals()
					.reduce<{ workspaceId: string; tabKey: string; pid: number }[]>((targets, terminal) => {
						if (terminal.pid !== null) {
							targets.push({
								workspaceId: terminal.workspaceId,
								tabKey: terminal.tabKey,
								pid: terminal.pid,
							});
						}
						return targets;
					}, []),
			onWorkspaceChanged: () => {},
			onAgentDetected: (workspaceId, tabKey, agentPid) => {
				if (startedByAnotherAgent(ctx, { workspaceId, tabKey })) return;
				const command = captureProcessCommand(agentPid);
				if (!command) return;
				const terminal = { workspaceId, tabKey };
				const existing = ctx.agentRecord(terminal);
				ctx.setAgentRecord(terminal, {
					kind: "claude",
					command,
					...(existing?.sessionId !== undefined ? { sessionId: existing.sessionId } : {}),
				});
			},
			onAgentCleared: (workspaceId, tabKey) => {
				ctx.setAgentRecord({ workspaceId, tabKey }, null);
			},
		});

		ctx.onTerminal((event) => {
			if (event.kind === "spawned") {
				watch.poke();
			} else if (
				event.kind === "closed" ||
				(event.kind === "agentChanged" && event.record === null)
			) {
				watch.forget(event.terminal.workspaceId, event.terminal.tabKey);
				forgetTab(event.terminal);
			}
		});

		ctx.onWorkspace((event) => {
			if (event.kind !== "updated") refreshIdeBridgeWorkspaces();
		});

		ctx.revivePrefill((terminal, record) => {
			if (record.kind !== "claude") return null;
			const cwd = ctx.workspace(terminal.workspaceId)?.worktreePath ?? "";
			const sessionId =
				record.sessionId !== undefined && agentSessionExists(cwd, record.sessionId)
					? record.sessionId
					: undefined;
			const offer = sessionId
				? resumeCommand(record.command, sessionId)
				: continueCommand(record.command);
			return offer ? { text: offer } : null;
		});

		return async () => {
			watch.stop();
			interrupts.stopAll();
			setIdeBridgeDeps(null);
			setAssetsRoot(null);
			clientForWorkspace.clear();
			await stopIdeBridge();
		};
	},
});
