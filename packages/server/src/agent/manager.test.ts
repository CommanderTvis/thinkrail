import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentLaunchSpec, ProcessSpawner, TerminalExit, TerminalOutput } from "@thinkrail/acp";
import { THINKRAIL_META_KEY } from "@thinkrail/acp";
import type {
	ChatEvent,
	ChatEventPayload,
	InstalledAgent,
	SessionDeletedPayload,
} from "@thinkrail/contracts";
import { TranscriptStore } from "../transcript";
import { AgentSessionManager } from "./manager";
import type {
	AgentDirectory,
	AgentTerminalRequest,
	AgentTerminals,
	ResolvedAgent,
	WorkspaceLookup,
	WorktreeFiles,
} from "./ports";
import { bundledAgent, listAgents } from "./resolve";
import { ScriptedAgent, type ScriptedAgentOptions } from "./testAgent";

const WORKSPACE = "w1";
const CWD = "/repo/worktrees/feature";

const RESOLVED: ResolvedAgent = bundledAgent({ command: "scripted", args: [] });

const workspaces: WorkspaceLookup = {
	find: (workspaceId) =>
		workspaceId === WORKSPACE ? { workspaceId: WORKSPACE, projectId: "p1", cwd: CWD } : undefined,
};

const agents: AgentDirectory = {
	resolve: async () => RESOLVED,
	byId: async () => RESOLVED,
	list: async (): Promise<InstalledAgent[]> => listAgents({ bundled: RESOLVED, installed: [] }),
};

const files: WorktreeFiles = {
	read: () => "",
	write: () => undefined,
	resolve: (_workspaceId, path) => path,
};

const terminals: AgentTerminals = {
	create: (_request: AgentTerminalRequest) => "t1",
	read: (): TerminalOutput => ({ output: "", truncated: false }),
	waitForExit: async (): Promise<TerminalExit> => ({ exitCode: 0, signal: null }),
	kill: () => undefined,
	release: () => undefined,
};

class RecordingStore extends TranscriptStore {
	readonly trace: string[];

	constructor(root: string, trace: string[]) {
		super(root);
		this.trace = trace;
	}

	override append(sessionId: string, event: ChatEvent): ReturnType<TranscriptStore["append"]> {
		this.trace.push(`log:${event.type}`);
		return super.append(sessionId, event);
	}
}

interface Harness {
	manager: AgentSessionManager;
	store: RecordingStore;
	trace: string[];
	events: ChatEventPayload[];
	deleted: SessionDeletedPayload[];
	spawned: ScriptedAgent[];
	launches: AgentLaunchSpec[];
	root: string;
}

const opened: Harness[] = [];

afterEach(async () => {
	for (const harness of opened.splice(0)) {
		await harness.manager.dispose();
		await harness.store.dispose();
		rmSync(harness.root, { recursive: true, force: true });
	}
});

function harness(options: ScriptedAgentOptions = {}, maxAttempts = 0): Harness {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-agent-"));
	const trace: string[] = [];
	const store = new RecordingStore(root, trace);
	const events: ChatEventPayload[] = [];
	const deleted: SessionDeletedPayload[] = [];
	const spawned: ScriptedAgent[] = [];
	const launches: AgentLaunchSpec[] = [];
	const spawn: ProcessSpawner = (launch) => {
		launches.push(launch);
		const agent = new ScriptedAgent(options);
		spawned.push(agent);
		return agent.process;
	};
	const manager = new AgentSessionManager({
		store,
		workspaces,
		agents,
		files,
		terminals,
		spawn,
		restart: { maxAttempts, delayMs: () => 0 },
		sleep: async () => undefined,
		publishers: {
			chat: (payload) => {
				trace.push(`ws:${payload.event.type}`);
				events.push(payload);
			},
			sessionDeleted: (payload) => {
				deleted.push(payload);
			},
		},
	});
	const built: Harness = { manager, store, trace, events, deleted, spawned, launches, root };
	opened.push(built);
	return built;
}

function agentOf(h: Harness): ScriptedAgent {
	const agent = h.spawned[0];
	if (agent === undefined) throw new Error("no agent was spawned");
	return agent;
}

async function nthAgent(h: Harness, count: number): Promise<ScriptedAgent> {
	for (let attempt = 0; attempt < 1_000; attempt += 1) {
		const agent = h.spawned[count - 1];
		if (h.spawned.length >= count && agent !== undefined) return agent;
		await Bun.sleep(1);
	}
	throw new Error(`fewer than ${count} agents were spawned`);
}

async function settle(): Promise<void> {
	for (let tick = 0; tick < 50; tick += 1) await Bun.sleep(1);
}

test("a new chat opens its transcript and answers with the negotiated record", async () => {
	const h = harness();
	const created = await h.manager.createSession(WORKSPACE);

	expect(created.sessionId).toBe("s1");
	expect(created.agent.id).toBe(RESOLVED.descriptor.id);
	expect(created.capabilities.fileDelegation).toBe(true);
	expect(created.capabilities.steering).toBe("queued");
	expect(h.manager.hasSession("s1")).toBe(true);

	const summaries = await h.manager.listSessions(WORKSPACE);
	expect(summaries).toHaveLength(1);
	expect(summaries[0]?.live).toBe(true);
	expect(summaries[0]?.isStreaming).toBe(false);
	expect(summaries[0]?.record.cwd).toBe(CWD);
});

test("the message id handed back is the id the echo and the transcript carry", async () => {
	const h = harness();
	await h.manager.createSession(WORKSPACE);
	const { messageId } = h.manager.prompt("s1", [{ type: "text", text: "go" }]);
	await agentOf(h).waitFor("session/prompt");

	const started = h.events.find((payload) => payload.event.type === "message_start");
	if (started?.event.type !== "message_start") throw new Error("no echo was published");
	expect(started.event.message.id).toBe(messageId);

	const snapshot = await h.store.read("s1");
	expect(snapshot.messages.map((message) => message.id)).toContain(messageId);
});

test("every durable event reaches the transcript before it reaches the wire", async () => {
	const h = harness();
	await h.manager.createSession(WORKSPACE);
	h.manager.prompt("s1", [{ type: "text", text: "go" }]);
	const prompt = await agentOf(h).waitFor("session/prompt");
	await agentOf(h).update("s1", {
		sessionUpdate: "agent_message_chunk",
		content: { type: "text", text: "hi" },
	});
	await agentOf(h).reply(prompt, { stopReason: "end_turn" });
	await settle();

	for (const [index, entry] of h.trace.entries()) {
		if (!entry.startsWith("log:")) continue;
		expect(h.trace[index + 1]).toBe(`ws:${entry.slice("log:".length)}`);
	}
	expect(h.trace).toContain("log:turn_settled");
});

test("without native steering a second message is held and dispatched at turn end", async () => {
	const h = harness();
	await h.manager.createSession(WORKSPACE);
	h.manager.prompt("s1", [{ type: "text", text: "first" }]);
	const first = await agentOf(h).waitFor("session/prompt");

	const held = h.manager.steer("s1", [{ type: "text", text: "second" }]);
	await settle();
	expect(agentOf(h).sent("session/prompt")).toHaveLength(1);
	const queued = h.events.filter((payload) => payload.event.type === "queue_changed");
	expect(queued.at(-1)?.event).toEqual({
		type: "queue_changed",
		steering: 1,
		followUp: 0,
		queue: { steering: ["second"], followUp: [] },
	});

	await agentOf(h).reply(first, { stopReason: "end_turn" });
	const second = await agentOf(h).waitFor("session/prompt");
	expect(second.params?.prompt).toEqual([{ type: "text", text: "second" }]);
	expect(second.params?._meta).toBeUndefined();

	const echoes = h.events.filter((payload) => payload.event.type === "message_start");
	expect(
		echoes.some(
			(payload) =>
				payload.event.type === "message_start" && payload.event.message.id === held.messageId,
		),
	).toBe(true);
});

test("removeQueued drops one entry by lane position and leaves its siblings queued", async () => {
	const h = harness();
	await h.manager.createSession(WORKSPACE);
	h.manager.prompt("s1", [{ type: "text", text: "first" }]);
	const first = await agentOf(h).waitFor("session/prompt");
	h.manager.steer("s1", [{ type: "text", text: "steer a" }]);
	h.manager.steer("s1", [{ type: "text", text: "steer b" }]);
	h.manager.followUp("s1", [{ type: "text", text: "later" }]);
	await settle();

	expect(h.manager.removeQueued("s1", "steering", 0)).toEqual({
		removed: [{ type: "text", text: "steer a" }],
		queue: { steering: ["steer b"], followUp: ["later"] },
	});
	expect(h.manager.removeQueued("s1", "steering", 7)).toEqual({
		removed: null,
		queue: { steering: ["steer b"], followUp: ["later"] },
	});

	await agentOf(h).reply(first, { stopReason: "end_turn" });
	const next = await agentOf(h).waitFor("session/prompt");
	expect(next.params?.prompt).toEqual([{ type: "text", text: "steer b" }]);
});

test("clearQueue drains both lanes and returns what it drained", async () => {
	const h = harness();
	await h.manager.createSession(WORKSPACE);
	h.manager.prompt("s1", [{ type: "text", text: "first" }]);
	const first = await agentOf(h).waitFor("session/prompt");
	h.manager.steer("s1", [{ type: "text", text: "steer a" }]);
	h.manager.followUp("s1", [{ type: "text", text: "later" }]);
	await settle();

	expect(h.manager.clearQueue("s1")).toEqual({
		steering: [[{ type: "text", text: "steer a" }]],
		followUp: [[{ type: "text", text: "later" }]],
	});
	expect(h.manager.clearQueue("s1")).toEqual({ steering: [], followUp: [] });

	await agentOf(h).reply(first, { stopReason: "end_turn" });
	await settle();
	expect(agentOf(h).sent("session/prompt")).toHaveLength(1);
});

test("with native steering the held message goes out during the turn instead", async () => {
	const h = harness({ meta: { [THINKRAIL_META_KEY]: { extensions: ["steering"] } } });
	const created = await h.manager.createSession(WORKSPACE);
	expect(created.capabilities.steering).toBe("native");

	h.manager.prompt("s1", [{ type: "text", text: "first" }]);
	await agentOf(h).waitFor("session/prompt");
	h.manager.steer("s1", [{ type: "text", text: "second" }]);
	await settle();

	const prompts = agentOf(h).sent("session/prompt");
	expect(prompts).toHaveLength(2);
	expect(prompts[1]?.params?._meta).toEqual({ [THINKRAIL_META_KEY]: { steer: { mode: "steer" } } });
});

test("aborting drops what is queued as well as the turn in flight", async () => {
	const h = harness();
	await h.manager.createSession(WORKSPACE);
	h.manager.prompt("s1", [{ type: "text", text: "first" }]);
	const first = await agentOf(h).waitFor("session/prompt");
	h.manager.followUp("s1", [{ type: "text", text: "second" }]);
	await settle();

	await h.manager.abort("s1");
	await agentOf(h).waitFor("session/cancel");
	const queued = h.events.filter((payload) => payload.event.type === "queue_changed");
	expect(queued.at(-1)?.event).toEqual({
		type: "queue_changed",
		steering: 0,
		followUp: 0,
		queue: { steering: [], followUp: [] },
	});

	await agentOf(h).reply(first, { stopReason: "cancelled" });
	await settle();
	expect(agentOf(h).sent("session/prompt")).toHaveLength(1);
});

test("an agent that dies mid-turn crashes alone: the chat fails, the host lives", async () => {
	const h = harness();
	await h.manager.createSession(WORKSPACE);
	h.manager.prompt("s1", [{ type: "text", text: "go" }]);
	await agentOf(h).waitFor("session/prompt");
	agentOf(h).crash(1, "panic: provider exploded\n");
	await settle();

	const statuses = h.events.flatMap((payload) =>
		payload.event.type === "agent_status" ? [payload.event.status] : [],
	);
	expect(statuses.map((status) => status.phase)).toEqual(["ready", "crashed"]);
	const crashed = statuses.at(-1);
	if (crashed?.phase !== "crashed") throw new Error("no crash was reported");
	expect(crashed.willRestart).toBe(false);
	expect(crashed.exitCode).toBe(1);
	expect(crashed.error).toContain("panic: provider exploded");

	const settled = h.events.find((payload) => payload.event.type === "turn_settled");
	if (settled?.event.type !== "turn_settled") throw new Error("the turn never settled");
	expect(settled.event.message.marker.stopReason).toBe("failed");
	expect(h.manager.isStreaming("s1")).toBe(false);
});

test("a crash with restarts left is announced as restarting and the agent comes back", async () => {
	const h = harness({}, 2);
	await h.manager.createSession(WORKSPACE);
	agentOf(h).crash(1);
	await settle();

	const phases = h.events.flatMap((payload) =>
		payload.event.type === "agent_status" ? [payload.event.status.phase] : [],
	);
	expect(phases).toEqual(["ready", "crashed", "restarting", "spawning", "ready"]);
	expect(h.spawned).toHaveLength(2);
});

test("deleting a chat closes it on the agent, trashes the record and tells the client", async () => {
	const h = harness({ agentCapabilities: { sessionCapabilities: { close: {} } } });
	await h.manager.createSession(WORKSPACE);
	await h.manager.deleteSession(WORKSPACE, "s1");

	expect(agentOf(h).sent("session/close")).toHaveLength(1);
	expect(h.deleted).toEqual([{ workspaceId: WORKSPACE, sessionId: "s1" }]);
	expect(h.manager.hasSession("s1")).toBe(false);
	expect(await h.manager.listSessions(WORKSPACE)).toEqual([]);
});

test("config options published while the session is still being opened are not lost", async () => {
	const h = harness({
		sessionConfigOptions: [
			{
				id: "model",
				name: "Model",
				category: "model",
				type: "select",
				currentValue: "a",
				options: [{ value: "a", name: "Model A" }],
			},
		],
	});
	const created = await h.manager.createSession(WORKSPACE);
	expect(created.configOptions).toHaveLength(1);
	await settle();

	expect(h.trace.indexOf("log:config_options")).toBeGreaterThanOrEqual(0);
	expect(h.trace.indexOf("log:config_options")).toBeLessThan(h.trace.indexOf("ws:config_options"));

	const read = await h.manager.getMessages("s1", WORKSPACE);
	expect(read.configOptions).toHaveLength(1);
	expect(read.capabilities.modelPicker).toBe(true);
});

test("reading a chat whose agent never started offers no capabilities at all", async () => {
	const h = harness();
	await h.manager.createSession(WORKSPACE);
	await h.manager.releaseWorkspace(WORKSPACE);

	const read = await h.manager.getMessages("s1", WORKSPACE);
	expect(read.summary.live).toBe(false);
	expect(read.plan).toBeNull();
	expect(read.configOptions).toEqual([]);
});

test("a permission request reaches the client and its answer reaches the agent", async () => {
	const h = harness();
	const asked: string[] = [];
	h.manager.setPublishers({
		permission: (push) => {
			if (push.type !== "request") return;
			asked.push(push.request.id);
			h.manager.answerPermission({
				id: push.request.id,
				outcome: "selected",
				optionId: "allow",
			});
		},
	});
	await h.manager.createSession(WORKSPACE);

	const agent = agentOf(h);
	agent.autoAnswer = false;
	await agent.request("session/request_permission", {
		sessionId: "s1",
		toolCall: { toolCallId: "c1", title: "rm -rf /", kind: "execute" },
		options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
	});
	const answer = await agent.awaitResponse();

	expect(asked).toHaveLength(1);
	expect(answer.result).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
});

test("an elicitation the agent withdraws is cancelled on the client too", async () => {
	const h = harness();
	const asked: string[] = [];
	const cancelled: string[] = [];
	h.manager.setPublishers({
		elicitation: (push) => {
			if (push.type === "request") asked.push(push.request.id);
			else cancelled.push(push.id);
		},
	});
	await h.manager.createSession(WORKSPACE);

	const agent = agentOf(h);
	agent.autoAnswer = false;
	await agent.request("elicitation/create", {
		sessionId: "s1",
		elicitationId: "e1",
		message: "Finish signing in",
		mode: "url",
		url: "https://example.test/login",
	});
	while (asked.length === 0) await Bun.sleep(1);

	const id = asked[0] ?? "";
	await agent.notify("elicitation/complete", { elicitationId: id });
	const answer = await agent.awaitResponse();

	expect(cancelled).toEqual([id]);
	expect(answer.result).toEqual({ action: "cancel" });
});

test("the agent's file reads and its commands go through the host", async () => {
	const h = harness();
	await h.manager.createSession(WORKSPACE);
	const agent = agentOf(h);
	agent.autoAnswer = false;

	await agent.request("fs/read_text_file", { sessionId: "s1", path: `${CWD}/README.md` });
	expect((await agent.awaitResponse()).result).toEqual({ content: "" });

	await agent.request("terminal/create", {
		sessionId: "s1",
		command: "bun",
		args: ["test"],
	});
	expect((await agent.awaitResponse()).result).toEqual({ terminalId: "t1" });
});

test("authMethodsFor ensures the connection and returns what the agent advertised", async () => {
	const h = harness({ authMethods: [{ id: "oauth", name: "Sign in" }] });
	expect(await h.manager.authMethodsFor(RESOLVED.descriptor.id)).toEqual([
		{ id: "oauth", name: "Sign in", kind: "agent" },
	]);
});

test("authMethodsFor propagates a spawn failure, leaving the empty-list degrade to auth's readOr", async () => {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-agent-"));
	const store = new TranscriptStore(root);
	const spawn: ProcessSpawner = () => {
		throw new Error("binary not found");
	};
	const manager = new AgentSessionManager({ store, workspaces, agents, files, terminals, spawn });
	try {
		await expect(manager.authMethodsFor(RESOLVED.descriptor.id)).rejects.toThrow();
	} finally {
		await manager.dispose();
		await store.dispose();
		rmSync(root, { recursive: true, force: true });
	}
});

test("authenticate calls the agent directly for an agent-kind method", async () => {
	const h = harness({ authMethods: [{ id: "oauth", name: "Sign in" }] });
	const authenticating = h.manager.authenticate(RESOLVED.descriptor.id, "oauth", undefined);
	const agent = await nthAgent(h, 1);
	const call = await agent.waitFor("authenticate");
	expect(call.params).toEqual({ methodId: "oauth" });
	await agent.reply(call, {});
	expect(await authenticating).toEqual({ kind: "handled" });
});

test("authenticate surfaces the agent's own rejection instead of swallowing it", async () => {
	const h = harness({ authMethods: [{ id: "oauth", name: "Sign in" }] });
	const authenticating = h.manager.authenticate(RESOLVED.descriptor.id, "oauth", undefined);
	const agent = await nthAgent(h, 1);
	const call = await agent.waitFor("authenticate");
	await agent.reject(call, "no browser available");
	await expect(authenticating).rejects.toThrow("no browser available");
});

test("authenticate respawns the agent with the collected env for an envVar-kind method", async () => {
	const h = harness({
		authMethods: [
			{ type: "env_var", id: "key", name: "API key", vars: [{ name: "OPENAI_API_KEY" }] },
		],
	});
	const authenticating = h.manager.authenticate(RESOLVED.descriptor.id, "key", {
		OPENAI_API_KEY: "sk-test",
	});
	const second = await nthAgent(h, 2);
	const call = await second.waitFor("authenticate");
	expect(call.params).toEqual({ methodId: "key" });
	await second.reply(call, {});
	expect(await authenticating).toEqual({ kind: "handled" });
	expect(h.launches[1]?.env?.OPENAI_API_KEY).toBe("sk-test");
});

test("authenticate resolves a terminal-kind method to a launch descriptor without an RPC round trip", async () => {
	const h = harness({
		authMethods: [
			{
				type: "terminal",
				id: "tui",
				name: "Sign in via terminal",
				args: ["login"],
				env: { FOO: "bar" },
			},
		],
	});
	const outcome = await h.manager.authenticate(RESOLVED.descriptor.id, "tui", undefined);
	expect(outcome).toEqual({
		kind: "terminal",
		command: "scripted",
		args: ["login"],
		env: { FOO: "bar" },
	});
	expect(agentOf(h).sent("authenticate")).toEqual([]);
});

test("logout forwards the method id to the connection", async () => {
	const h = harness();
	const logging = h.manager.logout(RESOLVED.descriptor.id, "oauth");
	const agent = await nthAgent(h, 1);
	const call = await agent.waitFor("logout");
	expect(call.params).toEqual({ methodId: "oauth" });
	await agent.reply(call, {});
	await logging;
});

test("listProvidersFor answers empty with no request sent when the agent has no providers capability", async () => {
	const h = harness();
	expect(await h.manager.listProvidersFor(RESOLVED.descriptor.id)).toEqual([]);
	expect(agentOf(h).sent("providers/list")).toEqual([]);
});

test("setProvider and disableProvider send the request the agent expects, once advertised", async () => {
	const h = harness({ agentCapabilities: { providers: {} } });
	const setting = h.manager.setProvider(RESOLVED.descriptor.id, {
		providerId: "main",
		apiType: "anthropic",
		baseUrl: "https://api.anthropic.com",
	});
	const agent = await nthAgent(h, 1);
	const setCall = await agent.waitFor("providers/set");
	expect(setCall.params).toEqual({
		providerId: "main",
		apiType: "anthropic",
		baseUrl: "https://api.anthropic.com",
	});
	await agent.reply(setCall, {});
	await setting;

	const disabling = h.manager.disableProvider(RESOLVED.descriptor.id, "spare");
	const disableCall = await agent.waitFor("providers/disable");
	expect(disableCall.params).toEqual({ providerId: "spare" });
	await agent.reply(disableCall, {});
	await disabling;
});
