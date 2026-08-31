import { beforeEach, expect, test } from "bun:test";
import type {
	AgentPlan,
	ChatEvent,
	ChatMessage,
	ConfigOption,
	ElicitationRequest,
	PermissionRequest,
	Project,
	SessionRecord,
	SessionSummary,
	SpecGraphNode,
	Workspace,
	WorkspaceFsChangedPayload,
	WorkspaceLayoutDocument,
	WorkspaceSkillChange,
} from "@thinkrail/contracts";
import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import type { HydratedRuntime } from "../chat/hydrate";
import {
	captureCenterNavigation,
	chatTabId,
	EMPTY_RUNTIME,
	type FileTab,
	isCenterNavigationCurrent,
	layoutOpenOptionsForNavigation,
	type SessionRuntime,
	shouldAdvanceAcceptedNavigation,
	toast,
	useAppStore,
} from "./appStore";
import {
	selectCurrentRouteChatTarget,
	selectDiffScope,
	selectLastOpenChatSession,
	selectSkillsStale,
	selectWorkspaceNavTick,
	selectWorkspaceSessionIds,
	selectWorkspaceTick,
} from "./selectors";

function userMessage(id: string, text: string): ChatMessage {
	return { role: "user", id, timestamp: 0, content: [{ type: "text", text }] };
}

function assistantMessage(id: string): ChatMessage {
	return { role: "assistant", id, timestamp: 0, blocks: [] };
}

function toolCall(
	toolCallId: string,
	status: "pending" | "running" | "done" | "error" | "abandoned" = "pending",
) {
	return {
		type: "toolCall" as const,
		toolCallId,
		toolName: "bash",
		title: "Run ls",
		kind: "execute" as const,
		status,
		arguments: { command: "ls" },
	};
}

function turnSettled(
	id: string,
	stopReason: "completed" | "failed" | "cancelled" = "completed",
	error?: string,
): ChatEvent {
	return {
		type: "turn_settled",
		message: {
			role: "marker",
			id,
			timestamp: 0,
			marker: { kind: "turnSettled", stopReason, ...(error !== undefined ? { error } : {}) },
		},
	};
}

function summary(
	sessionId: string,
	workspaceId: string,
	recordOver: Partial<SessionRecord> = {},
	summaryOver: Partial<Omit<SessionSummary, "record">> = {},
): SessionSummary {
	return {
		record: {
			sessionId,
			workspaceId,
			cwd: `/tmp/${workspaceId}`,
			agentId: "pi",
			title: "Chat",
			createdAt: 0,
			updatedAt: 0,
			messageCount: 0,
			promptCount: 0,
			lastSettlement: null,
			usage: null,
			config: [],
			...recordOver,
		},
		agent: { id: "pi", name: "pi", origin: "bundled" },
		isStreaming: false,
		live: true,
		...summaryOver,
	};
}

function hydrated(messages: ChatMessage[] = [], plan: AgentPlan | null = null): HydratedRuntime {
	return { messages, configOptions: [], capabilities: EMPTY_RUNTIME.capabilities, plan };
}

function elicitationRequest(id: string, sessionId?: string): ElicitationRequest {
	return {
		kind: "url",
		id,
		...(sessionId ? { sessionId } : {}),
		message: "Sign in",
		url: "https://example.com/auth",
	};
}

function permissionRequest(id: string, sessionId: string, toolCallId: string): PermissionRequest {
	return {
		id,
		sessionId,
		toolCallId,
		call: {
			type: "toolCall",
			toolCallId,
			toolName: "bash",
			title: "Run",
			kind: "execute",
			status: "pending",
			arguments: {},
		},
		options: [{ id: "allow", name: "Allow", kind: "allowOnce" }],
	};
}

const emptyBottomRegion = (): WorkspaceLayoutDocument["bottom"] => ({
	visible: false,
	height: 0.3,
	alignment: "center",
	groups: [],
});

beforeEach(() => {
	useAppStore.setState({
		status: "connecting",
		connectionGeneration: 0,
		welcomeGeneration: 0,
		protocolVersion: null,
		routeChatTarget: null,
		routeChatTargetGeneration: 0,
		sessions: {},
		activeElicitation: null,
		elicitationQueue: [],
		workspaceSelectionHistory: [],
		layoutSnapshotsByWorkspace: {},
		workbenchFrame: null,
		workspaceViewsByWorkspace: {},
		layoutStateReady: false,
		layoutDocumentsByWorkspace: {},
		layoutAttentionByWorkspace: {},
		layoutProjectionEpochByWorkspace: {},
		layoutIntents: [],
		tabsByWorkspace: {},
		terminalsByWorkspace: {},
		activeTerminalByWorkspace: {},
		activeTabByWorkspace: {},
		previewTabByWorkspace: {},
		navTickByWorkspace: {},
		closedChatsByWorkspace: {},
		deletedSessionsByWorkspace: {},
		fsChangesByWorkspace: {},
		skillChangeTickByWorkspace: {},
		skillsSyncedTickBySession: {},
		projects: [],
		recentProjects: [],
		workspaces: {},
		removedWorkspaceIds: {},
		expandedProjectIds: {},
		selectedProjectId: null,
		activeWorkspaceId: null,
		settingsOpen: false,
		settingsSection: "agents",
		chatMessageOrder: "oldest-first",
		toasts: [],
	});
});

function rt(sessionId: string): SessionRuntime {
	const runtime = useAppStore.getState().sessions[sessionId];
	if (!runtime) throw new Error(`no runtime for ${sessionId}`);
	return runtime;
}

function blocksOf(sessionId: string, index = 0) {
	const message = rt(sessionId).messages[index];
	if (message?.role !== "assistant") throw new Error("expected an assistant message");
	return message.blocks;
}

test("each connected status advances the reconnect generation atomically", () => {
	const store = useAppStore.getState();
	store.setStatus("connected");
	expect(useAppStore.getState()).toMatchObject({ status: "connected", connectionGeneration: 1 });
	store.setStatus("disconnected");
	expect(useAppStore.getState()).toMatchObject({ status: "disconnected", connectionGeneration: 1 });
	store.setStatus("connecting");
	store.setStatus("connected");
	expect(useAppStore.getState()).toMatchObject({ status: "connected", connectionGeneration: 2 });
});

test("selectLastOpenChatSession: active chat tab first, then the most recent chat tab, else null", () => {
	const store = useAppStore.getState();
	expect(selectLastOpenChatSession(useAppStore.getState(), "ws1")).toBeNull();
	store.openChatSession("ws1", "s1", EMPTY_RUNTIME.capabilities, []);
	store.openChatSession("ws1", "s2", EMPTY_RUNTIME.capabilities, []);
	expect(selectLastOpenChatSession(useAppStore.getState(), "ws1")).toBe("s2");
	useAppStore.getState().openTab(fileTab("ws1", "a.ts"), "keep");
	expect(selectLastOpenChatSession(useAppStore.getState(), "ws1")).toBe("s2");
});

test("chat events route to the right session runtime; chats stay independent", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.openChatSession("ws1", "b", EMPTY_RUNTIME.capabilities, []);

	store.applyChatEvent("a", { type: "turn_start" });
	expect(rt("a").isStreaming).toBe(true);
	expect(rt("b").isStreaming).toBe(false);

	store.applyChatEvent("b", { type: "turn_start" });
	expect(rt("a").isStreaming).toBe(true);
	expect(rt("b").isStreaming).toBe(true);

	store.applyChatEvent("a", turnSettled("s1"));
	expect(rt("a").isStreaming).toBe(false);
	expect(rt("a").messages).toHaveLength(1);
	expect(rt("b").isStreaming).toBe(true);
	expect(rt("b").messages).toHaveLength(0);
});

test("message_start appends a new message, and REPLACES in place for a known id (the optimistic-echo + host-rewrite mechanism)", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);

	store.applyChatEvent("a", {
		type: "message_start",
		message: userMessage("u1", "/skill:review go"),
	});
	expect(rt("a").messages).toHaveLength(1);

	store.applyChatEvent("a", {
		type: "message_start",
		message: userMessage("u1", '<skill name="review">…</skill>\n\ngo'),
	});
	const messages = rt("a").messages;
	expect(messages).toHaveLength(1);
	expect(messages[0]?.role === "user" && messages[0].content[0]).toEqual({
		type: "text",
		text: '<skill name="review">…</skill>\n\ngo',
	});

	store.applyChatEvent("a", {
		type: "message_start",
		message: userMessage("u2", "second message"),
	});
	expect(rt("a").messages).toHaveLength(2);
});

test("chunk appends text at (messageId, index), creating the block on first arrival", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.applyChatEvent("a", { type: "message_start", message: assistantMessage("m1") });

	store.applyChatEvent("a", {
		type: "chunk",
		messageId: "m1",
		index: 0,
		kind: "text",
		delta: "po",
	});
	store.applyChatEvent("a", {
		type: "chunk",
		messageId: "m1",
		index: 0,
		kind: "text",
		delta: "ng",
	});

	expect(blocksOf("a")).toEqual([{ type: "text", text: "pong" }]);
});

test("chunk for an unknown message id is a no-op — the message must already exist", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	const beforeMessages = rt("a").messages;

	store.applyChatEvent("a", {
		type: "chunk",
		messageId: "ghost",
		index: 0,
		kind: "text",
		delta: "x",
	});
	expect(rt("a").messages).toBe(beforeMessages);
});

test("block SETs a whole block at an index — replacing what was there, appending past the end", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.applyChatEvent("a", { type: "message_start", message: assistantMessage("m1") });

	store.applyChatEvent("a", {
		type: "block",
		messageId: "m1",
		index: 0,
		block: { type: "image", data: "aGk=", mimeType: "image/png" },
	});
	expect(blocksOf("a")).toEqual([{ type: "image", data: "aGk=", mimeType: "image/png" }]);

	store.applyChatEvent("a", {
		type: "block",
		messageId: "m1",
		index: 1,
		block: { type: "text", text: "appended" },
	});
	expect(blocksOf("a")).toEqual([
		{ type: "image", data: "aGk=", mimeType: "image/png" },
		{ type: "text", text: "appended" },
	]);
});

test("tool_call_update REPLACES only the named fields (and output wholesale), leaving siblings untouched", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.applyChatEvent("a", { type: "message_start", message: assistantMessage("m1") });
	store.applyChatEvent("a", { type: "block", messageId: "m1", index: 0, block: toolCall("t1") });
	store.applyChatEvent("a", {
		type: "block",
		messageId: "m1",
		index: 1,
		block: { type: "text", text: "prose" },
	});

	store.applyChatEvent("a", {
		type: "tool_call_update",
		toolCallId: "t1",
		patch: { status: "done", output: [{ type: "text", text: "ok" }] },
	});

	expect(blocksOf("a")).toEqual([
		{ ...toolCall("t1"), status: "done", output: [{ type: "text", text: "ok" }] },
		{ type: "text", text: "prose" },
	]);
});

test("tool_call_update for an unknown toolCallId is a no-op", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.applyChatEvent("a", { type: "message_start", message: assistantMessage("m1") });
	store.applyChatEvent("a", { type: "block", messageId: "m1", index: 0, block: toolCall("t1") });
	const before = rt("a");

	store.applyChatEvent("a", {
		type: "tool_call_update",
		toolCallId: "ghost",
		patch: { status: "error" },
	});
	expect(rt("a")).toBe(before);
});

test("message_end sets endedAt on the named assistant message; a non-assistant or unknown id is a no-op", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.applyChatEvent("a", { type: "message_start", message: assistantMessage("m1") });

	store.applyChatEvent("a", { type: "message_end", messageId: "m1", endedAt: 1234 });
	const message = rt("a").messages[0];
	expect(message?.role === "assistant" && message.endedAt).toBe(1234);

	const before = rt("a");
	store.applyChatEvent("a", { type: "message_end", messageId: "ghost", endedAt: 5678 });
	expect(rt("a")).toBe(before);
});

test("message_superseded flags the message rather than removing it", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.applyChatEvent("a", { type: "message_start", message: assistantMessage("m1") });

	store.applyChatEvent("a", { type: "message_superseded", messageId: "m1" });
	expect(rt("a").messages).toHaveLength(1);
	const message = rt("a").messages[0];
	expect(message?.role === "assistant" && message.superseded).toBe(true);
});

test("turn_settled appends its marker message and clears isStreaming, every retry countdown, and the compaction flag", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.applyChatEvent("a", { type: "turn_start" });
	store.applyChatEvent("a", {
		type: "retry_scheduled",
		scope: "turn",
		attempt: 1,
		maxAttempts: 3,
		delayMs: 500,
	});
	store.applyChatEvent("a", { type: "compaction_start", reason: "threshold" });

	store.applyChatEvent("a", turnSettled("settled-1", "failed", "boom"));

	const after = rt("a");
	expect(after.isStreaming).toBe(false);
	expect(after.retries).toEqual({});
	expect(after.compacting).toBeNull();
	expect(after.messages).toHaveLength(1);
	const marker = after.messages[0];
	expect(marker?.role === "marker" && marker.marker).toEqual({
		kind: "turnSettled",
		stopReason: "failed",
		error: "boom",
	});
});

test("retry_scheduled/retry_cleared track one RetryScope key each; overlapping scopes never clear each other", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);

	store.applyChatEvent("a", {
		type: "retry_scheduled",
		scope: "turn",
		attempt: 1,
		maxAttempts: 3,
		delayMs: 1000,
	});
	store.applyChatEvent("a", {
		type: "retry_scheduled",
		scope: "summarization",
		attempt: 1,
		maxAttempts: 2,
		delayMs: 2000,
	});
	expect(rt("a").retries).toEqual({
		turn: { attempt: 1, maxAttempts: 3, delayMs: 1000 },
		summarization: { attempt: 1, maxAttempts: 2, delayMs: 2000 },
	});

	store.applyChatEvent("a", { type: "retry_cleared", scope: "turn" });
	expect(rt("a").retries).toEqual({ summarization: { attempt: 1, maxAttempts: 2, delayMs: 2000 } });

	store.applyChatEvent("a", { type: "retry_cleared", scope: "summarization" });
	expect(rt("a").retries).toEqual({});
});

test("compaction_start/compaction_end only drive the ephemeral progress flag — the durable outcome is a separate message", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);

	store.applyChatEvent("a", { type: "compaction_start", reason: "overflow" });
	expect(rt("a").compacting).toBe("overflow");
	expect(rt("a").messages).toHaveLength(0);

	store.applyChatEvent("a", { type: "compaction_end", reason: "overflow" });
	expect(rt("a").compacting).toBeNull();
	expect(rt("a").messages).toHaveLength(0);

	store.applyChatEvent("a", {
		type: "message_start",
		message: {
			role: "marker",
			id: "c1",
			timestamp: 0,
			marker: { kind: "compaction", reason: "overflow", summary: "trimmed the history" },
		},
	});
	expect(rt("a").messages).toHaveLength(1);
});

test("config_options / commands / usage / plan / capabilities / agent_status each replace their field wholesale", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);

	const options: ConfigOption[] = [
		{
			id: "model",
			name: "Model",
			category: "model",
			control: { type: "select", value: "opus", groups: [] },
		},
	];
	store.applyChatEvent("a", { type: "config_options", options });
	expect(rt("a").configOptions).toBe(options);

	store.applyChatEvent("a", { type: "commands", commands: [{ name: "review" }] });
	expect(rt("a").commands).toEqual([{ name: "review" }]);

	store.applyChatEvent("a", {
		type: "usage",
		usage: { contextUsed: 1200, contextWindow: 200_000 },
	});
	expect(rt("a").usage).toEqual({ contextUsed: 1200, contextWindow: 200_000 });

	const plan = { entries: [{ text: "ship it", status: "active" as const }] };
	store.applyChatEvent("a", { type: "plan", plan });
	expect(rt("a").plan).toBe(plan);
	store.applyChatEvent("a", { type: "plan", plan: null });
	expect(rt("a").plan).toBeNull();

	const capabilities = { ...EMPTY_RUNTIME.capabilities, cost: true };
	store.applyChatEvent("a", { type: "capabilities", capabilities });
	expect(rt("a").capabilities).toBe(capabilities);

	store.applyChatEvent("a", { type: "agent_status", status: { phase: "restarting", attempt: 2 } });
	expect(rt("a").agentStatus).toEqual({ phase: "restarting", attempt: 2 });
});

test("queue_changed replaces the depths, and the rows when the host owns the queue", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	expect(rt("a").queue).toEqual({ steering: 0, followUp: 0, messages: null });

	store.applyChatEvent("a", { type: "queue_changed", steering: 1, followUp: 2 });
	expect(rt("a").queue).toEqual({ steering: 1, followUp: 2, messages: null });

	store.applyChatEvent("a", {
		type: "queue_changed",
		steering: 1,
		followUp: 1,
		queue: { steering: ["course-correct"], followUp: ["queued question"] },
	});
	expect(rt("a").queue.messages).toEqual({
		steering: ["course-correct"],
		followUp: ["queued question"],
	});

	store.applyChatEvent("a", {
		type: "queue_changed",
		steering: 0,
		followUp: 0,
		queue: { steering: [], followUp: [] },
	});
	expect(rt("a").queue).toEqual({
		steering: 0,
		followUp: 0,
		messages: { steering: [], followUp: [] },
	});
});

test("hydrateSession seeds the pending strip from the summary's queue snapshot", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });

	store.hydrateSession(
		summary("q1", "ws1", {}, { queue: { steering: [], followUp: ["waiting in line"] } }),
		hydrated(),
	);
	expect(rt("q1").queue).toEqual({
		steering: 0,
		followUp: 1,
		messages: { steering: [], followUp: ["waiting in line"] },
	});

	store.hydrateSession(summary("q2", "ws1"), hydrated());
	expect(rt("q2").queue).toEqual({ steering: 0, followUp: 0, messages: null });
});

test("session_info renames shared chat metadata without requesting activation", () => {
	const store = useAppStore.getState();
	const cacheId = chatTabId("ws1", "a");
	const placementId = "legacy-chat-placement";
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	useAppStore.setState({
		layoutIntents: [],
		layoutDocumentsByWorkspace: {
			ws1: {
				version: 2,
				center: {
					kind: "group",
					id: "center",
					tabs: [{ kind: "chat", id: placementId, name: "Chat", sessionId: "a" }],
				},
				left: { visible: false, width: 0.2, groups: [] },
				right: { visible: false, width: 0.2, groups: [] },
				bottom: emptyBottomRegion(),
				toolRestoreTargets: {},
			},
		},
	});

	store.applyChatEvent("a", { type: "session_info", title: "Migration plan" });
	const state = useAppStore.getState();
	expect(state.tabsByWorkspace.ws1?.find((tab) => tab.id === cacheId)?.name).toBe("Migration plan");
	expect(state.layoutIntents).toHaveLength(1);
	expect(state.layoutIntents[0]).toMatchObject({
		kind: "open",
		workspaceId: "ws1",
		intent: "keep",
		activate: false,
		tab: { id: placementId, name: "Migration plan", sessionId: "a" },
	});

	const staleDocument = state.layoutDocumentsByWorkspace.ws1;
	if (!staleDocument) throw new Error("missing title layout fixture");
	useAppStore.setState({
		layoutIntents: [],
		layoutDocumentsByWorkspace: {
			ws1: {
				...staleDocument,
				center: {
					kind: "group",
					id: "center",
					tabs: [{ kind: "chat", id: placementId, name: "Stale", sessionId: "a" }],
				},
			},
		},
	});
	store.applyChatEvent("a", { type: "session_info", title: "Migration plan" });
	expect(useAppStore.getState().layoutIntents[0]).toMatchObject({
		kind: "open",
		tab: { id: placementId, name: "Migration plan", sessionId: "a" },
	});

	const cache = useAppStore.getState().tabsByWorkspace.ws1?.find((tab) => tab.id === cacheId);
	if (!cache) throw new Error("missing title cache fixture");
	useAppStore.setState({ layoutIntents: [] });
	store.openTab(cache, "keep", true, { activate: false });
	expect(useAppStore.getState().layoutIntents[0]).toMatchObject({ tab: { id: cacheId } });
	store.applyChatEvent("a", { type: "session_info", title: "Migration plan" });
	expect(useAppStore.getState().layoutIntents[0]).toMatchObject({
		kind: "open",
		tab: { id: placementId, name: "Migration plan", sessionId: "a" },
	});
});

test("session_info cannot restore a cache whose structural close is already accepted", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	useAppStore.setState({
		layoutIntents: [],
		layoutDocumentsByWorkspace: {
			ws1: {
				version: 2,
				center: { kind: "group", id: "center", tabs: [] },
				left: { visible: false, width: 0.2, groups: [] },
				right: { visible: false, width: 0.2, groups: [] },
				bottom: emptyBottomRegion(),
				toolRestoreTargets: {},
			},
		},
	});
	store.applyChatEvent("a", { type: "session_info", title: "Closed title" });
	expect(useAppStore.getState().layoutIntents).toEqual([]);
	expect(useAppStore.getState().tabsByWorkspace.ws1?.[0]?.name).toBe("Closed title");
});

test("session_info repairs the title of a still-live chat in local history", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.closeChatToHistory("a", true, "ws1");
	store.applyChatEvent("a", { type: "session_info", title: "Finished title" });
	expect(useAppStore.getState().closedChatsByWorkspace.ws1?.[0]?.title).toBe("Finished title");
});

test("session_info without a title is a no-op", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	const before = useAppStore.getState();

	store.applyChatEvent("a", { type: "session_info", updatedAt: 42 });
	expect(useAppStore.getState().tabsByWorkspace).toBe(before.tabsByWorkspace);
	expect(useAppStore.getState().sessions).toBe(before.sessions);
});

test("appendNotice surfaces a failed send as a visible notice message", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);

	store.appendNotice("a", "error", "No API key configured for provider openai");

	const message = rt("a").messages[0];
	expect(message?.role === "marker" && message.marker).toEqual({
		kind: "notice",
		level: "error",
		text: "No API key configured for provider openai",
	});
	expect(rt("a").isStreaming).toBe(false);
});

test("an event for an unknown session is a no-op (no runtime is conjured)", () => {
	const before = useAppStore.getState().sessions;
	useAppStore.getState().applyChatEvent("ghost", { type: "turn_start" });
	const after = useAppStore.getState().sessions;
	expect(after).toBe(before);
	expect(after.ghost).toBeUndefined();
});

test("closeChatRuntime drops only its own runtime", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.openChatSession("ws1", "b", EMPTY_RUNTIME.capabilities, []);
	store.applyChatEvent("b", { type: "turn_start" });

	store.closeChatRuntime("a");
	expect(useAppStore.getState().sessions.a).toBeUndefined();
	expect(rt("b").isStreaming).toBe(true);
});

test("applyElicitation queues behind a busy dialog; cancelling the active one promotes the next", () => {
	const store = useAppStore.getState();
	store.applyElicitation({ type: "request", request: elicitationRequest("e1") });
	expect(useAppStore.getState().activeElicitation?.id).toBe("e1");
	expect(useAppStore.getState().elicitationQueue).toEqual([]);

	store.applyElicitation({ type: "request", request: elicitationRequest("e2") });
	expect(useAppStore.getState().activeElicitation?.id).toBe("e1");
	expect(useAppStore.getState().elicitationQueue.map((r) => r.id)).toEqual(["e2"]);

	store.applyElicitation({ type: "cancel", id: "e1" });
	expect(useAppStore.getState().activeElicitation?.id).toBe("e2");
	expect(useAppStore.getState().elicitationQueue).toEqual([]);
});

test("applyElicitation cancel of a queued request just filters it, leaving the active one alone", () => {
	const store = useAppStore.getState();
	store.applyElicitation({ type: "request", request: elicitationRequest("e1") });
	store.applyElicitation({ type: "request", request: elicitationRequest("e2") });
	store.applyElicitation({ type: "request", request: elicitationRequest("e3") });

	store.applyElicitation({ type: "cancel", id: "e2" });
	expect(useAppStore.getState().activeElicitation?.id).toBe("e1");
	expect(useAppStore.getState().elicitationQueue.map((r) => r.id)).toEqual(["e3"]);
});

test("clearActiveElicitation is id-checked, so a stale clear racing a newer dialog is a no-op", () => {
	const store = useAppStore.getState();
	store.applyElicitation({ type: "request", request: elicitationRequest("e1") });
	store.applyElicitation({ type: "request", request: elicitationRequest("e2") });
	store.applyElicitation({ type: "cancel", id: "e1" });
	expect(useAppStore.getState().activeElicitation?.id).toBe("e2");

	store.clearActiveElicitation("e1");
	expect(useAppStore.getState().activeElicitation?.id).toBe("e2");

	store.clearActiveElicitation("e2");
	expect(useAppStore.getState().activeElicitation).toBeNull();
});

test("applyPermission routes a request by session+toolCallId; sibling sessions are untouched", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.openChatSession("ws1", "b", EMPTY_RUNTIME.capabilities, []);

	store.applyPermission({ type: "request", request: permissionRequest("p1", "a", "t1") });
	expect(rt("a").permissions.t1?.id).toBe("p1");
	expect(rt("b").permissions).toEqual({});
});

test("applyPermission cancel carries no sessionId on the wire, so it scans every session for the match", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.openChatSession("ws1", "b", EMPTY_RUNTIME.capabilities, []);
	store.applyPermission({ type: "request", request: permissionRequest("p1", "a", "t1") });
	store.applyPermission({ type: "request", request: permissionRequest("p2", "b", "t2") });

	store.applyPermission({ type: "cancel", id: "p1" });
	expect(rt("a").permissions).toEqual({});
	expect(rt("b").permissions.t2?.id).toBe("p2");
});

test("clearPermission drops one tool call's pending request without touching a sibling", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.applyPermission({ type: "request", request: permissionRequest("p1", "a", "t1") });
	store.applyPermission({ type: "request", request: permissionRequest("p2", "a", "t2") });

	store.clearPermission("a", "t1");
	expect(rt("a").permissions.t1).toBeUndefined();
	expect(rt("a").permissions.t2?.id).toBe("p2");
});

test("noteAgentChanged bumps the tick — a bare, data-free invalidation signal", () => {
	const before = useAppStore.getState().agentChangeTick;
	useAppStore.getState().noteAgentChanged();
	expect(useAppStore.getState().agentChangeTick).toBe(before + 1);
});

test("closing a chat moves it to history with its runtime kept; reopening restores full state", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.applyChatEvent("a", { type: "turn_start" });
	useAppStore.setState({
		chatLocationRequest: {
			workspaceId: "ws1",
			projectId: "p1",
			sessionId: "a",
			messageId: "m0",
			anchorText: "target",
		},
		historyOpenRequest: { id: "history-a", sessionId: "a" },
	});

	store.closeChatToHistory("a");
	let st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "a")).toBe(false);
	expect(st.closedChatsByWorkspace.ws1?.map((c) => c.sessionId)).toEqual(["a"]);
	expect(st.sessions.a).toBeDefined();
	expect(st.sessions.a?.isStreaming).toBe(true);
	expect(st.chatLocationRequest).toBeNull();
	expect(st.historyOpenRequest).toBeNull();

	const activeAfterClose = st.activeTabByWorkspace.ws1;
	const placedId = "legacy:chat:a";
	store.restorePlacedChatCache("ws1", placedId, "a", "Restored chat");
	st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.some((tab) => tab.id === placedId)).toBe(true);
	expect(st.closedChatsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(st.activeTabByWorkspace.ws1).toBe(activeAfterClose);
	store.restorePlacedChatCache("ws1", placedId, "a", "Peer-renamed chat");
	st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.find((tab) => tab.id === placedId)?.name).toBe(
		"Peer-renamed chat",
	);
	store.closeChatToHistory("a");
	expect(useAppStore.getState().closedChatsByWorkspace.ws1?.[0]?.title).toBe("Peer-renamed chat");

	store.reopenChat("ws1", "a");
	st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "a")).toBe(true);
	expect(st.activeTabByWorkspace.ws1).toBe(chatTabId("ws1", "a"));
	expect(st.closedChatsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(st.sessions.a?.isStreaming).toBe(true);
});

test("reopening a chat targets its captured workspace after the user switches away", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "captured", EMPTY_RUNTIME.capabilities, []);
	store.closeChatToHistory("captured");
	useAppStore.setState({ activeWorkspaceId: "ws2" });
	store.reopenChat("ws1", "captured", { activate: false });
	const state = useAppStore.getState();
	expect(
		state.tabsByWorkspace.ws1?.some((tab) => tab.kind === "chat" && tab.sessionId === "captured"),
	).toBe(true);
	expect(state.tabsByWorkspace.ws2).toBeUndefined();
	expect(state.activeWorkspaceId).toBe("ws2");
});

test("deleteChat removes history/runtime state and falls back when deleting the active tab", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.openChatSession("ws1", "b", EMPTY_RUNTIME.capabilities, []);

	store.closeChatToHistory("a");
	store.deleteChat("ws1", "a");
	let st = useAppStore.getState();
	expect(st.closedChatsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(st.sessions.a).toBeUndefined();
	expect(st.skillsSyncedTickBySession.a).toBeUndefined();
	expect(st.sessions.b).toBeDefined();

	store.openChatSession("ws1", "c", EMPTY_RUNTIME.capabilities, []);
	const beforeNav = useAppStore.getState().navTickByWorkspace.ws1 ?? 0;
	store.deleteChat("ws1", "c");
	st = useAppStore.getState();
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "c")).toBe(false);
	expect(st.activeTabByWorkspace.ws1).toBe(chatTabId("ws1", "b"));
	expect(st.navTickByWorkspace.ws1).toBe(beforeNav + 1);
	expect(st.sessions.c).toBeUndefined();
});

test("session-list reconciliation removes missed deletions without deleting a chat created mid-read", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "stale", EMPTY_RUNTIME.capabilities, []);
	const baseline = selectWorkspaceSessionIds(useAppStore.getState(), "ws1");

	store.openChatSession("ws1", "newcomer", EMPTY_RUNTIME.capabilities, []);
	store.reconcileWorkspaceSessions("ws1", baseline, []);

	const state = useAppStore.getState();
	expect(state.sessions.stale).toBeUndefined();
	expect(state.deletedSessionsByWorkspace.ws1?.stale).toBe(true);
	expect(
		state.tabsByWorkspace.ws1?.some((tab) => tab.kind === "chat" && tab.sessionId === "stale"),
	).toBe(false);
	expect(state.sessions.newcomer).toBeDefined();
	expect(state.activeTabByWorkspace.ws1).toBe(chatTabId("ws1", "newcomer"));
});

test("authoritative session reconciliation never impersonates user navigation", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "missing", EMPTY_RUNTIME.capabilities, []);
	const baseline = selectWorkspaceSessionIds(useAppStore.getState(), "ws1");
	const before = useAppStore.getState().navTickByWorkspace.ws1 ?? 0;
	store.reconcileWorkspaceSessions("ws1", baseline, []);
	const state = useAppStore.getState();
	expect(state.activeTabByWorkspace.ws1).toBeNull();
	expect(state.navTickByWorkspace.ws1 ?? 0).toBe(before);
});

test("session deletion drops queued chat and live-plan opens before pruning placement", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "queued", EMPTY_RUNTIME.capabilities, []);
	store.openDoc({
		kind: "plan",
		id: "queued-plan",
		workspaceId: "ws1",
		name: "Queued plan",
		sessionId: "queued",
	});
	store.deleteChat("ws1", "queued", false);
	const afterDeletion = useAppStore.getState();
	const intents = afterDeletion.layoutIntents;
	expect(afterDeletion.tabsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(
		intents.some(
			(intent) =>
				intent.kind === "open" &&
				(intent.tab.kind === "chat" || intent.tab.kind === "plan") &&
				intent.tab.sessionId === "queued",
		),
	).toBe(false);
	expect(intents.at(-1)).toMatchObject({
		kind: "remove-session",
		workspaceId: "ws1",
		sessionId: "queued",
	});
});

test("a deletion that beats session.create prevents its late response from restoring the chat", () => {
	const store = useAppStore.getState();

	store.deleteChat("ws1", "late");
	store.openChatSession("ws1", "late", EMPTY_RUNTIME.capabilities, []);
	store.openTab(
		{
			kind: "chat",
			id: "late-cache",
			workspaceId: "ws1",
			name: "Late cache",
			sessionId: "late",
		},
		"keep",
		false,
	);
	store.openDoc({
		kind: "doc",
		id: "late-todo",
		workspaceId: "ws1",
		name: "Late TODO",
		content: "# Late",
		docPath: "TODO.md",
		sourceId: "late",
	});
	store.requestChatLocation({
		workspaceId: "ws1",
		projectId: "p1",
		sessionId: "late",
		messageId: "m0",
		anchorText: "late",
	});
	store.requestHistoryOpen({ workspaceId: "ws1", sessionId: "late", tabId: "late" });

	const state = useAppStore.getState();
	expect(state.sessions.late).toBeUndefined();
	expect(state.tabsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(
		state.layoutIntents.some((intent) => intent.kind === "open" && intent.workspaceId === "ws1"),
	).toBe(false);
	expect(state.chatLocationRequest).toBeNull();
	expect(state.historyOpenRequest).toBeNull();
});

test("a deletion that beats getMessages prevents its late hydrate from restoring the chat", () => {
	const store = useAppStore.getState();
	store.deleteChat("ws1", "late");
	store.hydrateSession(
		summary("late", "ws1", { title: "Deleted chat", messageCount: 1, updatedAt: 1 }),
		hydrated(),
	);

	const state = useAppStore.getState();
	expect(state.sessions.late).toBeUndefined();
	expect(state.tabsByWorkspace.ws1 ?? []).toHaveLength(0);
});

test("a page-lifetime deletion tombstone survives workspace cleanup until late hydration settles", () => {
	const store = useAppStore.getState();
	store.deleteChat("ws1", "late");
	store.clearWorkspaceTabs("ws1");
	store.hydrateSession(
		summary("late", "ws1", { title: "Deleted chat", messageCount: 1, updatedAt: 1 }),
		hydrated(),
	);

	expect(useAppStore.getState().sessions.late).toBeUndefined();
});

test("a deletion that beats session.list prevents its late history row from returning", () => {
	const store = useAppStore.getState();

	store.deleteChat("ws1", "late");
	store.noteClosedChats("ws1", [{ sessionId: "late", title: "Deleted chat", closedAt: 1 }]);

	expect(useAppStore.getState().closedChatsByWorkspace.ws1 ?? []).toHaveLength(0);
});

test("hydrateSession rebuilds a runtime + tab on connect, and never clobbers a live one", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const summaryFixture = summary("h1", "ws1", { messageCount: 1 });
	store.hydrateSession(summaryFixture, hydrated([userMessage("u1", "hi")]));
	const st = useAppStore.getState();
	expect(st.sessions.h1?.messages).toHaveLength(1);
	expect(st.tabsByWorkspace.ws1?.some((t) => t.kind === "chat" && t.sessionId === "h1")).toBe(true);

	store.hydrateSession(
		{ ...summaryFixture, record: { ...summaryFixture.record, messageCount: 99 } },
		hydrated(),
	);
	expect(useAppStore.getState().sessions.h1?.messages).toHaveLength(1);
});

test("noteClosedChats surfaces disk-only sessions in history, skipping live/open/known ones", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "live1", EMPTY_RUNTIME.capabilities, []);

	store.noteClosedChats("ws1", [
		{ sessionId: "disk1", title: "Old chat", closedAt: 200 },
		{ sessionId: "disk2", title: "Older chat", closedAt: 100 },
		{ sessionId: "live1", title: "dup of open tab", closedAt: 300 },
	]);
	let history = useAppStore.getState().closedChatsByWorkspace.ws1 ?? [];
	expect(history.map((c) => c.sessionId)).toEqual(["disk1", "disk2"]);

	store.noteClosedChats("ws1", [{ sessionId: "disk1", title: "Old chat", closedAt: 200 }]);
	history = useAppStore.getState().closedChatsByWorkspace.ws1 ?? [];
	expect(history).toHaveLength(2);
	store.noteClosedChats("ws1", [{ sessionId: "disk1", title: "Renamed chat", closedAt: 400 }]);
	history = useAppStore.getState().closedChatsByWorkspace.ws1 ?? [];
	expect(history.find((chat) => chat.sessionId === "disk1")).toEqual({
		sessionId: "disk1",
		title: "Renamed chat",
		closedAt: 200,
	});

	store.openChatSession("ws1", "disk1", null, "medium");
	history = useAppStore.getState().closedChatsByWorkspace.ws1 ?? [];
	expect(history.map((chat) => chat.sessionId)).toEqual(["disk2"]);
});

test("opening a chat never steals another resource's canonical cache id", () => {
	const collidingId = chatTabId("ws1", "collision-session");
	const file: FileTab = {
		kind: "file",
		id: collidingId,
		workspaceId: "ws1",
		name: "collision.ts",
		path: "collision.ts",
		content: "kept",
	};
	useAppStore.setState({ tabsByWorkspace: { ws1: [file] }, layoutIntents: [] });
	useAppStore
		.getState()
		.openChatSession("ws1", "collision-session", EMPTY_RUNTIME.capabilities, []);
	const tabs = useAppStore.getState().tabsByWorkspace.ws1 ?? [];
	const openedChat = tabs.find((tab) => tab.kind === "chat");

	expect(tabs.find((tab) => tab.kind === "file")).toEqual(file);
	expect(openedChat?.sessionId).toBe("collision-session");
	expect(openedChat?.id).not.toBe(file.id);
	expect(useAppStore.getState().layoutIntents.at(-1)).toMatchObject({
		kind: "open",
		tab: { id: openedChat?.id, sessionId: "collision-session" },
	});
});

test("restoring a stable chat placement never steals another resource's cache id", () => {
	const file = fileTab("ws1", "stable-placement-id");
	useAppStore.setState({ tabsByWorkspace: { ws1: [file] } });
	useAppStore.getState().restorePlacedChatCache("ws1", file.id, "collision-session", "Chat");
	const tabs = useAppStore.getState().tabsByWorkspace.ws1 ?? [];
	const restoredFile = tabs.find((tab) => tab.kind === "file");
	const restoredChat = tabs.find((tab) => tab.kind === "chat");

	expect(restoredFile).toEqual(file);
	expect(restoredChat?.sessionId).toBe("collision-session");
	expect(restoredChat?.id).not.toBe(file.id);
});

test("hydrateSession preserves the stable id of an already-restored shared placement", () => {
	const store = useAppStore.getState();
	const summaryFixture = summary("legacy-session", "ws1", { title: "Restored" });
	store.restorePlacedChatCache(
		"ws1",
		"legacy-placement-id",
		summaryFixture.record.sessionId,
		summaryFixture.record.title ?? "Chat",
	);
	store.hydrateSession(summaryFixture, hydrated(), false);
	const chats = useAppStore.getState().tabsByWorkspace.ws1?.filter((tab) => tab.kind === "chat");
	expect(chats).toHaveLength(1);
	expect(chats?.[0]?.id).toBe("legacy-placement-id");
});

test("hydrateSession(activate) reopens a disk-only chat: builds it, focuses it, and drops it from history", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "other", EMPTY_RUNTIME.capabilities, []);
	store.noteClosedChats("ws1", [{ sessionId: "disk1", title: "Old", closedAt: 1 }]);

	store.hydrateSession(
		summary("disk1", "ws1", { title: "Old", messageCount: 2 }),
		hydrated(),
		true,
	);

	const st = useAppStore.getState();
	expect(st.sessions.disk1).toBeDefined();
	expect(st.closedChatsByWorkspace.ws1 ?? []).toHaveLength(0);
	expect(st.activeTabByWorkspace.ws1).toBe(chatTabId("ws1", "disk1"));
});

test("clearWorkspaceTabs drops both open and closed chat runtimes + clears history", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	store.openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	store.openChatSession("ws1", "b", EMPTY_RUNTIME.capabilities, []);
	store.closeChatToHistory("a");

	store.clearWorkspaceTabs("ws1");
	const st = useAppStore.getState();
	expect(st.sessions.a).toBeUndefined();
	expect(st.sessions.b).toBeUndefined();
	expect(st.closedChatsByWorkspace.ws1).toBeUndefined();
	expect(st.tabsByWorkspace.ws1).toBeUndefined();
});

test("requestChatLocation sets the jump deep link AND switches project+workspace atomically; clearChatLocation drops it", () => {
	const store = useAppStore.getState();
	useAppStore.setState({ selectedProjectId: "p1", activeWorkspaceId: "ws1" });

	store.requestChatLocation({
		workspaceId: "ws2",
		projectId: "p2",
		sessionId: "s1",
		messageId: "m3",
		anchorText: "deploy the docs",
	});
	let st = useAppStore.getState();
	expect(st.chatLocationRequest).toEqual({
		workspaceId: "ws2",
		projectId: "p2",
		sessionId: "s1",
		messageId: "m3",
		anchorText: "deploy the docs",
	});
	expect(st.activeWorkspaceId).toBe("ws2");
	expect(st.selectedProjectId).toBe("p2");

	store.clearChatLocation();
	st = useAppStore.getState();
	expect(st.chatLocationRequest).toBeNull();
	expect(st.activeWorkspaceId).toBe("ws2");
	expect(st.selectedProjectId).toBe("p2");
});

test("requestChatLocation captures an already-hydrated destination before switching workspaces", () => {
	useAppStore.setState({
		activeWorkspaceId: "ws1",
		layoutAttentionByWorkspace: {
			ws2: {
				selectedByGroup: { destination: "chat" },
				lastFocusedCenterGroupId: "destination",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { destination: 4 },
			},
		},
	});
	useAppStore.getState().requestChatLocation({
		workspaceId: "ws2",
		projectId: "p2",
		sessionId: "session",
		messageId: "m1",
		anchorText: "target",
	});
	expect(useAppStore.getState().chatLocationRequest?.navigation).toEqual({
		groupId: "destination",
		clock: 5,
	});
	expect(
		useAppStore.getState().layoutAttentionByWorkspace.ws2?.navigationClockByGroup.destination,
	).toBe(5);
});

function project(over: Partial<Project> = {}): Project {
	return {
		id: "p1",
		name: "Project one",
		path: "/projects/one",
		slug: "project-one",
		lastOpened: 100,
		...over,
	};
}

test("installProjectSnapshot sorts both projections and repairs navigation after an off-screen close", () => {
	const p1 = project();
	const p2 = project({
		id: "p2",
		name: "Project two",
		path: "/projects/two",
		slug: "project-two",
		lastOpened: 200,
		closed: true,
	});
	const workspace = pushedWorkspace({ id: "w2", projectId: "p2" });
	const tabs = {
		w2: [{ kind: "file", id: "w2:a", workspaceId: "w2", name: "a", path: "a", content: "" }],
	} satisfies Record<string, FileTab[]>;
	useAppStore.setState({
		projects: [p2],
		recentProjects: [p2],
		workspaces: { p2: [workspace] },
		selectedProjectId: "p2",
		activeWorkspaceId: "w2",
		tabsByWorkspace: tabs,
	});

	useAppStore.getState().installProjectSnapshot([p1], [p1, p2]);

	const state = useAppStore.getState();
	expect(state.projects.map((candidate) => candidate.id)).toEqual(["p1"]);
	expect(state.recentProjects.map((candidate) => candidate.id)).toEqual(["p2", "p1"]);
	expect(state.selectedProjectId).toBe("p1");
	expect(state.activeWorkspaceId).toBeNull();
	expect(state.workspaces.p2).toEqual([workspace]);
	expect(state.tabsByWorkspace).toBe(tabs);
});

test("projects-rail expansion: gestures reveal, restore stays neutral, the chevron toggles", () => {
	const p1 = project();
	const p2 = project({ id: "p2", name: "Project two", path: "/projects/two", slug: "project-two" });
	useAppStore.setState({ projects: [p1, p2], recentProjects: [p1, p2] });
	const store = useAppStore.getState();

	store.selectProject("p1");
	expect(useAppStore.getState().expandedProjectIds).toEqual({});
	store.selectProject("p1", { reveal: true });
	expect(useAppStore.getState().expandedProjectIds).toEqual({ p1: true });
	const before = useAppStore.getState().expandedProjectIds;
	store.expandProject("p1");
	expect(useAppStore.getState().expandedProjectIds).toBe(before);
	store.toggleProjectExpanded("p1");
	expect(useAppStore.getState().expandedProjectIds).toEqual({});
	store.toggleProjectExpanded("p2");
	expect(useAppStore.getState().expandedProjectIds).toEqual({ p2: true });
	useAppStore.getState().applyProjectUpdated({ ...p2, closed: true });
	expect(useAppStore.getState().expandedProjectIds).toEqual({});
});

test("hydrateExpandedProjects seeds the persisted mirror; the welcome snapshot prunes to the open rail", () => {
	const p1 = project();
	useAppStore.getState().hydrateExpandedProjects(["p1", "stale-closed-project"]);
	expect(useAppStore.getState().expandedProjectIds).toEqual({
		p1: true,
		"stale-closed-project": true,
	});
	useAppStore.getState().installWelcomeSnapshot(1, [p1], [p1]);
	expect(useAppStore.getState().expandedProjectIds).toEqual({ p1: true });
});

test("applyProjectUpdated closes a background project without moving the current workspace", () => {
	const p1 = project();
	const p2 = project({
		id: "p2",
		name: "Project two",
		path: "/projects/two",
		slug: "project-two",
		lastOpened: 50,
	});
	useAppStore.setState({
		projects: [p1, p2],
		recentProjects: [p1, p2],
		workspaces: { p1: [pushedWorkspace()] },
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
	});

	useAppStore.getState().applyProjectUpdated({ ...p2, closed: true });

	const state = useAppStore.getState();
	expect(state.projects.map((candidate) => candidate.id)).toEqual(["p1"]);
	expect(state.recentProjects.find((candidate) => candidate.id === "p2")?.closed).toBe(true);
	expect(state.selectedProjectId).toBe("p1");
	expect(state.activeWorkspaceId).toBe("w1");
});

test("applyProjectUpdated closes the current project to the next Home and preserves its view maps", () => {
	const p1 = project();
	const p2 = project({
		id: "p2",
		name: "Project two",
		path: "/projects/two",
		slug: "project-two",
		lastOpened: 50,
	});
	const workspace = pushedWorkspace();
	const tabs = {
		w1: [{ kind: "file", id: "w1:a", workspaceId: "w1", name: "a", path: "a", content: "" }],
	} satisfies Record<string, FileTab[]>;
	useAppStore.setState({
		projects: [p1, p2],
		recentProjects: [p1, p2],
		workspaces: { p1: [workspace] },
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
		tabsByWorkspace: tabs,
	});

	useAppStore.getState().applyProjectUpdated({ ...p1, closed: true });

	const state = useAppStore.getState();
	expect(state.projects.map((candidate) => candidate.id)).toEqual(["p2"]);
	expect(state.selectedProjectId).toBe("p2");
	expect(state.activeWorkspaceId).toBeNull();
	expect(state.workspaces.p1).toEqual([workspace]);
	expect(state.tabsByWorkspace).toBe(tabs);
});

test("applyProjectUpdated reopens and reorders the same project without duplicating it", () => {
	const p1 = project();
	const closed = project({
		id: "p2",
		name: "Project two",
		path: "/projects/two",
		slug: "project-two",
		lastOpened: 50,
		closed: true,
	});
	useAppStore.setState({ projects: [p1], recentProjects: [p1, closed] });
	const { closed: _closed, ...reopened } = closed;

	useAppStore.getState().applyProjectUpdated({ ...reopened, lastOpened: 200 });

	const state = useAppStore.getState();
	expect(state.projects.map((candidate) => candidate.id)).toEqual(["p2", "p1"]);
	expect(state.recentProjects.map((candidate) => candidate.id)).toEqual(["p2", "p1"]);
	expect(state.projects.filter((candidate) => candidate.id === "p2")).toHaveLength(1);
	expect(state.recentProjects[0]?.closed).toBeUndefined();
});

test("applyProjectUpdated closes the last project to the no-project state", () => {
	const p1 = project();
	useAppStore.setState({
		projects: [p1],
		recentProjects: [p1],
		selectedProjectId: "p1",
		activeWorkspaceId: null,
	});

	useAppStore.getState().applyProjectUpdated({ ...p1, closed: true });

	const state = useAppStore.getState();
	expect(state.projects).toEqual([]);
	expect(state.selectedProjectId).toBeNull();
	expect(state.activeWorkspaceId).toBeNull();
});

function pushedWorkspace(over: Partial<Workspace> = {}): Workspace {
	return {
		id: "w1",
		projectId: "p1",
		name: "add-login-flow",
		branch: "add-login-flow",
		worktreePath: "/tmp/worktrees/p/workspace-1",
		baseBranch: "main",
		renamed: true,
		...over,
	};
}

test("project and workspace navigation update both scope ids atomically", () => {
	useAppStore.setState({ selectedProjectId: "p1", activeWorkspaceId: "w1" });
	const transitions: [string | null, string | null][] = [];
	const unsubscribe = useAppStore.subscribe((state) => {
		transitions.push([state.selectedProjectId, state.activeWorkspaceId]);
	});

	useAppStore.getState().selectProject("p2");
	expect(transitions).toEqual([["p2", null]]);

	transitions.length = 0;
	useAppStore.getState().activateWorkspace(pushedWorkspace({ id: "w3", projectId: "p3" }));
	expect(transitions).toEqual([["p3", "w3"]]);
	unsubscribe();
});

test("workspace selection history tracks ordinary, route, and history-search activation", () => {
	const w1 = pushedWorkspace();
	const w2 = pushedWorkspace({ id: "w2", projectId: "p2" });
	useAppStore.setState({
		projects: [project(), project({ id: "p2" })],
		workspaces: { p1: [w1], p2: [w2] },
	});

	useAppStore.getState().activateWorkspace(w1);
	useAppStore.getState().activateWorkspace(w2);
	expect(useAppStore.getState().workspaceSelectionHistory).toEqual(["w2", "w1"]);

	useAppStore.getState().activateWorkspaceFromRoute(w1);
	expect(useAppStore.getState().workspaceSelectionHistory).toEqual(["w1", "w2"]);

	useAppStore.getState().requestChatLocation({
		workspaceId: "w2",
		projectId: "p2",
		sessionId: "session",
		messageIndex: 0,
		anchorText: "target",
	});
	expect(useAppStore.getState().workspaceSelectionHistory).toEqual(["w2", "w1"]);

	useAppStore.getState().selectProject("p1");
	expect(useAppStore.getState().workspaceSelectionHistory).toEqual(["w2", "w1"]);
});

test("installWelcomeSnapshot lands one complete snapshot and advances its own generation", () => {
	const p1 = project();
	const closed = project({
		id: "p2",
		path: "/projects/two",
		slug: "two",
		lastOpened: 50,
		closed: true,
	});
	let notifications = 0;
	const unsubscribe = useAppStore.subscribe((state) => {
		notifications += 1;
		expect(state).toMatchObject({
			protocolVersion: 44,
			theme: "test-theme",
			welcomeGeneration: 1,
		});
		expect(state.projects.map((candidate) => candidate.id)).toEqual(["p1"]);
		expect(state.recentProjects.map((candidate) => candidate.id)).toEqual(["p1", "p2"]);
	});

	useAppStore.getState().installWelcomeSnapshot(44, [p1, closed], [p1, closed], null, null, {
		theme: "test-theme",
		analyticsEnabled: false,
		terminalReplayKb: 256,
	});
	unsubscribe();
	expect(notifications).toBe(1);

	useAppStore.getState().installWelcomeSnapshot(44, [p1], [p1], null, null);
	expect(useAppStore.getState().welcomeGeneration).toBe(2);
});

test("installWelcomeSnapshot reconciles stale project navigation", () => {
	const p1 = project();
	useAppStore.setState({
		projects: [project({ id: "p2", path: "/projects/two", slug: "two" })],
		selectedProjectId: "p2",
		activeWorkspaceId: null,
	});

	useAppStore.getState().installWelcomeSnapshot(44, [p1], [p1], null, null);
	expect(useAppStore.getState().selectedProjectId).toBe("p1");
});

test("activateWorkspaceFromRoute atomically stamps exact-chat intent", () => {
	const workspace = pushedWorkspace();
	useAppStore.setState({ workspaces: { p1: [workspace] }, navTickByWorkspace: { w1: 3 } });

	useAppStore.getState().activateWorkspaceFromRoute(workspace, "s1");
	expect(useAppStore.getState()).toMatchObject({
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
		routeChatTarget: {
			workspaceId: "w1",
			sessionId: "s1",
			navTick: 4,
			navigation: null,
			validated: false,
		},
		routeChatTargetGeneration: 1,
	});

	useAppStore.getState().activateWorkspaceFromRoute(workspace);
	expect(useAppStore.getState().routeChatTarget).toBeNull();
	expect(selectWorkspaceNavTick(useAppStore.getState(), "w1")).toBe(5);
	expect(useAppStore.getState().routeChatTargetGeneration).toBe(1);
	const before = useAppStore.getState();
	useAppStore.getState().clearRouteChatTarget();
	expect(useAppStore.getState()).toBe(before);
});

test("closeChatToHistory keeps a route target for the closed session", () => {
	const workspace = pushedWorkspace();
	useAppStore.setState({ workspaces: { p1: [workspace] } });
	useAppStore.getState().openChatSession("w1", "s1", null, "medium");
	useAppStore.getState().activateWorkspaceFromRoute(workspace, "s1");
	const target = useAppStore.getState().routeChatTarget;
	expect(target?.sessionId).toBe("s1");

	useAppStore.getState().closeChatToHistory("s1", false, "w1", false);
	expect(useAppStore.getState().closedChatsByWorkspace.w1?.[0]?.sessionId).toBe("s1");
	expect(useAppStore.getState().routeChatTarget).toBe(target);
});

test("selectCurrentRouteChatTarget rejects overtaken or off-workspace intent", () => {
	const workspace = pushedWorkspace();
	useAppStore.setState({ workspaces: { p1: [workspace] } });
	useAppStore.getState().activateWorkspaceFromRoute(workspace, "s1");
	expect(selectCurrentRouteChatTarget(useAppStore.getState())?.sessionId).toBe("s1");

	useAppStore.getState().noteNavigation("w1");
	expect(selectCurrentRouteChatTarget(useAppStore.getState())).toBeNull();

	useAppStore.getState().activateWorkspaceFromRoute(workspace, "s1");
	useAppStore.getState().selectProject("p1");
	expect(selectCurrentRouteChatTarget(useAppStore.getState())).toBeNull();
});

test("updateWorkspace applies a pushed snapshot authoritatively: dropped fields clear", () => {
	useAppStore.setState({
		workspaces: {
			p1: [
				{
					...pushedWorkspace(),
					diffBase: "release",
					skillOverrides: { "spec-graph": "off" },
					diffStats: { added: 3, removed: 1 },
				},
			],
		},
	});
	useAppStore.getState().updateWorkspace(pushedWorkspace());

	const ws = useAppStore.getState().workspaces.p1?.[0];
	expect(ws?.diffBase).toBeUndefined();
	expect(ws?.skillOverrides).toBeUndefined();
	expect(ws?.diffStats).toEqual({ added: 3, removed: 1 });
});

test("updateWorkspace applies the pushed snapshot by id, keeping the computed diffStats aggregate", () => {
	useAppStore.setState({
		workspaces: {
			p1: [
				{
					...pushedWorkspace({ name: "workspace-1", branch: "workspace-1" }),
					renamed: undefined,
					diffStats: { added: 3, removed: 1 },
				},
			],
		},
	});
	useAppStore.getState().updateWorkspace(pushedWorkspace());

	const ws = useAppStore.getState().workspaces.p1?.[0];
	expect(ws?.name).toBe("add-login-flow");
	expect(ws?.renamed).toBe(true);
	expect(ws?.diffStats).toEqual({ added: 3, removed: 1 });
});

test("updateWorkspace is a no-op for a project whose list was never fetched", () => {
	useAppStore.setState({ workspaces: {} });
	useAppStore.getState().updateWorkspace(pushedWorkspace());
	expect(useAppStore.getState().workspaces).toEqual({});
});

test("updateWorkspace never appends an unknown id to a fetched list", () => {
	const existing = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({ workspaces: { p1: [existing] } });
	useAppStore.getState().updateWorkspace(pushedWorkspace());

	const list = useAppStore.getState().workspaces.p1;
	expect(list).toHaveLength(1);
	expect(list?.[0]?.id).toBe("other");
});

test("removeWorkspace optimistically drops the row, leaving siblings; unknown project/id is a no-op", () => {
	const keep = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({ workspaces: { p1: [pushedWorkspace(), keep] } });

	useAppStore.getState().removeWorkspace("p1", "w1");
	expect(useAppStore.getState().workspaces.p1?.map((w) => w.id)).toEqual(["other"]);

	useAppStore.getState().removeWorkspace("p1", "missing");
	expect(useAppStore.getState().workspaces.p1).toHaveLength(1);
	useAppStore.getState().removeWorkspace("p2", "w1");
	expect(useAppStore.getState().workspaces.p2).toBeUndefined();
});

test("addWorkspace upserts into a fetched list (append if absent, merge if present)", () => {
	const other = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({ workspaces: { p1: [other] } });

	useAppStore.getState().addWorkspace(pushedWorkspace());
	expect(useAppStore.getState().workspaces.p1?.map((w) => w.id)).toEqual(["other", "w1"]);

	useAppStore.getState().addWorkspace(pushedWorkspace({ name: "renamed-later" }));
	const list = useAppStore.getState().workspaces.p1;
	expect(list).toHaveLength(2);
	expect(list?.find((w) => w.id === "w1")?.name).toBe("renamed-later");
});

test("addWorkspace is a no-op for a project whose list was never fetched", () => {
	useAppStore.setState({ workspaces: {} });
	useAppStore.getState().addWorkspace(pushedWorkspace());
	expect(useAppStore.getState().workspaces).toEqual({});
});

test("applyWorkspaceRemoved restores the most-recent workspace across projects", () => {
	const removed = pushedWorkspace();
	const previous = pushedWorkspace({ id: "w2", projectId: "p2", name: "previous" });
	useAppStore.setState({
		projects: [project(), project({ id: "p2" })],
		workspaces: { p1: [removed], p2: [previous] },
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
		workspaceSelectionHistory: ["w1", "w2"],
		toasts: [],
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");

	const state = useAppStore.getState();
	expect(state.activeWorkspaceId).toBe("w2");
	expect(state.selectedProjectId).toBe("p2");
	expect(state.workspaceSelectionHistory).toEqual(["w2"]);
	expect(state.toasts).toHaveLength(1);
});

test("applyWorkspaceRemoved skips missing, tombstoned, and closed-project history entries", () => {
	const removed = pushedWorkspace();
	const tombstoned = pushedWorkspace({ id: "tombstoned", projectId: "p3" });
	const closed = pushedWorkspace({ id: "closed", projectId: "p2" });
	const valid = pushedWorkspace({ id: "valid", projectId: "p3" });
	useAppStore.setState({
		projects: [project(), project({ id: "p3" })],
		workspaces: { p1: [removed], p2: [closed], p3: [tombstoned, valid] },
		removedWorkspaceIds: { tombstoned: true },
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
		workspaceSelectionHistory: ["w1", "missing", "tombstoned", "closed", "valid"],
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");

	expect(useAppStore.getState().activeWorkspaceId).toBe("valid");
	expect(useAppStore.getState().selectedProjectId).toBe("p3");
});

test("applyWorkspaceRemoved drops the row, clears its tabs, and returns the active client to Welcome + toast when history is empty", () => {
	useAppStore.setState({
		workspaces: { p1: [pushedWorkspace()] },
		selectedProjectId: "stale-project",
		activeWorkspaceId: "w1",
		tabsByWorkspace: {
			w1: [{ kind: "file", id: "w1:a", workspaceId: "w1", name: "a", path: "a", content: "" }],
		},
		activeTabByWorkspace: { w1: "w1:a" },
		terminalsByWorkspace: {
			w1: [{ tabKey: "terminal-before-removal", workspaceId: "w1", title: "Terminal" }],
		},
		changesRequest: { workspaceId: "w1", path: "a", navTick: 0, navigation: null },
		specRequest: { workspaceId: "w1", path: "SPEC.md", navigation: null },
		chatLocationRequest: {
			workspaceId: "w1",
			projectId: "p1",
			sessionId: "removed-chat",
			messageId: "m0",
			anchorText: "removed",
		},
		historyOpenRequest: { id: "history", sessionId: "removed-chat" },
		reviewFocusRequest: { workspaceId: "w1", commentId: "comment" },
		closedChatsByWorkspace: {
			w1: [{ sessionId: "removed-chat", title: "Removed", closedAt: 1 }],
		},
		toasts: [],
	});
	let cleanupSubscriberAttempted = false;
	const unsubscribe = useAppStore.subscribe((state, previous) => {
		if (
			cleanupSubscriberAttempted ||
			!previous.terminalsByWorkspace.w1 ||
			state.terminalsByWorkspace.w1
		) {
			return;
		}
		cleanupSubscriberAttempted = true;
		state.setWorkspaceTerminals("w1", [{ tabKey: "late-terminal", title: "Late terminal" }]);
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");
	unsubscribe();

	const s = useAppStore.getState();
	expect(cleanupSubscriberAttempted).toBe(true);
	expect(s.workspaces.p1).toEqual([]);
	expect(s.tabsByWorkspace.w1).toBeUndefined();
	expect(s.activeWorkspaceId).toBeNull();
	expect(s.selectedProjectId).toBe("p1");
	expect(s.toasts).toHaveLength(1);
	expect(s.toasts[0]?.message).toContain("add-login-flow");
	expect(s.changesRequest).toBeNull();
	expect(s.specRequest).toBeNull();
	expect(s.chatLocationRequest).toBeNull();
	expect(s.historyOpenRequest).toBeNull();
	expect(s.reviewFocusRequest).toBeNull();

	s.setLayoutAttention("w1", {
		selectedByGroup: {},
		lastFocusedCenterGroupId: "center",
		lastFocusedSideGroupId: {},
		navigationClockByGroup: { center: 0 },
	});
	s.openTab({
		kind: "file",
		id: "late-file",
		workspaceId: "w1",
		name: "late",
		path: "late",
		content: "",
	});
	s.setWorkspaceTerminals("w1", [{ tabKey: "late-terminal", title: "Late terminal" }]);
	s.closeTerminalTab("w1", "late-terminal");
	s.setWorkspaceSpecs("w1", []);
	s.noteFsChanged({ workspaceId: "w1", paths: ["late"], truncated: false, skillChange: "none" });
	s.requestToolView("w1", "files");
	s.reconcileWorkspaceSessions("w1", ["removed-chat"], []);
	s.noteClosedChats("w1", [{ sessionId: "late-chat", title: "Late", closedAt: 2 }]);
	s.requestChatLocation({
		workspaceId: "w1",
		projectId: "p1",
		sessionId: "late-chat",
		messageId: "m0",
		anchorText: "late",
	});
	s.activateWorkspace(pushedWorkspace());
	s.setWorkspaces("p1", [pushedWorkspace()]);
	const afterLateArrivals = useAppStore.getState();
	expect(afterLateArrivals.layoutDocumentsByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.layoutAttentionByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.layoutIntents).toEqual([]);
	expect(afterLateArrivals.tabsByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.closedChatsByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.terminalsByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.specsByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.fsChangesByWorkspace.w1).toBeUndefined();
	expect(afterLateArrivals.chatLocationRequest).toBeNull();
	expect(afterLateArrivals.activeWorkspaceId).toBeNull();
	expect(afterLateArrivals.workspaces.p1).toEqual([]);
});

test("applyWorkspaceRemoved on a non-active workspace drops the row silently (no toast, active untouched)", () => {
	const keep = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({
		workspaces: { p1: [pushedWorkspace(), keep] },
		activeWorkspaceId: "other",
		workspaceSelectionHistory: ["other", "w1"],
		toasts: [],
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");

	const s = useAppStore.getState();
	expect(s.workspaces.p1?.map((w) => w.id)).toEqual(["other"]);
	expect(s.activeWorkspaceId).toBe("other");
	expect(s.workspaceSelectionHistory).toEqual(["other"]);
	expect(s.toasts).toHaveLength(0);
});

test("applyWorkspaceRemoved drops the removed workspace's cached spec graph", () => {
	const keep = pushedWorkspace({ id: "other", name: "workspace-2", branch: "workspace-2" });
	useAppStore.setState({
		workspaces: { p1: [pushedWorkspace(), keep] },
		activeWorkspaceId: "other",
		specsByWorkspace: { w1: [], other: [] },
		toasts: [],
	});

	useAppStore.getState().applyWorkspaceRemoved("p1", "w1");

	const s = useAppStore.getState();
	expect(s.specsByWorkspace.w1).toBeUndefined();
	expect(s.specsByWorkspace.other).toEqual([]);
});

test("requestChangesView / requestSpecView pair independent path requests with reveal intents", () => {
	useAppStore.setState({ changesRequest: null, specRequest: null, layoutIntents: [] });

	useAppStore.getState().requestChangesView("w1", "src/a.ts");
	useAppStore.getState().requestSpecView("w1", ".thinkrail/context/TASK-x.md");

	const s = useAppStore.getState();
	expect(s.changesRequest).toEqual({
		workspaceId: "w1",
		path: "src/a.ts",
		navTick: 1,
		navigation: null,
	});
	expect(s.specRequest).toEqual({
		workspaceId: "w1",
		path: ".thinkrail/context/TASK-x.md",
		navigation: null,
	});
	expect(
		s.layoutIntents.map(({ kind, workspaceId, ...intent }) => ({ kind, workspaceId, ...intent })),
	).toMatchObject([
		{ kind: "reveal-tool", workspaceId: "w1", tool: "changes" },
		{ kind: "reveal-tool", workspaceId: "w1", tool: "specs" },
	]);

	const first = useAppStore.getState().specRequest;
	useAppStore.getState().requestSpecView("w1", ".thinkrail/context/TASK-x.md");
	expect(useAppStore.getState().specRequest).not.toBe(first);
	expect(useAppStore.getState().specRequest).toEqual(first);
});

test("requestToolView reveals a tool without fabricating a path request", () => {
	useAppStore.setState({ layoutIntents: [], changesRequest: null, specRequest: null });

	useAppStore.getState().requestToolView("w1", "specs");

	const first = useAppStore.getState().layoutIntents[0];
	expect(first).toMatchObject({ kind: "reveal-tool", workspaceId: "w1", tool: "specs" });
	expect(useAppStore.getState().specRequest).toBeNull();
	expect(useAppStore.getState().changesRequest).toBeNull();

	useAppStore.getState().requestToolView("w1", "specs");
	const second = useAppStore.getState().layoutIntents[1];
	expect(second).toMatchObject({ kind: "reveal-tool", workspaceId: "w1", tool: "specs" });
	expect(second?.id).not.toBe(first?.id);
});

test("clearSpecRequest consumes the spec intent once — it opens a tab, so it must not replay", () => {
	useAppStore.setState({ specRequest: null, changesRequest: null });
	useAppStore.getState().requestSpecView("w1", "docs/SPEC.md");

	useAppStore.getState().clearSpecRequest();

	expect(useAppStore.getState().specRequest).toBeNull();
	useAppStore.getState().clearSpecRequest();
	expect(useAppStore.getState().specRequest).toBeNull();
	useAppStore.getState().requestChangesView("w1", "src/a.ts");
	useAppStore.getState().clearSpecRequest();
	expect(useAppStore.getState().changesRequest).toEqual({
		workspaceId: "w1",
		path: "src/a.ts",
		navTick: 2,
		navigation: null,
	});
});

test("the Changes deep link stamps the nav count at the click, so a later navigation still wins", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1", changesRequest: null, layoutIntents: [] });
	const s = () => useAppStore.getState();

	s().openTab(fileTab("ws1", "a.ts"), "keep");
	s().setActiveTab("ws1:a.ts");
	const beforeClick = selectWorkspaceNavTick(s(), "ws1");

	s().requestChangesView("ws1", "src/b.ts");
	expect(s().changesRequest?.navTick).toBe(beforeClick + 1);

	expect(selectWorkspaceNavTick(s(), "ws1")).toBe(s().changesRequest?.navTick);

	s().setActiveTab("ws1:a.ts");
	expect(selectWorkspaceNavTick(s(), "ws1")).not.toBe(s().changesRequest?.navTick);
});

test("legacy selection reconciliation does not count as user navigation", () => {
	useAppStore.setState({
		tabsByWorkspace: { ws1: [fileTab("ws1", "a.ts"), fileTab("ws1", "b.ts")] },
		activeTabByWorkspace: { ws1: "ws1:a.ts" },
		navTickByWorkspace: { ws1: 7 },
	});
	useAppStore.getState().syncLegacySelection("ws1", { kind: "editor", tabId: "ws1:b.ts" });
	expect(useAppStore.getState().activeTabByWorkspace.ws1).toBe("ws1:b.ts");
	expect(useAppStore.getState().activeTerminalByWorkspace.ws1).toBeNull();
	expect(useAppStore.getState().navTickByWorkspace.ws1).toBe(7);

	useAppStore.setState({
		terminalsByWorkspace: {
			ws1: [{ tabKey: "terminal", workspaceId: "ws1", title: "Terminal" }],
		},
	});
	useAppStore.getState().syncLegacySelection("ws1", {
		kind: "terminal",
		tabKey: "terminal",
	});
	expect(useAppStore.getState().activeTabByWorkspace.ws1).toBeNull();
	expect(useAppStore.getState().activeTerminalByWorkspace.ws1).toBe("terminal");
	useAppStore.getState().syncLegacySelection("ws1", null);
	expect(useAppStore.getState().activeTabByWorkspace.ws1).toBeNull();
	expect(useAppStore.getState().activeTerminalByWorkspace.ws1).toBeNull();
	expect(useAppStore.getState().navTickByWorkspace.ws1).toBe(7);
});

test("deferred center navigation clocks are isolated by destination group", () => {
	useAppStore.setState({
		activeWorkspaceId: "ws1",
		layoutAttentionByWorkspace: {
			ws1: {
				selectedByGroup: { a: "file-a", b: "file-b" },
				lastFocusedCenterGroupId: "a",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { a: 4, b: 9 },
			},
		},
	});

	const passive = captureCenterNavigation(useAppStore.getState(), "ws1");
	expect(passive).toEqual({ groupId: "a", clock: 4 });
	const fromA = useAppStore.getState().beginCenterNavigation("ws1");
	expect(fromA).toEqual({ groupId: "a", clock: 5 });
	expect(isCenterNavigationCurrent(useAppStore.getState(), "ws1", fromA)).toBe(true);
	useAppStore.setState({ activeWorkspaceId: "ws2" });
	expect(layoutOpenOptionsForNavigation(useAppStore.getState(), "ws1", fromA)).toEqual({
		targetGroupId: "a",
		activate: false,
		navigation: fromA,
	});
	useAppStore.setState({ activeWorkspaceId: "ws1" });

	useAppStore.getState().beginCenterNavigation("ws1", "b");
	expect(isCenterNavigationCurrent(useAppStore.getState(), "ws1", fromA)).toBe(true);
	expect(layoutOpenOptionsForNavigation(useAppStore.getState(), "ws1", fromA)).toEqual({
		targetGroupId: "a",
		activate: false,
		navigation: fromA,
	});
	const withOtherGroupFocused = useAppStore.getState().layoutAttentionByWorkspace.ws1;
	if (!withOtherGroupFocused) throw new Error("missing attention fixture");
	expect(shouldAdvanceAcceptedNavigation(withOtherGroupFocused, fromA)).toBe(false);

	useAppStore.getState().beginCenterNavigation("ws1", "a");
	expect(isCenterNavigationCurrent(useAppStore.getState(), "ws1", fromA)).toBe(false);

	const withoutA = useAppStore.getState().layoutAttentionByWorkspace.ws1;
	if (!withoutA) throw new Error("missing attention fixture");
	const onlyB = {
		...withoutA,
		navigationClockByGroup: { b: withoutA.navigationClockByGroup.b ?? 0 },
	};
	useAppStore.setState({ layoutAttentionByWorkspace: { ws1: onlyB } });
	expect(layoutOpenOptionsForNavigation(useAppStore.getState(), "ws1", fromA)).toEqual({
		targetGroupId: "a",
		navigation: fromA,
	});
	expect(shouldAdvanceAcceptedNavigation(onlyB, fromA)).toBe(true);
	const rerouted = useAppStore.getState().beginCenterNavigation("ws1", "removed-group");
	expect(rerouted?.groupId).toBe("b");
	expect(
		Object.hasOwn(
			useAppStore.getState().layoutAttentionByWorkspace.ws1?.navigationClockByGroup ?? {},
			"removed-group",
		),
	).toBe(false);
});

test("a request-time center navigation is not counted again when its chat cache lands", () => {
	useAppStore.setState({
		activeWorkspaceId: "ws1",
		layoutAttentionByWorkspace: {
			ws1: {
				selectedByGroup: {},
				lastFocusedCenterGroupId: "center",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { center: 3 },
			},
		},
		navTickByWorkspace: { ws1: 7 },
	});
	const navigation = useAppStore.getState().beginCenterNavigation("ws1");
	const afterRequest = useAppStore.getState().navTickByWorkspace.ws1;
	useAppStore
		.getState()
		.openChatSession(
			"ws1",
			"session-requested",
			EMPTY_RUNTIME.capabilities,
			[],
			undefined,
			layoutOpenOptionsForNavigation(useAppStore.getState(), "ws1", navigation),
		);

	expect(useAppStore.getState().navTickByWorkspace.ws1).toBe(afterRequest);
	expect(useAppStore.getState().layoutIntents.at(-1)).toMatchObject({
		kind: "open",
		navigation,
	});
});

test("clearChangesRequest consumes the Changes intent once — it opens a diff tab, so it must not replay", () => {
	useAppStore.setState({ specRequest: null, changesRequest: null });
	useAppStore.getState().requestChangesView("w1", "src/a.ts");

	useAppStore.getState().clearChangesRequest();

	expect(useAppStore.getState().changesRequest).toBeNull();
	useAppStore.getState().requestSpecView("w1", "docs/SPEC.md");
	useAppStore.getState().clearChangesRequest();
	expect(useAppStore.getState().changesRequest).toBeNull();
	expect(useAppStore.getState().specRequest).toEqual({
		workspaceId: "w1",
		path: "docs/SPEC.md",
		navigation: null,
	});
});

const specNode = (over: Partial<SpecGraphNode> = {}): SpecGraphNode => ({
	id: "task-x",
	type: "task-spec",
	title: "X",
	path: ".thinkrail/context/TASK-x.md",
	dependsOn: [],
	references: [],
	implements: [],
	tags: [],
	...over,
});

test("setWorkspaceSpecs records a snapshot per workspace without touching its siblings", () => {
	const node = specNode();
	useAppStore.setState({ specsByWorkspace: { other: [] } });

	useAppStore.getState().setWorkspaceSpecs("w1", [node]);

	const s = useAppStore.getState();
	expect(s.specsByWorkspace.w1).toEqual([node]);
	expect(s.specsByWorkspace.other).toEqual([]);
});

test("setWorkspaceSpecs keeps the previous array identity when the re-read found no change", () => {
	useAppStore.setState({ specsByWorkspace: {} });
	useAppStore.getState().setWorkspaceSpecs("w1", [specNode()]);
	const first = useAppStore.getState().specsByWorkspace.w1;

	useAppStore.getState().setWorkspaceSpecs("w1", [specNode()]);
	expect(useAppStore.getState().specsByWorkspace.w1).toBe(first);

	useAppStore.getState().setWorkspaceSpecs("w1", [specNode({ status: "active" })]);
	expect(useAppStore.getState().specsByWorkspace.w1).not.toBe(first);

	const withStatus = useAppStore.getState().specsByWorkspace.w1;
	useAppStore.getState().setWorkspaceSpecs("w1", [specNode({ status: "active", tags: ["v1"] })]);
	expect(useAppStore.getState().specsByWorkspace.w1).not.toBe(withStatus);

	useAppStore.getState().setWorkspaceSpecs("w1", []);
	expect(useAppStore.getState().specsByWorkspace.w1).toEqual([]);
});

test("openSettings deep-links to a section (default agents); closeSettings hides it", () => {
	const s = useAppStore.getState();
	s.openSettings();
	expect(useAppStore.getState().settingsOpen).toBe(true);
	expect(useAppStore.getState().settingsSection).toBe("agents");

	s.openSettings("github");
	expect(useAppStore.getState().settingsSection).toBe("github");

	s.setSettingsSection("agents");
	expect(useAppStore.getState().settingsSection).toBe("agents");

	s.closeSettings();
	expect(useAppStore.getState().settingsOpen).toBe(false);
	expect(useAppStore.getState().settingsSection).toBe("agents");
});

test("pushToast appends with a fresh id and dismissToast removes only that toast", () => {
	const store = useAppStore.getState();
	const id1 = store.pushToast({ variant: "error", message: "boom" });
	const id2 = store.pushToast({ variant: "info", message: "fyi", title: "Heads up" });
	expect(id1).not.toBe(id2);
	expect(useAppStore.getState().toasts).toMatchObject([
		{ id: id1, variant: "error", message: "boom" },
		{ id: id2, variant: "info", message: "fyi", title: "Heads up" },
	]);
	expect(useAppStore.getState().toasts[0]).not.toHaveProperty("title");

	store.dismissToast(id1);
	expect(useAppStore.getState().toasts).toMatchObject([{ id: id2 }]);
});

test("dismissToast for an unknown id is a no-op (same array ref, no churn)", () => {
	const store = useAppStore.getState();
	store.pushToast({ variant: "success", message: "done" });
	const before = useAppStore.getState().toasts;
	store.dismissToast("ghost");
	expect(useAppStore.getState().toasts).toBe(before);
});

test("pushToast coalesces an identical live toast (same variant/title/message) into the existing id", () => {
	const store = useAppStore.getState();
	const id1 = store.pushToast({ variant: "error", message: "boom", title: "Failed" });
	const twin = store.pushToast({ variant: "error", message: "boom", title: "Failed" });
	expect(twin).toBe(id1);
	expect(useAppStore.getState().toasts).toHaveLength(1);

	store.pushToast({ variant: "info", message: "boom", title: "Failed" });
	store.pushToast({ variant: "error", message: "boom" });
	expect(useAppStore.getState().toasts).toHaveLength(3);

	store.dismissToast(id1);
	const fresh = store.pushToast({ variant: "error", message: "boom", title: "Failed" });
	expect(fresh).not.toBe(id1);
	expect(useAppStore.getState().toasts).toHaveLength(3);
});

test("pushToast caps the queue, dropping the oldest", () => {
	const store = useAppStore.getState();
	const first = store.pushToast({ variant: "error", message: "toast 0" });
	for (let i = 1; i <= 5; i++) store.pushToast({ variant: "error", message: `toast ${i}` });
	const toasts = useAppStore.getState().toasts;
	expect(toasts).toHaveLength(5);
	expect(toasts.some((t) => t.id === first)).toBe(false);
	expect(toasts[0]?.message).toBe("toast 1");
	expect(toasts[4]?.message).toBe("toast 5");
});

test("the toast helper enqueues by variant and omits an absent title", () => {
	toast.success("saved");
	toast.error("nope", "Failed");
	expect(useAppStore.getState().toasts).toMatchObject([
		{ variant: "success", message: "saved" },
		{ variant: "error", message: "nope", title: "Failed" },
	]);
	expect(useAppStore.getState().toasts[0]).not.toHaveProperty("title");
});

test("applyConfig folds the server-synced app config in (theme is an opaque host-owned value)", () => {
	useAppStore.getState().applyConfig({ theme: "acme.solarized" });
	expect(useAppStore.getState().theme).toBe("acme.solarized");
	useAppStore.getState().applyConfig({ theme: "custom.high-contrast" });
	expect(useAppStore.getState().theme).toBe("custom.high-contrast");
});

test("applyConfig projects the composer growth limit", () => {
	useAppStore.getState().applyConfig({
		...DEFAULT_CONFIG,
		composerGrowthLimit: "roomy",
	});
	expect(useAppStore.getState()).toHaveProperty("composerGrowthLimit", "roomy");
});

test("chat message order is browser-local and cannot be overwritten by host config", () => {
	useAppStore.getState().setChatMessageOrder("newest-first");
	const legacyConfig = { ...DEFAULT_CONFIG, chatMessageOrder: "oldest-first" };
	useAppStore.getState().applyConfig(legacyConfig);
	expect(useAppStore.getState().chatMessageOrder).toBe("newest-first");
});

test("diff tabs: openTab dedupes by id + activates; view + contents update in place", () => {
	const s = () => useAppStore.getState();
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const tab = {
		kind: "diff" as const,
		id: "ws1:diff:branch:src/a.ts",
		workspaceId: "ws1",
		name: "a.ts",
		path: "src/a.ts",
		scope: { kind: "branch" } as const,
		original: "old",
		modified: "new",
		loadedTick: 1,
		loadedTarget: "main",
	};
	s().openTab(tab);
	s().openTab(tab);
	expect(s().tabsByWorkspace.ws1).toHaveLength(1);
	expect(s().activeTabByWorkspace.ws1).toBe(tab.id);

	s().setDiffTabView(tab.id, "inline");
	const afterView = s().tabsByWorkspace.ws1?.[0];
	expect(afterView?.kind === "diff" && afterView.view).toBe("inline");
	s().setFileTabView(tab.id, "source");
	const guarded = s().tabsByWorkspace.ws1?.[0];
	expect(guarded?.kind === "diff" && guarded.view).toBe("inline");

	s().setDiffTabIgnoreWhitespace(tab.id, true);
	const afterWs = s().tabsByWorkspace.ws1?.[0];
	expect(afterWs?.kind === "diff" && afterWs.ignoreWhitespace).toBe(true);

	s().updateDiffTabContent("ws1", tab.id, "old2", "new2", 5, "origin/release");
	const updated = s().tabsByWorkspace.ws1?.[0];
	expect(updated?.kind).toBe("diff");
	if (updated?.kind === "diff") {
		expect(updated.original).toBe("old2");
		expect(updated.modified).toBe("new2");
		expect(updated.loadedTick).toBe(5);
		expect(updated.loadedTarget).toBe("origin/release");
	}
});

test("live content updates are scoped when two workspaces reuse an opaque cache id", () => {
	useAppStore.setState({
		tabsByWorkspace: {
			ws1: [
				{
					kind: "file",
					id: "legacy-placement",
					workspaceId: "ws1",
					name: "one",
					path: "one",
					content: "one",
				},
			],
			ws2: [
				{
					kind: "file",
					id: "legacy-placement",
					workspaceId: "ws2",
					name: "two",
					path: "two",
					content: "two",
				},
			],
		},
	});
	useAppStore.getState().updateFileTabContent("ws2", "legacy-placement", "fresh", 4);
	expect(useAppStore.getState().tabsByWorkspace.ws1?.[0]?.content).toBe("one");
	expect(useAppStore.getState().tabsByWorkspace.ws2?.[0]?.content).toBe("fresh");
});

test("the diff scope is per workspace, defaults to the branch, and is dropped with the workspace", () => {
	const s = () => useAppStore.getState();
	useAppStore.setState({
		workspaces: {
			p1: [
				{
					id: "ws1",
					projectId: "p1",
					name: "ws1",
					branch: "b",
					worktreePath: "/wt",
					baseBranch: "main",
				},
			],
		},
		activeWorkspaceId: "ws1",
		selectedProjectId: "p1",
	});
	expect(selectDiffScope(s(), "ws1")).toBe(selectDiffScope(s(), "ws2"));
	expect(selectDiffScope(s(), "ws1")).toEqual({ kind: "branch" });

	s().setDiffScope("ws1", { kind: "commit", sha: "abc123" });
	expect(selectDiffScope(s(), "ws1")).toEqual({ kind: "commit", sha: "abc123" });
	expect(selectDiffScope(s(), "ws2")).toEqual({ kind: "branch" });

	s().applyWorkspaceRemoved("p1", "ws1");
	expect(s().diffScopeByWorkspace.ws1).toBeUndefined();
});

const skillFs = (
	workspaceId: string,
	paths: string[],
	skillChange: WorkspaceSkillChange = "detected",
	truncated = false,
): WorkspaceFsChangedPayload => ({ workspaceId, paths, truncated, skillChange });
const isStale = (workspaceId: string, sessionId: string) =>
	selectSkillsStale(useAppStore.getState(), workspaceId, sessionId);

test("skills badge: a skill-dir change flags the loaded session; reload clears it for good", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	expect(isStale("ws1", "a")).toBe(false);

	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	expect(isStale("ws1", "a")).toBe(true);

	expect(isStale("ws1", "a")).toBe(true);

	s().markSkillsSynced("a", selectWorkspaceTick(s(), "ws1"));
	expect(isStale("ws1", "a")).toBe(false);

	s().noteFsChanged(skillFs("ws1", ["src/app.ts"], "none"));
	s().noteFsChanged(skillFs("ws1", ["README.md"], "none"));
	expect(isStale("ws1", "a")).toBe(false);
});

test("skills badge: the skill-change tick is accumulated, so a later non-skill batch can't lose it", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);

	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	s().noteFsChanged(skillFs("ws1", ["src/app.ts"], "none"));
	expect(isStale("ws1", "a")).toBe(true);
});

test("skills badge: a pathless skill-neutral repo-metadata nudge refreshes without staling", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	s().noteFsChanged(skillFs("ws1", [], "none"));
	expect(selectWorkspaceTick(s(), "ws1")).toBe(1);
	expect(isStale("ws1", "a")).toBe(false);
});

test("skills badge: generic path overflow is neutral, but detected and unknown skill impact flags", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);

	s().noteFsChanged(skillFs("ws1", ["dist/chunk.js"], "none", true));
	expect(selectWorkspaceTick(s(), "ws1")).toBe(1);
	expect(isStale("ws1", "a")).toBe(false);

	s().noteFsChanged(skillFs("ws1", ["dist/chunk.js"], "detected", true));
	expect(isStale("ws1", "a")).toBe(true);
	s().markSkillsSynced("a", selectWorkspaceTick(s(), "ws1"));

	s().noteFsChanged(skillFs("ws1", [], "unknown", true));
	expect(isStale("ws1", "a")).toBe(true);
});

test("skills badge: non-skill overflow during session creation does not open the new chat stale", () => {
	const s = () => useAppStore.getState();
	s().noteFsChanged(skillFs("ws1", [], "unknown", true));
	const baseline = selectWorkspaceTick(s(), "ws1");
	s().noteFsChanged(skillFs("ws1", ["dist/chunk.js"], "none", true));
	s().openChatSession("ws1", "new", EMPTY_RUNTIME.capabilities, [], baseline);
	expect(isStale("ws1", "new")).toBe(false);
});

test("skills badge: per session — a chat opened after the change isn't flagged; reload clears only its own", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);

	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	s().openChatSession("ws1", "b", EMPTY_RUNTIME.capabilities, []);
	expect(isStale("ws1", "a")).toBe(true);
	expect(isStale("ws1", "b")).toBe(false);

	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	expect(isStale("ws1", "a")).toBe(true);
	expect(isStale("ws1", "b")).toBe(true);

	s().markSkillsSynced("b", selectWorkspaceTick(s(), "ws1"));
	expect(isStale("ws1", "a")).toBe(true);
	expect(isStale("ws1", "b")).toBe(false);
});

test("skills badge: a skill change mid-reload stays flagged (baseline is captured at reload start)", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	const reloadBaseline = selectWorkspaceTick(s(), "ws1");
	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	s().markSkillsSynced("a", reloadBaseline);
	expect(isStale("ws1", "a")).toBe(true);
});

test("skills badge: closing a chat runtime drops its sync baseline (no leak)", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);
	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));
	s().markSkillsSynced("a", selectWorkspaceTick(s(), "ws1"));
	expect(s().skillsSyncedTickBySession.a).toBeDefined();

	s().closeChatRuntime("a");
	expect(s().skillsSyncedTickBySession.a).toBeUndefined();
});

test("skills badge: markSkillsSynced is monotonic and ignores a disposed session", () => {
	const s = () => useAppStore.getState();
	s().openChatSession("ws1", "a", EMPTY_RUNTIME.capabilities, []);

	s().markSkillsSynced("a", 5);
	s().markSkillsSynced("a", 2);
	expect(s().skillsSyncedTickBySession.a).toBe(5);

	s().closeChatRuntime("a");
	s().markSkillsSynced("a", 9);
	expect(s().skillsSyncedTickBySession.a).toBeUndefined();
});

test("skills badge: a LIVE restore stays conservatively stale; a disk attach anchors to its load tick", () => {
	const s = () => useAppStore.getState();
	s().noteFsChanged(skillFs("ws1", [".claude/skills/foo/SKILL.md"]));

	s().hydrateSession(summary("live1", "ws1", {}, { live: true }), hydrated());
	expect(isStale("ws1", "live1")).toBe(true);

	s().hydrateSession(
		summary("disk1", "ws1", {}, { live: false }),
		hydrated(),
		false,
		selectWorkspaceTick(s(), "ws1"),
	);
	expect(isStale("ws1", "disk1")).toBe(false);
});

test("explicitly passive hydration never becomes navigation just because the cache has no active tab", () => {
	const store = useAppStore.getState();
	store.hydrateSession(
		summary("passive", "ws1", {}, { live: true }),
		hydrated(),
		false,
		undefined,
		{
			activate: false,
		},
	);
	expect(useAppStore.getState().activeTabByWorkspace.ws1).toBeUndefined();
	expect(useAppStore.getState().navTickByWorkspace.ws1).toBeUndefined();
});

function fileTab(workspaceId: string, name: string): FileTab {
	return { kind: "file", id: `${workspaceId}:${name}`, workspaceId, name, path: name, content: "" };
}

test("a preview open replaces the previous preview tab at its index (the strip never reshuffles)", () => {
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "keep");
	store.openTab(fileTab("ws1", "b.ts"), "preview");
	store.openTab(fileTab("ws1", "c.ts"), "keep");

	store.openTab(fileTab("ws1", "d.ts"), "preview");

	const s = useAppStore.getState();
	expect((s.tabsByWorkspace.ws1 ?? []).map((t) => t.name)).toEqual(["a.ts", "d.ts", "c.ts"]);
	expect(s.previewTabByWorkspace.ws1).toBe("ws1:d.ts");
	expect(s.activeTabByWorkspace.ws1).toBe("ws1:d.ts");
});

test("hydrated per-group previews never evict one another from the render cache", () => {
	const document: WorkspaceLayoutDocument = {
		version: 2,
		center: { kind: "group", id: "center-a", tabs: [] },
		left: { visible: false, width: 0.18, groups: [] },
		right: { visible: false, width: 0.28, groups: [] },
		bottom: emptyBottomRegion(),
		toolRestoreTargets: {},
	};
	useAppStore.setState({ layoutDocumentsByWorkspace: { ws1: document } });
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "preview");
	store.openTab(fileTab("ws1", "b.ts"), "preview");

	expect((useAppStore.getState().tabsByWorkspace.ws1 ?? []).map((tab) => tab.name)).toEqual([
		"a.ts",
		"b.ts",
	]);
});

test("a preview open of an already-kept tab focuses it without demoting it or moving the slot", () => {
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "keep");
	store.openTab(fileTab("ws1", "b.ts"), "preview");

	store.openTab(fileTab("ws1", "a.ts"), "preview");

	const s = useAppStore.getState();
	expect(s.activeTabByWorkspace.ws1).toBe("ws1:a.ts");
	expect(s.previewTabByWorkspace.ws1).toBe("ws1:b.ts");
	expect(s.tabsByWorkspace.ws1).toHaveLength(2);
});

test("keep releases the slot — through openTab, through setActiveTab, and through closeTab", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const store = useAppStore.getState();

	store.openTab(fileTab("ws1", "a.ts"), "preview");
	store.setActiveTab("ws1:a.ts", "keep");
	expect(useAppStore.getState().previewTabByWorkspace.ws1).toBeUndefined();

	store.openTab(fileTab("ws1", "b.ts"), "preview");
	store.openTab(fileTab("ws1", "b.ts"), "keep");
	expect(useAppStore.getState().previewTabByWorkspace.ws1).toBeUndefined();

	store.openTab(fileTab("ws1", "c.ts"), "preview");
	store.closeTab("ws1:c.ts");
	expect(useAppStore.getState().previewTabByWorkspace.ws1).toBeUndefined();
});

test("promotion is one-way: neither a plain activation nor a keep elsewhere demotes a tab", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "keep");
	store.openTab(fileTab("ws1", "b.ts"), "preview");

	store.setActiveTab("ws1:a.ts");
	expect(useAppStore.getState().previewTabByWorkspace.ws1).toBe("ws1:b.ts");

	store.setActiveTab("ws1:a.ts", "keep");
	expect(useAppStore.getState().previewTabByWorkspace.ws1).toBe("ws1:b.ts");
});

test("the slot is per workspace — clearWorkspaceTabs releases only its own", () => {
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "preview");
	store.openTab(fileTab("ws2", "b.ts"), "preview");

	store.clearWorkspaceTabs("ws1");

	const s = useAppStore.getState();
	expect(s.previewTabByWorkspace.ws1).toBeUndefined();
	expect(s.previewTabByWorkspace.ws2).toBe("ws2:b.ts");
});

test("chat, document, and plan tabs never enter the preview slot", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "preview");

	store.openChatSession("ws1", "s1", EMPTY_RUNTIME.capabilities, []);
	store.openDoc({
		kind: "doc",
		id: "ws1:plan",
		workspaceId: "ws1",
		name: "Plan",
		content: "# plan",
		docPath: "plan.md",
		sourceId: "s1",
	});
	store.openTab(
		{
			kind: "chat",
			id: "direct-chat",
			workspaceId: "ws1",
			name: "Direct chat",
			sessionId: "s2",
		},
		"preview",
	);
	store.openDoc({
		kind: "plan",
		id: "ws1:live-plan",
		workspaceId: "ws1",
		name: "Live plan",
		sessionId: "s3",
	});

	const s = useAppStore.getState();
	expect(s.previewTabByWorkspace.ws1).toBe("ws1:a.ts");
	expect(s.tabsByWorkspace.ws1).toHaveLength(5);
	expect(s.layoutIntents.at(-1)).toMatchObject({ kind: "open", intent: "keep" });
});

test("a keep on an already-open tab releases ITS workspace's slot, never the active one's", () => {
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "preview");
	store.openTab(fileTab("ws2", "b.ts"), "preview");
	useAppStore.setState({ activeWorkspaceId: "ws2" });

	store.openTab(fileTab("ws1", "a.ts"), "keep");

	const s = useAppStore.getState();
	expect(s.previewTabByWorkspace.ws1).toBeUndefined();
	expect(s.previewTabByWorkspace.ws2).toBe("ws2:b.ts");
	expect(s.activeTabByWorkspace.ws1).toBe("ws1:a.ts");
	expect(s.activeTabByWorkspace.ws2).toBe("ws2:b.ts");
});

test("every center navigation bumps the workspace's nav tick, and none of them bypass it", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const tick = () => useAppStore.getState().navTickByWorkspace.ws1 ?? 0;
	const missed: string[] = [];
	const bumps = (label: string, act: () => void) => {
		const before = tick();
		act();
		if (tick() <= before) missed.push(label);
	};

	const s = () => useAppStore.getState();
	const beforeOpen = tick();
	s().openTab(fileTab("ws1", "a.ts"), "preview");
	s().openTab(fileTab("ws1", "a.ts"), "keep");
	expect(tick()).toBe(beforeOpen);

	bumps("setActiveTab", () => s().setActiveTab("ws1:a.ts"));
	bumps("openDoc", () =>
		s().openDoc({
			kind: "doc",
			id: "ws1:plan",
			workspaceId: "ws1",
			name: "Plan",
			content: "# p",
			docPath: "plan.md",
			sourceId: "s1",
		}),
	);
	bumps("openChatSession", () =>
		s().openChatSession("ws1", "sess", EMPTY_RUNTIME.capabilities, []),
	);
	bumps("closeChatToHistory", () => s().closeChatToHistory("sess"));
	bumps("reopenChat", () => s().reopenChat("ws1", "sess"));
	s().setActiveTab("ws1:a.ts");
	bumps("closeTab", () => s().closeTab("ws1:a.ts"));
	bumps("noteNavigation", () => s().noteNavigation("ws1"));
	bumps("requestHistoryOpen", () =>
		s().requestHistoryOpen({ sessionId: "sess", workspaceId: "ws1", tabId: "ws1:sess" }),
	);
	expect(s().layoutIntents.at(-1)).toMatchObject({ kind: "select", focus: false });
	expect(missed).toEqual([]);

	useAppStore.setState({ activeTabByWorkspace: { ws1: "ws1:sess" } });
	const before = tick();
	s().hydrateSession(summary("bg", "ws1", { title: "bg" }), hydrated());
	expect(tick()).toBe(before);

	expect(useAppStore.getState().navTickByWorkspace.ws2).toBeUndefined();
	s().clearWorkspaceTabs("ws1");
	expect(useAppStore.getState().navTickByWorkspace.ws1).toBeUndefined();
});

test("history selection resolves a cache alias to its stable shared placement id", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "history-alias", EMPTY_RUNTIME.capabilities, []);
	const cache = useAppStore
		.getState()
		.tabsByWorkspace.ws1?.find((tab) => tab.kind === "chat" && tab.sessionId === "history-alias");
	if (!cache) throw new Error("missing history cache fixture");
	useAppStore.setState({
		layoutIntents: [],
		layoutDocumentsByWorkspace: {
			ws1: {
				version: 2,
				center: {
					kind: "group",
					id: "history-group",
					tabs: [
						{
							kind: "chat",
							id: "legacy-history-placement",
							name: "History",
							sessionId: "history-alias",
						},
					],
				},
				left: { visible: false, width: 0.2, groups: [] },
				right: { visible: false, width: 0.2, groups: [] },
				bottom: emptyBottomRegion(),
				toolRestoreTargets: {},
			},
		},
		layoutAttentionByWorkspace: {
			ws1: {
				selectedByGroup: { "history-group": "legacy-history-placement" },
				lastFocusedCenterGroupId: "history-group",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { "history-group": 0 },
			},
		},
	});
	store.requestHistoryOpen({
		workspaceId: "ws1",
		sessionId: "history-alias",
		tabId: cache.id,
	});
	expect(useAppStore.getState().layoutIntents.at(-1)).toMatchObject({
		kind: "select",
		tabId: "legacy-history-placement",
		resource: { kind: "chat", sessionId: "history-alias" },
		focus: false,
	});
});

test("history selection never uses a colliding cache id as shared placement identity", () => {
	const store = useAppStore.getState();
	store.openChatSession("ws1", "history-collision", EMPTY_RUNTIME.capabilities, []);
	const chat = useAppStore
		.getState()
		.tabsByWorkspace.ws1?.find(
			(tab) => tab.kind === "chat" && tab.sessionId === "history-collision",
		);
	if (!chat) throw new Error("missing colliding history cache fixture");
	const collidingId = "opaque-collision";
	useAppStore.setState({
		layoutIntents: [],
		tabsByWorkspace: { ws1: [{ ...chat, id: collidingId }] },
		layoutDocumentsByWorkspace: {
			ws1: {
				version: 2,
				center: {
					kind: "split",
					id: "history-split",
					direction: "horizontal",
					weights: [0.5, 0.5],
					children: [
						{ kind: "group", id: "history-origin", tabs: [] },
						{
							kind: "group",
							id: "history-collision-group",
							tabs: [{ kind: "file", id: collidingId, name: "other.ts", path: "other.ts" }],
						},
					],
				},
				left: { visible: false, width: 0.2, groups: [] },
				right: { visible: false, width: 0.2, groups: [] },
				bottom: emptyBottomRegion(),
				toolRestoreTargets: {},
			},
		},
		layoutAttentionByWorkspace: {
			ws1: {
				selectedByGroup: { "history-collision-group": collidingId },
				lastFocusedCenterGroupId: "history-origin",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { "history-origin": 0, "history-collision-group": 0 },
			},
		},
	});
	store.requestHistoryOpen({
		workspaceId: "ws1",
		sessionId: "history-collision",
		tabId: collidingId,
	});
	const state = useAppStore.getState();
	expect(state.layoutIntents.at(-1)).toMatchObject({
		kind: "select",
		resource: { kind: "chat", sessionId: "history-collision" },
		navigation: { groupId: "history-origin", clock: 1 },
	});
	expect(state.layoutAttentionByWorkspace.ws1?.lastFocusedCenterGroupId).toBe("history-origin");
	expect(state.layoutAttentionByWorkspace.ws1?.navigationClockByGroup["history-origin"]).toBe(1);
	expect(
		state.layoutAttentionByWorkspace.ws1?.navigationClockByGroup["history-collision-group"],
	).toBe(0);
});

test("an accepted background close removes the cache from its captured workspace", () => {
	const store = useAppStore.getState();
	store.openTab(fileTab("ws1", "a.ts"), "keep");
	useAppStore.setState({ activeWorkspaceId: "ws2" });
	store.closeTab("ws1:a.ts", false, false, "ws1");
	expect(useAppStore.getState().tabsByWorkspace.ws1).toEqual([]);
	expect(useAppStore.getState().tabsByWorkspace.ws2).toBeUndefined();
});

test("a close that moves no focus is not a navigation — it can't discard a browse in flight", () => {
	useAppStore.setState({ activeWorkspaceId: "ws1" });
	const s = () => useAppStore.getState();
	const tick = () => s().navTickByWorkspace.ws1 ?? 0;

	s().openTab(fileTab("ws1", "a.ts"), "keep");
	s().openTab(fileTab("ws1", "b.ts"), "keep");
	s().openChatSession("ws1", "sess", EMPTY_RUNTIME.capabilities, []);
	s().setActiveTab("ws1:b.ts");
	const before = tick();

	s().closeTab("ws1:a.ts");
	expect(tick()).toBe(before);
	expect(s().activeTabByWorkspace.ws1).toBe("ws1:b.ts");

	s().closeChatToHistory("sess");
	expect(tick()).toBe(before);
	expect(s().activeTabByWorkspace.ws1).toBe("ws1:b.ts");

	s().closeTab("ws1:b.ts");
	expect(tick()).toBeGreaterThan(before);
});

test("terminal creation can capture a center-group destination without creating a second authority", () => {
	useAppStore.setState({
		layoutAttentionByWorkspace: {
			w1: {
				selectedByGroup: {},
				lastFocusedCenterGroupId: "center-a",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: { "center-a": 1, "center-b": 3 },
			},
		},
	});
	useAppStore.getState().addTerminal("w1", undefined, "center-b");
	const state = useAppStore.getState();
	expect(state.terminalsByWorkspace.w1).toHaveLength(1);
	expect(state.layoutIntents).toHaveLength(1);
	expect(state.layoutIntents[0]).toMatchObject({
		kind: "place-terminal",
		workspaceId: "w1",
		targetGroupId: "center-b",
	});
	expect(state.layoutAttentionByWorkspace.w1).toMatchObject({
		lastFocusedCenterGroupId: "center-b",
		navigationClockByGroup: { "center-a": 1, "center-b": 4 },
	});
	expect(state.navTickByWorkspace.w1).toBe(1);
});

test("terminal creation can target bottom without advancing center navigation", () => {
	const attention = {
		selectedByGroup: {},
		lastFocusedCenterGroupId: "center-a",
		lastFocusedSideGroupId: { bottom: "bottom-a" },
		navigationClockByGroup: { "center-a": 2 },
	};
	useAppStore.setState({ layoutAttentionByWorkspace: { w1: attention } });
	useAppStore.getState().addTerminal("w1", undefined, "bottom-b", "bottom");
	const state = useAppStore.getState();
	expect(state.layoutIntents[0]).toMatchObject({
		kind: "place-terminal",
		workspaceId: "w1",
		targetGroupId: "bottom-b",
		targetArea: "bottom",
	});
	expect(state.layoutAttentionByWorkspace.w1).toBe(attention);
	expect(state.navTickByWorkspace.w1).toBeUndefined();
});

test("the host catalog confirms a reservation while retaining its one-shot command", () => {
	useAppStore.getState().addTerminal("w1", "code .", "bottom-a", "bottom");
	const pending = useAppStore.getState().terminalsByWorkspace.w1?.[0];
	if (!pending) throw new Error("missing pending terminal");
	expect(pending.reservationPending).toBe(true);

	useAppStore
		.getState()
		.setWorkspaceTerminals("w1", [{ tabKey: pending.tabKey, title: "Host title" }]);
	expect(useAppStore.getState().terminalsByWorkspace.w1).toEqual([
		{
			tabKey: pending.tabKey,
			workspaceId: "w1",
			title: "Host title",
			initialCommand: "code .",
		},
	]);
	expect(useAppStore.getState().layoutIntents).toHaveLength(1);
});

test("hidden terminal seeding stays non-activating, idempotent, and atomically rejectable", () => {
	useAppStore
		.getState()
		.addTerminal("w1", undefined, "bottom-a", "bottom", false, "initial-terminal");
	useAppStore
		.getState()
		.addTerminal("w1", undefined, "bottom-a", "bottom", false, "initial-terminal");
	const pending = useAppStore.getState().terminalsByWorkspace.w1?.[0];
	if (!pending) throw new Error("missing pending terminal");
	expect(useAppStore.getState().terminalsByWorkspace.w1).toHaveLength(1);
	expect(useAppStore.getState().layoutIntents).toHaveLength(1);
	expect(useAppStore.getState().layoutIntents[0]).toMatchObject({
		kind: "place-terminal",
		workspaceId: "w1",
		tabKey: pending.tabKey,
		targetGroupId: "bottom-a",
		targetArea: "bottom",
		reveal: false,
	});

	useAppStore.getState().rejectTerminalReservation("w1", pending.tabKey);
	expect(useAppStore.getState().terminalsByWorkspace.w1).toEqual([]);
	expect(useAppStore.getState().layoutIntents).toEqual([]);
});

test("addTerminal reuses a host-minted tabKey instead of generating one", () => {
	useAppStore.getState().addTerminal("w1", undefined, undefined, "center", true, "host-terminal-1");
	const state = useAppStore.getState();
	expect(state.terminalsByWorkspace.w1).toMatchObject([{ tabKey: "host-terminal-1" }]);
	expect(state.activeTerminalByWorkspace.w1).toBe("host-terminal-1");
	expect(state.layoutIntents[0]).toMatchObject({
		kind: "place-terminal",
		tabKey: "host-terminal-1",
	});
});
