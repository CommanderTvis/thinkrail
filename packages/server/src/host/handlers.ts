import type {
	AgentRegistryList,
	AppConfigUpdate,
	AskUserQuestionResult,
	ConfigValue,
	DetectedAgent,
	ElicitationResponse,
	GitDiffScope,
	HistoryScope,
	InstalledAgent,
	PermissionDecision,
	PromptContent,
	QueueLane,
	ReviewAnchor,
	ReviewComment,
	ReviewCommentKind,
	ReviewCommentStatus,
	ReviewSendResult,
	SessionCreated,
	SessionSummary,
	TemplateScope,
	TodoStatus,
	Workspace,
} from "@thinkrail/contracts";
import { isControlMessage } from "@thinkrail/contracts";
import { BUNDLED_AGENT_ID, getAgentSessions, listInstalledAgents } from "../agent";
import { bucketAgent, type SendMode, track } from "../analytics";
import {
	agentAuthMethods,
	agentProviders,
	authenticateAgent,
	connectJbcentral,
	disableAgentProvider,
	disconnectJbcentral,
	jbcentralLogin,
	logoutAgent,
	setAgentProvider,
	startProxyJbcentral,
	updateJbcentral,
} from "../auth";
import { findOpenBranchReview } from "../branch-review";
import { selectDirectory, selectFile } from "../dialog";
import { listAvailableEditors, openEditor, revealInFileManager } from "../editors";
import { readDir, readFile } from "../fs";
import {
	countUnpushedCommits,
	gitDiffFile,
	gitStatus,
	listBranches,
	listCommits,
	prefetchBranch,
} from "../git";
import { githubAuthStatus, githubRefresh } from "../github";
import { searchHistory } from "../history";
import { logger } from "../log";
import { openPr, previewPr } from "../pr";
import {
	acknowledgeProjectSkills,
	closeProject,
	initProject,
	inspectProjectPath,
	listProjects,
	openProject,
	setProjectAgent,
	setProjectGroupEnabled,
	setProjectSkillEnabled,
	setProjectTrust,
} from "../projects";
import {
	addComment,
	buildSendPackage,
	clearReview,
	deleteComment,
	fileReviewSession,
	getReviewSnapshot,
	markCommentsSent,
	markFileDone,
	REVIEW_LEVEL_KEY,
	removeWorkspaceReviews,
	reviewSessionKey,
	rollbackSend,
	sendableComments,
	updateComment,
} from "../reviews";
import { updateConfig } from "../settings";
import { evictSpecIndex, projectHasSpecs, specGraph } from "../spec";
import {
	deleteTemplate,
	getTemplate,
	listTemplates,
	saveTemplate,
	templateDirs,
} from "../templates";
import {
	attachTerminal,
	closeTerminalTab,
	closeWorkspaceTerminals,
	listTerminals,
	reserveTerminal,
	resizeTerminal,
	writeTerminal,
} from "../terminal";
import {
	addTodo,
	approveTodoReview,
	countOpenTodos,
	listTodos,
	removeSessionTodoWindows,
	removeTodo,
	requestTodoFix,
	rollbackTodoFix,
	settleChangeArtifacts,
	type TodoReviewRecord,
	updateTodo,
} from "../todos";
import { ensureWatch, stopWatch } from "../watch";
import {
	createWorkspace,
	ensureWorkspaceScratchDir,
	forgetWorkspace,
	getWorkspace,
	listExistingWorktrees,
	listWorkspaceRecords,
	listWorkspaces,
	openExistingWorktree,
	reclaimWorktree,
	setWorkspaceDiffBase,
	setWorkspaceSkillOverride,
	workspaceDiffStats,
} from "../workspaces";
import { type AddAgentParams, addAgent, listDetectedAgents, removeAgent } from "./agentCatalog";
import { installAgent, listRegistry } from "./agentInstall";
import { nudgeBaseRefWorkspaces } from "./fsNudge";
import { buildHistoryScope } from "./historyScope";
import { provisionInitialTerminal } from "./initialTerminal";
import { withReviewLock } from "./reviewLock";
import {
	claimItemFix,
	isItemUnderActiveReview,
	itemFixFindings,
	markClientStale,
	releaseItemFix,
	startReviewAllFlow,
	startTodoReviewFlow,
} from "./todoReview";

const log = logger("host");

export interface RequestContext {
	clientKey: string;
}

type Handler = (params: unknown, ctx: RequestContext) => unknown | Promise<unknown>;

async function archiveTeardown(ws: Workspace): Promise<void> {
	try {
		await getAgentSessions().releaseWorkspace(ws.id);
		await settleChangeArtifacts(ws.id);
		reclaimWorktree(ws);
	} catch {
		log.warn(`workspace archive teardown failed for ${ws.id}`);
	}
}

function promptText(content: PromptContent[]): string {
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function trackSend(mode: SendMode, content: PromptContent[]): void {
	if (isControlMessage(promptText(content))) return;
	track({ name: "message_sent", params: { mode } });
}

async function startChat(workspaceId: string): Promise<SessionCreated> {
	ensureWorkspaceScratchDir(getWorkspace(workspaceId));
	const created = await getAgentSessions().createSession(workspaceId);
	track({ name: "chat_started", params: { agent: bucketAgent(created.agent) } });
	return created;
}

function fireTodoFixPrompt(
	p: { workspaceId: string; sessionId: string; id: string },
	pkg: string,
	previous: TodoReviewRecord | undefined,
	requested: TodoReviewRecord,
	findingIds: string[] = [],
): void {
	try {
		getAgentSessions().followUp(p.sessionId, [{ type: "text", text: pkg }]);
	} catch (err) {
		rollbackTodoFix(p, previous, requested);
		if (findingIds.length > 0) rollbackSend(p.workspaceId, findingIds, p.sessionId);
		getAgentSessions().notice(
			p.sessionId,
			"error",
			`Fix request send failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		throw err;
	} finally {
		releaseItemFix(p.sessionId, p.id);
	}
}

async function sendToFileChat(
	workspaceId: string,
	comments: ReviewComment[],
	opts: { sessionId?: string },
): Promise<ReviewSendResult> {
	const sessions = getAgentSessions();
	const ids = comments.map((c) => c.id);
	const pkg = await buildSendPackage(workspaceId, comments);
	const first = comments[0];
	const path = first ? reviewSessionKey(first) : REVIEW_LEVEL_KEY;
	const existing = opts.sessionId ?? (await fileReviewSession(workspaceId, path));
	if (existing !== undefined && sessions.hasSession(existing)) {
		sessions.followUp(existing, [{ type: "text", text: pkg }]);
		markCommentsSent(workspaceId, ids, existing);
		const snapshot = await sessions.getMessages(existing, workspaceId);
		return {
			sessionId: existing,
			agent: snapshot.summary.agent,
			capabilities: snapshot.capabilities,
			configOptions: snapshot.configOptions,
			reused: true,
		};
	}
	if (existing !== undefined) {
		log.warn(
			`review ${workspaceId}: linked chat ${existing} for ${path} is not running — starting a new review chat`,
		);
	}
	const created = await startChat(workspaceId);
	sessions.prompt(created.sessionId, [{ type: "text", text: pkg }]);
	markCommentsSent(workspaceId, ids, created.sessionId);
	return { ...created, reused: false };
}

const handlers: Record<string, Handler> = {
	"project.open": (params) => openProject((params as { path: string }).path),
	"project.inspect": (params) => inspectProjectPath((params as { path: string }).path),
	"project.init": (params) => initProject((params as { path: string }).path),
	"project.list": () => listProjects(),
	"project.hasSpecs": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((p) => p.id === projectId);
		return { hasSpecs: project ? projectHasSpecs(project.path) : false };
	},
	"project.close": (params) => {
		closeProject((params as { id: string }).id);
		return { ok: true } as const;
	},
	"project.setTrust": (params) => {
		const p = params as { id: string; trusted: boolean };
		return setProjectTrust(p.id, p.trusted);
	},
	"project.acknowledgeSkills": (params) => {
		const p = params as { id: string; names: string[] };
		return acknowledgeProjectSkills(p.id, p.names);
	},
	"project.setSkillEnabled": (params) => {
		const p = params as { id: string; name: string; enabled: boolean };
		return setProjectSkillEnabled(p.id, p.name, p.enabled);
	},
	"project.setGroupEnabled": (params) => {
		const p = params as { id: string; group: string; enabled: boolean };
		return setProjectGroupEnabled(p.id, p.group, p.enabled);
	},
	"project.aliasSkills": () => [],
	"project.skills": () => [],
	"skill.list": () => [],
	"skills.state": () => [],
	"workspace.create": async (params) => {
		const p = params as { projectId: string; name?: string; baseRef?: string };
		return provisionInitialTerminal(await createWorkspace(p.projectId, p.name, p.baseRef));
	},
	"workspace.listExisting": (params) =>
		listExistingWorktrees((params as { projectId: string }).projectId),
	"workspace.openExisting": (params) => {
		const p = params as { projectId: string; path: string };
		return provisionInitialTerminal(openExistingWorktree(p.projectId, p.path));
	},
	"workspace.list": async (params) => {
		const p = params as { projectId: string; includeDiffStats?: boolean };
		return (
			await listWorkspaces(p.projectId, { includeDiffStats: p.includeDiffStats ?? true })
		).map((workspace) => ({ ...workspace, ...provisionInitialTerminal(workspace) }));
	},
	"workspace.openReview": async (params) => {
		const ws = getWorkspace((params as { workspaceId: string }).workspaceId);
		const [review, unpushed] = await Promise.all([
			findOpenBranchReview(ws.worktreePath, ws.branch),
			countUnpushedCommits(ws.worktreePath, ws.branch),
		]);
		if (!review) return review;
		return unpushed ? { ...review, unpushedCommits: unpushed } : review;
	},
	"workspace.remove": (params) => {
		const id = (params as { id: string }).id;
		const ws = forgetWorkspace(id);
		if (ws) {
			evictSpecIndex(ws.id);
			removeWorkspaceReviews(ws.id);
			stopWatch(ws.id);
			closeWorkspaceTerminals(ws.id);
			void archiveTeardown(ws);
		}
		return { ok: true } as const;
	},
	"workspace.diffStats": (params) => workspaceDiffStats((params as { id: string }).id),
	"workspace.openIn": (params) => {
		const p = params as { id: string; editor: string };
		openEditor(p.editor, getWorkspace(p.id).worktreePath);
		return { ok: true } as const;
	},
	"workspace.reveal": (params) => {
		revealInFileManager(getWorkspace((params as { id: string }).id).worktreePath);
		return { ok: true } as const;
	},
	"workspace.setSkillOverride": (params) => {
		const p = params as { id: string; name: string; override: "on" | "off" | null };
		return setWorkspaceSkillOverride(p.id, p.name, p.override);
	},
	"workspace.setDiffBase": (params) => {
		const p = params as { id: string; ref: string | null };
		return setWorkspaceDiffBase(p.id, p.ref);
	},
	"workspace.watchReady": (params) => {
		const p = params as { workspaceId: string; prewarm?: boolean };
		return ensureWatch(p.workspaceId, { prewarm: p.prewarm === true });
	},
	"editor.list": () => listAvailableEditors(),
	"git.listBranches": (params) => listBranches((params as { projectId: string }).projectId),
	"git.prefetch": async (params) => {
		const p = params as { projectId: string; ref: string };
		const { ok, moved } = await prefetchBranch(p.projectId, p.ref);
		if (moved) nudgeBaseRefWorkspaces(p.projectId, p.ref);
		return { ok };
	},
	"github.authStatus": () => githubAuthStatus(),
	"github.refresh": () => githubRefresh(),
	"pr.preview": (params) =>
		previewPr(params as { workspaceId: string; sessionId: string; title?: string }),
	"pr.open": (params) =>
		openPr(
			params as {
				workspaceId: string;
				sessionId: string;
				title?: string;
				titleEdited?: boolean;
				body?: string;
				draft?: boolean;
			},
		),
	"dialog.selectDirectory": () => selectDirectory(),
	"dialog.selectFile": () => selectFile(),
	"fs.readDir": (params) => {
		const p = params as { workspaceId: string; path: string };
		void ensureWatch(p.workspaceId);
		return readDir(p.workspaceId, p.path);
	},
	"fs.readFile": (params) => {
		const p = params as { workspaceId: string; path: string };
		void ensureWatch(p.workspaceId);
		return readFile(p.workspaceId, p.path);
	},
	"spec.graph": (params) => {
		const p = params as { workspaceId: string };
		void ensureWatch(p.workspaceId);
		return specGraph(p.workspaceId);
	},
	"todo.list": (params) => listTodos(params as { workspaceId: string; sessionId: string }),
	"todo.add": (params) =>
		addTodo(params as { workspaceId: string; sessionId: string; title: string; note?: string }),
	"todo.update": (params) =>
		updateTodo(
			params as {
				workspaceId: string;
				sessionId: string;
				id: string;
				status?: TodoStatus;
				title?: string;
				note?: string;
			},
		),
	"todo.remove": (params) => {
		const p = params as { workspaceId: string; sessionId: string; id: string };
		return removeTodo(p, () => isItemUnderActiveReview(p.sessionId, p.id));
	},
	"todo.review": (params) =>
		approveTodoReview(params as { workspaceId: string; sessionId: string; id: string }),
	"todo.startReview": (params) =>
		startTodoReviewFlow(params as { workspaceId: string; sessionId: string; id: string }),
	"todo.reviewAll": (params) =>
		startReviewAllFlow(params as { workspaceId: string; sessionId: string }),
	"todo.requestFix": async (params) => {
		const p = params as { workspaceId: string; sessionId: string; id: string; feedback: string };
		if (!claimItemFix(p.sessionId, p.id))
			throw new Error(`A fix request is already active for ${p.id}.`);
		try {
			if (!getAgentSessions().hasSession(p.sessionId)) {
				throw new Error("This plan's chat is no longer running — can't send the fix request.");
			}
			const prepared = await withReviewLock(p.workspaceId, async () => {
				const request = requestTodoFix(p);
				try {
					const findings = await itemFixFindings(p);
					if (findings.length === 0)
						return { ...request, fixText: request.pkg, findingIds: [] as string[] };
					const fixText = `${request.pkg}\n\n${await buildSendPackage(p.workspaceId, findings)}`;
					const findingIds = findings.map((c) => c.id);
					await markCommentsSent(p.workspaceId, findingIds, p.sessionId);
					return { ...request, fixText, findingIds };
				} catch (error) {
					rollbackTodoFix(p, request.previous, request.requested);
					throw error;
				}
			});
			fireTodoFixPrompt(
				p,
				prepared.fixText,
				prepared.previous,
				prepared.requested,
				prepared.findingIds,
			);
			return { ok: true } as const;
		} catch (error) {
			releaseItemFix(p.sessionId, p.id);
			throw error;
		}
	},
	"git.status": (params) => {
		const p = params as { workspaceId: string; scope?: GitDiffScope };
		void ensureWatch(p.workspaceId);
		return gitStatus(p.workspaceId, p.scope);
	},
	"git.diffFile": (params) => {
		const p = params as { workspaceId: string; path: string; scope?: GitDiffScope };
		void ensureWatch(p.workspaceId);
		return gitDiffFile(p.workspaceId, p.path, p.scope);
	},
	"git.listCommits": (params) => listCommits((params as { workspaceId: string }).workspaceId),
	"terminal.reserve": (params) => {
		const p = params as { workspaceId: string; tabKey: string; title: string };
		getWorkspace(p.workspaceId);
		return { tab: reserveTerminal(p.workspaceId, p.tabKey, p.title) };
	},
	"terminal.attach": (params, ctx) => {
		const p = params as {
			workspaceId: string;
			tabKey: string;
			title?: string;
			cols?: number;
			rows?: number;
		};
		return attachTerminal(p.workspaceId, p.tabKey, ctx.clientKey, p);
	},
	"terminal.list": (params) => ({
		tabs: listTerminals((params as { workspaceId: string }).workspaceId),
	}),
	"terminal.write": (params, ctx) => {
		const p = params as { id: string; data: string };
		writeTerminal(p.id, p.data, ctx.clientKey);
		return { ok: true } as const;
	},
	"terminal.resize": (params, ctx) => {
		const p = params as { id: string; cols: number; rows: number };
		resizeTerminal(p.id, p.cols, p.rows, ctx.clientKey);
		return { ok: true } as const;
	},
	"terminal.close": (params) => {
		const p = params as { workspaceId: string; tabKey: string; force?: boolean };
		return closeTerminalTab(p.workspaceId, p.tabKey, p.force ?? false);
	},
	"session.create": (params) => startChat((params as { workspaceId: string }).workspaceId),
	"session.prompt": (params) => {
		const p = params as { sessionId: string; content: PromptContent[] };
		const sent = getAgentSessions().prompt(p.sessionId, p.content);
		trackSend("prompt", p.content);
		return sent;
	},
	"session.steer": (params) => {
		const p = params as { sessionId: string; content: PromptContent[] };
		const sent = getAgentSessions().steer(p.sessionId, p.content);
		trackSend("steer", p.content);
		return sent;
	},
	"session.followUp": (params) => {
		const p = params as { sessionId: string; content: PromptContent[] };
		const sent = getAgentSessions().followUp(p.sessionId, p.content);
		trackSend("follow_up", p.content);
		return sent;
	},
	"session.clearQueue": (params) => {
		const p = params as { sessionId: string; requireTextOnly?: boolean };
		return getAgentSessions().clearQueue(p.sessionId, p.requireTextOnly === true);
	},
	"session.removeQueued": (params) => {
		const p = params as { sessionId: string; kind: QueueLane; index: number };
		return getAgentSessions().removeQueued(p.sessionId, p.kind, p.index);
	},
	"session.abort": async (params) => {
		const p = params as { sessionId: string; restoreQueue?: boolean };
		const restoredQueue = await getAgentSessions().abort(p.sessionId, p.restoreQueue === true);
		return { ok: true, ...(restoredQueue ? { restoredQueue } : {}) } as const;
	},
	"session.delete": async (params) => {
		const p = params as { workspaceId: string; sessionId: string };
		await getAgentSessions().deleteSession(p.workspaceId, p.sessionId);
		removeSessionTodoWindows(p);
		return { ok: true } as const;
	},
	"session.setConfigOption": (params) => {
		const p = params as { sessionId: string; optionId: string; value: ConfigValue };
		return getAgentSessions().setConfigOption(p.sessionId, p.optionId, p.value);
	},
	"session.getCommands": (params) =>
		getAgentSessions().getCommands((params as { sessionId: string }).sessionId),
	"session.reloadResources": () => {
		throw new Error(
			"Reloading an agent's resources needs the ThinkRail _ext channel, which the session manager does not expose yet.",
		);
	},
	"session.answerQuestion": (params) => {
		const p = params as { sessionId: string; toolCallId: string; result: AskUserQuestionResult };
		if (!p.result || !Array.isArray(p.result.answers) || typeof p.result.cancelled !== "boolean")
			throw new Error("Malformed ask_user_question result");
		throw new Error(
			`No pending question ${p.toolCallId}: ask_user_question is an MCP tool and ThinkRail's MCP tool server is not running.`,
		);
	},
	"session.answerPermission": (params) => {
		getAgentSessions().answerPermission((params as { decision: PermissionDecision }).decision);
		return { ok: true } as const;
	},
	"session.list": async (params) => {
		const { workspaceId } = params as { workspaceId: string };
		const summaries = await getAgentSessions().listSessions(workspaceId);
		return summaries.map((summary): SessionSummary => {
			try {
				return {
					...summary,
					openTodos: countOpenTodos({ workspaceId, sessionId: summary.record.sessionId }),
				};
			} catch {
				return summary;
			}
		});
	},
	"session.getMessages": (params) => {
		const p = params as { sessionId: string; workspaceId: string };
		return getAgentSessions().getMessages(p.sessionId, p.workspaceId);
	},
	"subagent.getTranscript": (params) => {
		const p = params as { workspaceId: string; parentSessionId: string; childSessionId: string };
		getWorkspace(p.workspaceId);
		return getAgentSessions().childTranscript(p);
	},
	"agent.list": () => listInstalledAgents(),
	"agent.registry": (params): Promise<AgentRegistryList> =>
		listRegistry((params as { refresh?: boolean }).refresh === true),
	"agent.install": (params): Promise<InstalledAgent> => installAgent((params as { id: string }).id),
	"agent.add": (params): Promise<InstalledAgent> => addAgent(params as AddAgentParams),
	"agent.remove": async (params) => {
		await removeAgent((params as { id: string }).id);
		return { ok: true } as const;
	},
	"agent.detect": async (): Promise<DetectedAgent[]> =>
		listDetectedAgents((await listRegistry(false)).entries),
	"agent.select": (params) => {
		const p = params as { projectId: string; agentId: string | null };
		return setProjectAgent(p.projectId, p.agentId === BUNDLED_AGENT_ID ? null : p.agentId);
	},
	"agent.refreshConfig": () => {
		throw new Error(
			"Refreshing an agent's configuration needs the ThinkRail _ext channel, which the session manager does not expose yet.",
		);
	},
	"agent.authMethods": (params) => agentAuthMethods((params as { agentId: string }).agentId),
	"agent.authenticate": async (params) => {
		const p = params as { agentId: string; methodId: string; env?: Record<string, string> };
		const result = await authenticateAgent(p);
		if (result.outcome === "ok") {
			const agent = (await listInstalledAgents()).find((candidate) => candidate.id === p.agentId);
			track({
				name: "provider_login",
				params: {
					agent: bucketAgent(agent ?? { id: p.agentId, origin: "external" }),
					method: "agent",
				},
			});
		}
		return result;
	},
	"agent.logout": async (params) => {
		const p = params as { agentId: string; methodId?: string };
		await logoutAgent(p.agentId, p.methodId);
		return { ok: true } as const;
	},
	"agent.answerElicitation": (params) => {
		getAgentSessions().answerElicitation((params as { response: ElicitationResponse }).response);
		return { ok: true } as const;
	},
	"agent.providers": (params) => agentProviders((params as { agentId: string }).agentId),
	"agent.setProvider": async (params) => {
		const { agentId, ...routing } = params as {
			agentId: string;
			providerId: string;
			apiType: string;
			baseUrl: string;
			headers?: Record<string, string>;
		};
		await setAgentProvider(agentId, routing);
		return { ok: true } as const;
	},
	"agent.disableProvider": async (params) => {
		const p = params as { agentId: string; providerId: string };
		await disableAgentProvider(p.agentId, p.providerId);
		return { ok: true } as const;
	},
	"agent.jbcentralConnect": () => connectJbcentral(),
	"agent.jbcentralDisconnect": () => disconnectJbcentral(),
	"agent.jbcentralStartProxy": () => startProxyJbcentral(),
	"agent.jbcentralLogin": () => jbcentralLogin(),
	"agent.jbcentralUpdate": () => updateJbcentral(),
	"settings.update": (params) => {
		const config = (params as { config: AppConfigUpdate }).config;
		return updateConfig(config);
	},
	"history.search": (params) => {
		const p = params as { query: string; scope: HistoryScope; limit?: number };
		const scope = buildHistoryScope(p.scope, listProjects(), (projectId) =>
			listWorkspaceRecords(projectId),
		);
		return searchHistory({
			query: p.query,
			...scope,
			...(p.limit === undefined ? {} : { limit: p.limit }),
		});
	},

	"review.get": async (params) => {
		const p = params as { workspaceId: string };
		void ensureWatch(p.workspaceId);
		return markClientStale(await getReviewSnapshot(p.workspaceId), p.workspaceId);
	},
	"review.commentAdd": (params) => {
		const p = params as {
			workspaceId: string;
			kind: ReviewCommentKind;
			anchor: ReviewAnchor | null;
			body: string;
			scope?: GitDiffScope;
		};
		return withReviewLock(p.workspaceId, async () => addComment(p));
	},
	"review.commentUpdate": (params) => {
		const p = params as {
			workspaceId: string;
			id: string;
			body?: string;
			status?: ReviewCommentStatus;
		};
		return withReviewLock(p.workspaceId, async () => updateComment(p));
	},
	"review.commentDelete": (params) => {
		const p = params as { workspaceId: string; id: string };
		return withReviewLock(p.workspaceId, async () => {
			await deleteComment(p.workspaceId, p.id);
			return { ok: true } as const;
		});
	},
	"review.fileDone": (params) => {
		const p = params as { workspaceId: string; path: string };
		return withReviewLock(p.workspaceId, async () => {
			await markFileDone(p.workspaceId, p.path);
			return { ok: true } as const;
		});
	},
	"review.close": (params) => {
		const p = params as { workspaceId: string };
		return withReviewLock(p.workspaceId, async () => {
			await clearReview(p.workspaceId);
			return { ok: true } as const;
		});
	},
	"review.sendComment": (params) => {
		const p = params as { workspaceId: string; id: string; sessionId?: string };
		return withReviewLock(p.workspaceId, async () =>
			sendToFileChat(p.workspaceId, await sendableComments(p.workspaceId, [p.id]), p),
		);
	},
	"review.sendBatch": (params) => {
		const p = params as { workspaceId: string; commentIds?: string[]; sessionId?: string };
		return withReviewLock(p.workspaceId, async () => {
			const comments = await sendableComments(p.workspaceId, p.commentIds);
			const groups = new Map<string, typeof comments>();
			for (const comment of comments) {
				const key = reviewSessionKey(comment);
				groups.set(key, [...(groups.get(key) ?? []), comment]);
			}
			const sessions: ReviewSendResult[] = [];
			for (const group of groups.values()) {
				sessions.push(await sendToFileChat(p.workspaceId, group, p));
			}
			if (sessions.length === 0) throw new Error("No draft comments to send.");
			return { sessions };
		});
	},
	"template.list": (params) => {
		const p = params as { workspaceId?: string };
		return { templates: listTemplates(templateDirs(worktreeOf(p.workspaceId))) };
	},
	"template.get": (params) => {
		const p = params as { workspaceId?: string; name: string; scope?: TemplateScope };
		return getTemplate(templateDirs(worktreeOf(p.workspaceId)), p.name, p.scope);
	},
	"template.save": (params) => {
		const p = params as {
			workspaceId?: string;
			scope: TemplateScope;
			name: string;
			content: string;
		};
		return saveTemplate(templateDirs(worktreeOf(p.workspaceId)), p.scope, p.name, p.content);
	},
	"template.delete": (params) => {
		const p = params as { workspaceId?: string; scope: TemplateScope; name: string };
		deleteTemplate(templateDirs(worktreeOf(p.workspaceId)), p.scope, p.name);
		return { ok: true } as const;
	},
};

export function requestMethodDiagnostic(method: string): string {
	return Object.hasOwn(handlers, method) ? method : "unknown method";
}

function worktreeOf(workspaceId: string | undefined): string | undefined {
	return workspaceId === undefined ? undefined : getWorkspace(workspaceId).worktreePath;
}

export async function handleRequest(
	method: string,
	params: unknown,
	ctx: RequestContext,
): Promise<unknown> {
	const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params, ctx);
}
