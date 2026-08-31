import type { AgentConnection, McpEndpoint, ProcessSpawner } from "@thinkrail/acp";
import { THINKRAIL_EXT_METHODS } from "@thinkrail/acp/meta";
import type {
	AgentAuthMethod,
	AgentPlan,
	AgentProviderInfo,
	AgentStatus,
	ChatCapabilities,
	ChatEvent,
	ChatMessage,
	ConfigOption,
	ConfigValue,
	DelegationRunStatus,
	ElicitationRequest,
	ElicitationResponse,
	MessageId,
	NoticeLevel,
	PermissionDecision,
	PermissionRequest,
	PromptContent,
	QueueLane,
	RemovedQueuedMessage,
	SessionCreated,
	SessionId,
	SessionQueueContent,
	SessionQueueState,
	SessionSummary,
	SlashCommand,
	WsResult,
} from "@thinkrail/contracts";
import { isDurableChatEvent } from "@thinkrail/contracts";
import type { TranscriptStore } from "../transcript";
import { createStagingClock, type StagingClock } from "./clock";
import { createAcpDelegates, unknownSessionError } from "./delegates";
import { mcpOffer } from "./mcp";
import { PendingAnswers } from "./pending";
import type {
	AgentDirectory,
	AgentPublishers,
	AgentTerminals,
	McpToolServer,
	SessionLocation,
	WorkspaceLookup,
	WorktreeFiles,
} from "./ports";
import { describeAgent, dormantCapabilities } from "./resolve";
import { AgentSupervisor, type RestartPolicy } from "./supervisor";

const UNREGISTERED_EVENT_BUDGET = 256;

export type SendMode = "prompt" | "steer" | "followUp";

export type AgentAuthOutcome =
	| { kind: "handled" }
	| {
			kind: "terminal";
			command: string;
			args: string[];
			env: Record<string, string>;
			cwd?: string;
	  };

export interface AgentSessionManagerOptions {
	store: TranscriptStore;
	workspaces: WorkspaceLookup;
	agents: AgentDirectory;
	files: WorktreeFiles;
	terminals: AgentTerminals;
	publishers?: Partial<AgentPublishers>;
	mcpServer?: McpToolServer | null;
	spawn?: ProcessSpawner;
	restart?: RestartPolicy;
	sleep?(ms: number): Promise<void>;
	clock?: StagingClock;
}

export class AgentSessionLostError extends Error {
	constructor(sessionId: SessionId) {
		super(`This chat's agent is no longer running and cannot resume session ${sessionId}.`);
		this.name = "AgentSessionLostError";
	}
}

interface QueuedMessage {
	messageId: MessageId;
	content: PromptContent[];
	mode: SendMode;
}

function laneOf(mode: SendMode): QueueLane {
	return mode === "steer" ? "steering" : "followUp";
}

function queuedText(message: QueuedMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function queueStateOf(queue: readonly QueuedMessage[]): SessionQueueState {
	const steering: string[] = [];
	const followUp: string[] = [];
	let hasImages = false;
	for (const queued of queue) {
		(laneOf(queued.mode) === "steering" ? steering : followUp).push(queuedText(queued));
		hasImages ||= queued.content.some((block) => block.type !== "text");
	}
	return { steering, followUp, ...(hasImages ? { hasImages: true as const } : {}) };
}

function queueContentOf(queue: readonly QueuedMessage[]): SessionQueueContent {
	const steering: PromptContent[][] = [];
	const followUp: PromptContent[][] = [];
	for (const queued of queue) {
		(laneOf(queued.mode) === "steering" ? steering : followUp).push(queued.content);
	}
	return { steering, followUp };
}

interface LiveSession {
	readonly sessionId: SessionId;
	readonly workspaceId: string;
	readonly cwd: string;
	readonly agentId: string;
	attached: boolean;
	inFlight: number;
	pumping: boolean;
	queue: QueuedMessage[];
	configOptions: ConfigOption[];
	commands: SlashCommand[];
	plan: AgentPlan | null;
}

const NO_PUBLISHERS: AgentPublishers = {
	chat: () => undefined,
	permission: () => undefined,
	elicitation: () => undefined,
	sessionDeleted: () => undefined,
};

export class AgentSessionManager {
	readonly #options: AgentSessionManagerOptions;
	readonly #store: TranscriptStore;
	readonly #clock: StagingClock;
	readonly #supervisor: AgentSupervisor;
	readonly #sessions = new Map<SessionId, LiveSession>();
	readonly #buffered = new Map<SessionId, ChatEvent[]>();
	readonly #known = new Set<SessionId>();
	readonly #permissions = new PendingAnswers<PermissionDecision>();
	readonly #elicitations = new PendingAnswers<ElicitationResponse>();
	#publishers: AgentPublishers;
	#mcpServer: McpToolServer | null;

	constructor(options: AgentSessionManagerOptions) {
		this.#options = options;
		this.#store = options.store;
		this.#clock = options.clock ?? createStagingClock();
		this.#publishers = { ...NO_PUBLISHERS, ...options.publishers };
		this.#mcpServer = options.mcpServer ?? null;
		this.#supervisor = new AgentSupervisor({
			delegates: createAcpDelegates({
				files: options.files,
				terminals: options.terminals,
				locate: (sessionId) => this.#locate(sessionId),
				publish: (sessionId, events) => {
					this.#publish(sessionId, events);
				},
				askPermission: (request) => this.#askPermission(request),
				askElicitation: (request) => this.#askElicitation(request),
				closeElicitation: (id) => {
					this.#elicitations.cancel(id);
					this.#publishers.elicitation({ type: "cancel", id });
				},
				openMcp: (serverId) => this.#openMcp(serverId),
			}),
			clock: this.#clock,
			onStatus: (agentId, status) => {
				this.#onAgentStatus(agentId, status);
			},
			hasSessions: (agentId) => this.#hasSessions(agentId),
			...(options.spawn === undefined ? {} : { spawn: options.spawn }),
			...(options.restart === undefined ? {} : { restart: options.restart }),
			...(options.sleep === undefined ? {} : { sleep: options.sleep }),
		});
	}

	setPublishers(publishers: Partial<AgentPublishers>): void {
		this.#publishers = { ...this.#publishers, ...publishers };
	}

	setMcpToolServer(server: McpToolServer | null): void {
		this.#mcpServer = server;
	}

	hasSession(sessionId: SessionId): boolean {
		return this.#sessions.has(sessionId);
	}

	isStreaming(sessionId: SessionId): boolean {
		const session = this.#sessions.get(sessionId);
		return session !== undefined && session.inFlight > 0;
	}

	workspaceOf(sessionId: SessionId): string | undefined {
		return this.#sessions.get(sessionId)?.workspaceId;
	}

	async createSession(workspaceId: string): Promise<SessionCreated> {
		const location = this.#options.workspaces.find(workspaceId);
		if (location === undefined) throw new Error(`Unknown workspace: ${workspaceId}`);
		const resolved = await this.#options.agents.resolve(location.projectId);
		const connection = await this.#supervisor.ensure(resolved);
		const offer = mcpOffer(connection.capabilities, this.#mcpServer);
		const handle = await connection.newSession({
			cwd: location.cwd,
			...(offer === undefined ? {} : { mcpServers: [offer] }),
		});
		await this.#store.open({
			sessionId: handle.sessionId,
			workspaceId,
			cwd: location.cwd,
			agentId: resolved.descriptor.id,
		});
		this.#register({
			sessionId: handle.sessionId,
			workspaceId,
			cwd: location.cwd,
			agentId: resolved.descriptor.id,
			attached: true,
			inFlight: 0,
			pumping: false,
			queue: [],
			configOptions: handle.configOptions,
			commands: [],
			plan: null,
		});
		return {
			sessionId: handle.sessionId,
			agent: connection.agent,
			capabilities: connection.capabilities,
			configOptions: handle.configOptions,
		};
	}

	prompt(sessionId: SessionId, content: PromptContent[]): { messageId: MessageId } {
		return this.#send(sessionId, content, "prompt");
	}

	steer(sessionId: SessionId, content: PromptContent[]): { messageId: MessageId } {
		return this.#send(sessionId, content, "steer");
	}

	followUp(sessionId: SessionId, content: PromptContent[]): { messageId: MessageId } {
		return this.#send(sessionId, content, "followUp");
	}

	clearQueue(sessionId: SessionId, requireTextOnly = false): SessionQueueContent {
		const session = this.#require(sessionId);
		if (requireTextOnly && queueStateOf(session.queue).hasImages) {
			throw new Error("Cannot restore queued image messages as text");
		}
		const drained = queueContentOf(session.queue);
		session.queue = [];
		this.#publishQueue(session);
		return drained;
	}

	removeQueued(sessionId: SessionId, kind: QueueLane, index: number): RemovedQueuedMessage {
		const session = this.#require(sessionId);
		const target = session.queue.filter((queued) => laneOf(queued.mode) === kind)[index];
		if (target === undefined) return { removed: null, queue: queueStateOf(session.queue) };
		session.queue = session.queue.filter((queued) => queued !== target);
		this.#publishQueue(session);
		return { removed: target.content, queue: queueStateOf(session.queue) };
	}

	childTranscript(input: {
		workspaceId: string;
		parentSessionId: string;
		childSessionId: string;
	}): Promise<{ messages: ChatMessage[]; status?: DelegationRunStatus }> {
		const session = this.#require(input.parentSessionId as SessionId);
		return this.#mustConnect(session).ext(THINKRAIL_EXT_METHODS.subagentTranscript, {
			cwd: session.cwd,
			parentSessionId: input.parentSessionId,
			childSessionId: input.childSessionId,
		});
	}

	notice(sessionId: SessionId, level: NoticeLevel, text: string): void {
		this.#publish(sessionId, [
			{
				type: "message_start",
				message: {
					role: "marker",
					id: this.#clock.mint(),
					timestamp: this.#clock.now(),
					marker: { kind: "notice", level, text },
				},
			},
		]);
	}

	async abort(sessionId: SessionId, restoreQueue = false): Promise<SessionQueueContent | null> {
		const session = this.#require(sessionId);
		const drained = restoreQueue ? queueContentOf(session.queue) : null;
		session.queue = [];
		this.#publishQueue(session);
		const connection = this.#connectionOf(session);
		if (connection !== undefined) await connection.cancel(sessionId);
		return drained;
	}

	async setConfigOption(
		sessionId: SessionId,
		optionId: string,
		value: ConfigValue,
	): Promise<ConfigOption[]> {
		const session = this.#require(sessionId);
		const connection = this.#mustConnect(session);
		const options = await connection.setConfigOption({ sessionId, optionId, value });
		session.configOptions = options;
		return options;
	}

	getCommands(sessionId: SessionId): SlashCommand[] {
		return this.#require(sessionId).commands;
	}

	answerPermission(decision: PermissionDecision): void {
		this.#permissions.answer(decision.id, decision);
	}

	answerElicitation(response: ElicitationResponse): void {
		this.#elicitations.answer(response.id, response);
	}

	async listSessions(workspaceId: string): Promise<SessionSummary[]> {
		const [records, agents] = await Promise.all([
			this.#store.list({ workspaceId }),
			this.#options.agents.list(),
		]);
		return records.map((record) => {
			const live = this.#sessions.get(record.sessionId);
			return {
				record,
				agent: describeAgent(record.agentId, agents),
				isStreaming: live !== undefined && live.inFlight > 0,
				live: live !== undefined,
				...(live !== undefined && live.queue.length > 0 ? { queue: queueStateOf(live.queue) } : {}),
			};
		});
	}

	async getMessages(
		sessionId: SessionId,
		workspaceId: string,
	): Promise<WsResult<"session.getMessages">> {
		const snapshot = await this.#store.read(sessionId);
		if (snapshot.record.workspaceId !== workspaceId) {
			throw new Error(`Chat ${sessionId} does not belong to workspace ${workspaceId}`);
		}
		const agents = await this.#options.agents.list();
		const agent = describeAgent(snapshot.record.agentId, agents);
		const live = this.#sessions.get(sessionId);
		const connection = live === undefined ? undefined : this.#connectionOf(live);
		return {
			summary: {
				record: snapshot.record,
				agent,
				isStreaming: live !== undefined && live.inFlight > 0,
				live: live !== undefined,
				...(live !== undefined && live.queue.length > 0 ? { queue: queueStateOf(live.queue) } : {}),
			},
			messages: [...snapshot.messages],
			configOptions: live?.configOptions ?? [],
			capabilities:
				connection?.capabilities ??
				this.#supervisor.capabilitiesFor(snapshot.record.agentId) ??
				dormantCapabilities(agent),
			plan: live?.plan ?? null,
		};
	}

	async deleteSession(workspaceId: string, sessionId: SessionId): Promise<void> {
		const session = this.#sessions.get(sessionId);
		if (session !== undefined) {
			const connection = this.#connectionOf(session);
			if (connection !== undefined) {
				await connection.cancel(sessionId).catch(() => undefined);
				if (connection.capabilities.sessionClose) {
					await connection.closeSession(sessionId).catch(() => undefined);
				}
			}
			this.#drop(session);
		}
		await this.#store.delete(sessionId);
		this.#publishers.sessionDeleted({ workspaceId, sessionId });
	}

	async releaseWorkspace(workspaceId: string): Promise<void> {
		for (const session of [...this.#sessions.values()]) {
			if (session.workspaceId !== workspaceId) continue;
			const connection = this.#connectionOf(session);
			if (connection?.capabilities.sessionClose === true) {
				await connection.closeSession(session.sessionId).catch(() => undefined);
			}
			this.#drop(session);
		}
		await this.#store.releaseWorkspace(workspaceId);
	}

	async dispose(): Promise<void> {
		this.#permissions.cancelAll();
		this.#elicitations.cancelAll();
		this.#sessions.clear();
		this.#buffered.clear();
		this.#known.clear();
		await this.#supervisor.closeAll();
		await this.#store.flushAll();
	}

	#send(sessionId: SessionId, content: PromptContent[], mode: SendMode): { messageId: MessageId } {
		const session = this.#require(sessionId);
		const messageId = this.#clock.mint();
		const capabilities = this.#supervisor.capabilitiesFor(session.agentId);
		if (
			session.inFlight > 0 &&
			mode !== "followUp" &&
			capabilities?.steering === "native" &&
			session.attached
		) {
			void this.#turn(session, { messageId, content, mode }, "steer");
			return { messageId };
		}
		session.queue.push({ messageId, content, mode });
		this.#publishQueue(session);
		if (!session.pumping) void this.#pump(session);
		return { messageId };
	}

	async #pump(session: LiveSession): Promise<void> {
		session.pumping = true;
		try {
			for (;;) {
				const next = session.queue.shift();
				if (next === undefined) return;
				this.#publishQueue(session);
				await this.#turn(session, next, undefined);
			}
		} finally {
			session.pumping = false;
		}
	}

	async #turn(
		session: LiveSession,
		message: QueuedMessage,
		steer: "steer" | "followUp" | undefined,
	): Promise<void> {
		session.inFlight += 1;
		try {
			const connection = await this.#attach(session);
			// The staged id is consumed synchronously by prompt()'s echo — see SPEC "One id, minted here".
			this.#clock.stage(message.messageId);
			await connection.prompt({
				sessionId: session.sessionId,
				content: message.content,
				...(steer === undefined ? {} : { steer }),
			});
		} catch (error) {
			this.#publish(session.sessionId, this.#failedTurn(message, error));
		} finally {
			session.inFlight -= 1;
		}
	}

	#failedTurn(message: QueuedMessage, error: unknown): ChatEvent[] {
		const timestamp = this.#clock.now();
		const detail =
			error instanceof Error && error.message.length > 0
				? error.message
				: "The agent could not accept this message.";
		return [
			{
				type: "message_start",
				message: {
					role: "user",
					id: message.messageId,
					timestamp,
					content: message.content,
				},
			},
			{ type: "turn_start" },
			{
				type: "turn_settled",
				message: {
					role: "marker",
					id: this.#clock.mint(),
					timestamp,
					marker: {
						kind: "turnSettled",
						stopReason: "failed",
						error: detail,
						startedAt: timestamp,
					},
				},
			},
		];
	}

	async #attach(session: LiveSession): Promise<AgentConnection> {
		const live = this.#connectionOf(session);
		if (live !== undefined && session.attached) return live;
		const connection =
			live ?? (await this.#supervisor.ensure(await this.#options.agents.byId(session.agentId)));
		if (session.attached) return connection;
		if (!connection.capabilities.sessionLoad) throw new AgentSessionLostError(session.sessionId);
		const offer = mcpOffer(connection.capabilities, this.#mcpServer);
		const handle = await connection.loadSession({
			sessionId: session.sessionId,
			cwd: session.cwd,
			replay: () => undefined,
			...(offer === undefined ? {} : { mcpServers: [offer] }),
		});
		session.configOptions = handle.configOptions;
		session.attached = true;
		return connection;
	}

	#mustConnect(session: LiveSession): AgentConnection {
		const connection = this.#connectionOf(session);
		if (connection === undefined) throw new AgentSessionLostError(session.sessionId);
		return connection;
	}

	#connectionOf(session: LiveSession): AgentConnection | undefined {
		return this.#supervisor.connectionFor(session.agentId);
	}

	async #ensureCredentialConnection(agentId: string): Promise<AgentConnection> {
		return await this.#supervisor.ensure(await this.#options.agents.byId(agentId));
	}

	#require(sessionId: SessionId): LiveSession {
		const session = this.#sessions.get(sessionId);
		if (session === undefined) throw unknownSessionError(sessionId);
		return session;
	}

	#locate(sessionId: SessionId): SessionLocation | undefined {
		const session = this.#sessions.get(sessionId);
		if (session === undefined) return undefined;
		return { sessionId, workspaceId: session.workspaceId, cwd: session.cwd };
	}

	#hasSessions(agentId: string): boolean {
		for (const session of this.#sessions.values()) {
			if (session.agentId === agentId) return true;
		}
		return false;
	}

	#detachSessionsOf(agentId: string): void {
		for (const session of this.#sessions.values()) {
			if (session.agentId === agentId) session.attached = false;
		}
	}

	#register(session: LiveSession): void {
		this.#sessions.set(session.sessionId, session);
		this.#known.add(session.sessionId);
		const status = this.#supervisor.statusFor(session.agentId);
		if (status !== undefined) {
			this.#publishers.chat({
				sessionId: session.sessionId,
				event: { type: "agent_status", status },
			});
		}
		const held = this.#buffered.get(session.sessionId);
		this.#buffered.delete(session.sessionId);
		if (held !== undefined) this.#publish(session.sessionId, held);
	}

	#drop(session: LiveSession): void {
		this.#sessions.delete(session.sessionId);
		this.#buffered.delete(session.sessionId);
	}

	#publish(sessionId: SessionId, events: ChatEvent[]): void {
		if (!this.#sessions.has(sessionId)) {
			if (this.#known.has(sessionId)) return;
			const held = this.#buffered.get(sessionId) ?? [];
			for (const event of events) {
				if (held.length >= UNREGISTERED_EVENT_BUDGET) break;
				held.push(event);
			}
			this.#buffered.set(sessionId, held);
			return;
		}
		for (const event of events) {
			this.#observe(sessionId, event);
			if (isDurableChatEvent(event)) this.#store.append(sessionId, event);
			this.#publishers.chat({ sessionId, event });
		}
	}

	#observe(sessionId: SessionId, event: ChatEvent): void {
		const session = this.#sessions.get(sessionId);
		if (session === undefined) return;
		if (event.type === "config_options") session.configOptions = event.options;
		else if (event.type === "commands") session.commands = event.commands;
		else if (event.type === "plan") session.plan = event.plan;
	}

	#publishQueue(session: LiveSession): void {
		const queue = queueStateOf(session.queue);
		this.#publishers.chat({
			sessionId: session.sessionId,
			event: {
				type: "queue_changed",
				steering: queue.steering.length,
				followUp: queue.followUp.length,
				queue,
			},
		});
	}

	#onAgentStatus(agentId: string, status: AgentStatus): void {
		for (const session of this.#sessions.values()) {
			if (session.agentId !== agentId) continue;
			if (status.phase === "crashed" || status.phase === "unavailable") session.attached = false;
			this.#publishers.chat({
				sessionId: session.sessionId,
				event: { type: "agent_status", status },
			});
		}
	}

	#askPermission(request: PermissionRequest): Promise<PermissionDecision> {
		return this.#permissions.ask(request.id, { id: request.id, outcome: "cancelled" }, () => {
			this.#publishers.permission({ type: "request", request });
		});
	}

	#askElicitation(request: ElicitationRequest): Promise<ElicitationResponse> {
		return this.#elicitations.ask(request.id, { id: request.id, outcome: "cancelled" }, () => {
			this.#publishers.elicitation({ type: "request", request });
		});
	}

	async #openMcp(serverId: string): Promise<McpEndpoint> {
		const server = this.#mcpServer;
		if (server === null) throw new Error("This host exposes no MCP tools.");
		return await server.open(serverId);
	}

	capabilitiesFor(agentId: string): ChatCapabilities | undefined {
		return this.#supervisor.capabilitiesFor(agentId);
	}

	async authMethodsFor(agentId: string): Promise<AgentAuthMethod[]> {
		const connection = await this.#ensureCredentialConnection(agentId);
		return connection.authMethods;
	}

	async authenticate(
		agentId: string,
		methodId: string,
		env: Record<string, string> | undefined,
	): Promise<AgentAuthOutcome> {
		const resolved = await this.#options.agents.byId(agentId);
		const connection = await this.#supervisor.ensure(resolved);
		const method = connection.authMethods.find((candidate) => candidate.id === methodId);
		if (method?.kind === "terminal") {
			return {
				kind: "terminal",
				command: resolved.launch.command,
				args: [...resolved.launch.args, ...(method.terminalArgs ?? [])],
				env: { ...resolved.launch.env, ...method.terminalEnv },
				...(resolved.launch.cwd === undefined ? {} : { cwd: resolved.launch.cwd }),
			};
		}
		if (method?.kind === "envVar") {
			const fresh = await this.#supervisor.restartWithEnv(resolved, env ?? {});
			this.#detachSessionsOf(agentId);
			await fresh.authenticate(methodId);
			return { kind: "handled" };
		}
		await connection.authenticate(methodId);
		return { kind: "handled" };
	}

	async logout(agentId: string, methodId?: string): Promise<void> {
		const connection = await this.#ensureCredentialConnection(agentId);
		await connection.logout(methodId);
	}

	async listProvidersFor(agentId: string): Promise<AgentProviderInfo[]> {
		const connection = await this.#ensureCredentialConnection(agentId);
		return await connection.listProviders();
	}

	async setProvider(
		agentId: string,
		routing: {
			providerId: string;
			apiType: string;
			baseUrl: string;
			headers?: Record<string, string>;
		},
	): Promise<void> {
		const connection = await this.#ensureCredentialConnection(agentId);
		await connection.setProvider(routing);
	}

	async disableProvider(agentId: string, providerId: string): Promise<void> {
		const connection = await this.#ensureCredentialConnection(agentId);
		await connection.disableProvider(providerId);
	}
}
