import {
	Agent,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Api, Model, MutableModels, StopReason } from "@earendil-works/pi-ai";
import {
	isTranscriptMessageRole,
	type PiEvent,
	type SessionState,
	type SessionStateRecord,
	type SessionSummary,
	type TranscriptMessage,
	type WireModel,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { joinPath, type TabFs } from "./fs";
import { toWireModel } from "./models";
import { createTools } from "./tools";

const SESSIONS_DIR = "/.thinkrail/sessions";

const SYSTEM_PROMPT = [
	"You are a coding agent in the ThinkRail Playground, which runs entirely inside a browser tab.",
	"The workspace lives in the tab's own filesystem; use the tools to read, change and commit it.",
	"bash is a simulated shell over that filesystem: coreutils, grep/rg, sed, awk, find, jq, pipes, git",
	"(including pull/push), and node, npm install, npx and tsc emulated in a sandboxed worker. There are no",
	"other programs, no install scripts, no native addons and no servers. Paths are relative to the workspace root.",
].join(" ");

interface StoredSession {
	sessionId: string;
	workspaceId: string;
	title: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	updatedAt: number;
	messages: AgentMessage[];
}

interface LiveSession {
	stored: StoredSession;
	agent: Agent | null;
	state: SessionState;
}

export interface SessionHost {
	fs: TabFs;
	models: MutableModels;
	publish(channel: string, data: unknown): void;
	workspaceRoot(workspaceId: string): { root: string; projectId: string };
	pluginTools(cwd: string): AgentTool[];
	/** Called after each tool run, which may have changed the workspace's files or git state. */
	toolRan(workspaceId: string): void;
	persist(): void;
}

const IDLE: SessionState = {
	execution: "idle",
	runId: null,
	needsInput: null,
	completion: null,
	completionUnread: false,
	queuedCount: 0,
	backgroundWork: false,
};

function wireEvent(event: AgentEvent): PiEvent {
	if (event.type === "agent_end")
		return { type: "agent_end", messages: event.messages as never, willRetry: false };
	return event as PiEvent;
}

function randomId(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export class TabSessions {
	private readonly live = new Map<string, LiveSession>();

	constructor(private readonly host: SessionHost) {
		const { fs } = host;
		if (!fs.existsSync(SESSIONS_DIR)) return;
		for (const name of fs.readdirSync(SESSIONS_DIR) as string[]) {
			const stored = JSON.parse(
				fs.readFileSync(joinPath(SESSIONS_DIR, name), "utf8") as string,
			) as StoredSession;
			this.live.set(stored.sessionId, { stored, agent: null, state: IDLE });
		}
	}

	private save(session: LiveSession): void {
		const { fs } = this.host;
		fs.mkdirSync(SESSIONS_DIR, { recursive: true });
		const messages = session.agent ? session.agent.state.messages : session.stored.messages;
		session.stored = { ...session.stored, messages, updatedAt: Date.now() };
		fs.writeFileSync(
			joinPath(SESSIONS_DIR, `${session.stored.sessionId}.json`),
			JSON.stringify(session.stored),
		);
		this.host.persist();
	}

	private get(sessionId: string): LiveSession {
		const session = this.live.get(sessionId);
		if (!session) throw new Error(`Unknown session ${sessionId}`);
		return session;
	}

	private record(session: LiveSession): SessionStateRecord {
		const { root: _root, projectId } = this.host.workspaceRoot(session.stored.workspaceId);
		return {
			sessionId: session.stored.sessionId,
			workspaceId: session.stored.workspaceId,
			projectId,
			state: session.state,
		};
	}

	private setState(session: LiveSession, state: SessionState): void {
		session.state = state;
		this.host.publish(WS_CHANNELS.sessionState, this.record(session));
	}

	private resolveModel(wire: WireModel | null): Model<Api> {
		const model = wire ? this.host.models.getModel(wire.provider, wire.id) : undefined;
		if (!model)
			throw new Error(
				"No model is available for this chat: pick one in the chat's model menu, or connect a provider in Settings → Providers.",
			);
		return model;
	}

	/** A chat without a usable model takes the first available one, as a new chat on a process host does. */
	private async ensureModel(session: LiveSession): Promise<void> {
		const wire = session.stored.model;
		if (wire && this.host.models.getModel(wire.provider, wire.id)) return;
		const [first] = await this.host.models.getAvailable();
		if (first) session.stored.model = toWireModel(first);
	}

	private agentFor(session: LiveSession): Agent {
		if (session.agent) return session.agent;
		const { root } = this.host.workspaceRoot(session.stored.workspaceId);
		const agent = new Agent({
			initialState: {
				systemPrompt: SYSTEM_PROMPT,
				model: this.resolveModel(session.stored.model),
				thinkingLevel: session.stored.thinkingLevel,
				tools: [...createTools(this.host.fs, root), ...this.host.pluginTools(root)],
				messages: session.stored.messages,
			},
			streamFn: (model, context, options) =>
				this.host.models.streamSimple(model, context as never, options),
			sessionId: session.stored.sessionId,
		});
		agent.subscribe((event) => {
			this.host.publish(WS_CHANNELS.piEvent, {
				sessionId: session.stored.sessionId,
				event: wireEvent(event),
			});
			if (event.type === "tool_execution_end") this.host.toolRan(session.stored.workspaceId);
			if (event.type === "turn_end") this.save(session);
		});
		session.agent = agent;
		return agent;
	}

	summary(session: LiveSession): SessionSummary {
		const { stored } = session;
		return {
			sessionId: stored.sessionId,
			workspaceId: stored.workspaceId,
			title: stored.title,
			model: stored.model,
			thinkingLevel: stored.thinkingLevel,
			isStreaming: session.state.execution === "running",
			messageCount: this.transcript(session).length,
			updatedAt: stored.updatedAt,
			live: session.agent !== null,
			state: session.state,
		};
	}

	private transcript(session: LiveSession): TranscriptMessage[] {
		const messages = session.agent ? session.agent.state.messages : session.stored.messages;
		return messages.filter((m) =>
			isTranscriptMessageRole((m as { role: string }).role),
		) as TranscriptMessage[];
	}

	create(workspaceId: string, model: WireModel | null, thinkingLevel: ThinkingLevel) {
		const stored: StoredSession = {
			sessionId: randomId("tab"),
			workspaceId,
			title: "New chat",
			model,
			thinkingLevel,
			updatedAt: Date.now(),
			messages: [],
		};
		const session: LiveSession = { stored, agent: null, state: IDLE };
		this.live.set(stored.sessionId, session);
		this.save(session);
		this.host.publish(WS_CHANNELS.sessionCreated, this.summary(session));
		return { sessionId: stored.sessionId, model, thinkingLevel };
	}

	list(workspaceId: string): SessionSummary[] {
		return [...this.live.values()]
			.filter((s) => s.stored.workspaceId === workspaceId)
			.map((s) => this.summary(s))
			.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	states(): SessionStateRecord[] {
		return [...this.live.values()].map((s) => this.record(s));
	}

	messages(sessionId: string) {
		const session = this.get(sessionId);
		return { summary: this.summary(session), messages: this.transcript(session) };
	}

	async prompt(sessionId: string, text: string): Promise<void> {
		const session = this.get(sessionId);
		if (!session.agent) await this.ensureModel(session);
		const agent = this.agentFor(session);
		if (session.stored.title === "New chat")
			session.stored.title = text.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";
		const runId = randomId("run");
		this.setState(session, { ...IDLE, execution: "running", runId });
		void agent
			.prompt(text)
			.catch((error: unknown) => error)
			.then(async () => {
				await agent.waitForIdle();
				const last = agent.state.messages.at(-1) as
					| { role?: string; stopReason?: string; errorMessage?: string }
					| undefined;
				const stopReason = ((last?.role === "assistant" ? last.stopReason : undefined) ??
					"stop") as StopReason;
				const errorMessage = agent.state.errorMessage;
				this.host.publish(WS_CHANNELS.piEvent, {
					sessionId,
					event: {
						type: "agent_settled",
						terminal: { stopReason, ...(errorMessage ? { errorMessage } : {}) },
					} satisfies PiEvent,
				});
				const outcome =
					stopReason === "aborted" ? "cancelled" : stopReason === "error" ? "failed" : "succeeded";
				this.setState(session, {
					...IDLE,
					completion:
						outcome === "failed"
							? { completionId: runId, outcome, failure: "error" }
							: { completionId: runId, outcome },
					completionUnread: true,
				});
				this.save(session);
			});
	}

	steer(sessionId: string, text: string): void {
		const agent = this.agentFor(this.get(sessionId));
		agent.steer({
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		} as AgentMessage);
	}

	followUp(sessionId: string, text: string): void {
		const agent = this.agentFor(this.get(sessionId));
		agent.followUp({
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		} as AgentMessage);
	}

	abort(sessionId: string): void {
		this.get(sessionId).agent?.abort();
	}

	acknowledge(sessionId: string) {
		const session = this.get(sessionId);
		this.setState(session, { ...session.state, completionUnread: false });
		return { acknowledged: true, record: this.record(session) };
	}

	setModel(sessionId: string, wire: WireModel): void {
		const session = this.get(sessionId);
		session.stored.model = wire;
		if (session.agent) session.agent.state.model = this.resolveModel(wire);
		this.save(session);
	}

	setThinkingLevel(sessionId: string, level: ThinkingLevel): void {
		const session = this.get(sessionId);
		session.stored.thinkingLevel = level;
		if (session.agent) session.agent.state.thinkingLevel = level;
		this.save(session);
	}

	rename(sessionId: string, title: string): void {
		const session = this.get(sessionId);
		session.stored.title = title;
		this.save(session);
		this.host.publish(WS_CHANNELS.piEvent, {
			sessionId,
			event: { type: "session_info_changed", name: title },
		});
	}

	delete(workspaceId: string, sessionId: string): void {
		const session = this.get(sessionId);
		session.agent?.abort();
		this.live.delete(sessionId);
		const path = joinPath(SESSIONS_DIR, `${sessionId}.json`);
		if (this.host.fs.existsSync(path)) this.host.fs.unlinkSync(path);
		this.host.persist();
		this.host.publish(WS_CHANNELS.sessionDeleted, { workspaceId, sessionId });
	}

	stats(sessionId: string) {
		const session = this.get(sessionId);
		const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
		let cost = 0;
		for (const message of this.transcript(session)) {
			const usage = (
				message as {
					usage?: {
						input: number;
						output: number;
						cacheRead: number;
						cacheWrite: number;
						totalTokens: number;
						cost: { total: number };
					};
				}
			).usage;
			if (!usage) continue;
			tokens.input += usage.input;
			tokens.output += usage.output;
			tokens.cacheRead += usage.cacheRead;
			tokens.cacheWrite += usage.cacheWrite;
			tokens.total += usage.totalTokens;
			cost += usage.cost.total;
		}
		return { sessionId, totalMessages: this.transcript(session).length, tokens, cost };
	}
}
