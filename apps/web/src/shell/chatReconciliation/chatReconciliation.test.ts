import { beforeEach, expect, mock, test } from "bun:test";
import type {
	AgentPlan,
	ChatMessage,
	ConfigOption,
	LayoutCenterTab,
	SessionRecord,
	SessionSummary,
	WorkspaceLayoutDocument,
} from "@thinkrail/contracts";

let pending: { resolve: (value: unknown) => void } | null = null;
const requests: { method: string; params: unknown }[] = [];
const actualTransport = await import("../../transport");
mock.module("../../transport", () => ({
	...actualTransport,
	getSessionMessagesWithSkillBaseline: (params: { workspaceId: string; sessionId: string }) => {
		requests.push({ method: "session.getMessages", params });
		return new Promise((resolve) => {
			pending = { resolve };
		});
	},
}));

const { EMPTY_RUNTIME, useAppStore } = await import("../../store");
const { currentChatDestination, hydrateChatResource } = await import("./chatReconciliation");

function summary(
	sessionId: string,
	workspaceId: string,
	recordOver: Partial<SessionRecord> = {},
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
	};
}

function layoutWithChatTab(sessionId: string, tabId = "placed-tab"): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: {
			kind: "group",
			id: "center",
			tabs: [{ kind: "chat", id: tabId, name: "Chat", sessionId }],
		},
		left: { visible: false, width: 0.2, groups: [] },
		right: { visible: false, width: 0.2, groups: [] },
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		toolRestoreTargets: {},
	};
}

beforeEach(() => {
	pending = null;
	requests.length = 0;
	useAppStore.setState({
		status: "connected",
		activeWorkspaceId: null,
		removedWorkspaceIds: {},
		deletedSessionsByWorkspace: {},
		connectionGeneration: 0,
		layoutDocumentsByWorkspace: {},
		layoutAttentionByWorkspace: {},
		tabsByWorkspace: {},
		activeTabByWorkspace: {},
		sessions: {},
		closedChatsByWorkspace: {},
	});
});

test("hydrateChatResource returns false without a wire request when the workspace is removed", async () => {
	useAppStore.setState({ removedWorkspaceIds: { w1: true } });

	expect(await hydrateChatResource("w1", "s1")).toBe(false);
	expect(requests).toHaveLength(0);
});

test("hydrateChatResource returns false without a wire request when the session is tombstoned", async () => {
	useAppStore.setState({ deletedSessionsByWorkspace: { w1: { s1: true } } });

	expect(await hydrateChatResource("w1", "s1")).toBe(false);
	expect(requests).toHaveLength(0);
});

test("hydrateChatResource de-dupes concurrent calls for the same workspace/session/generation into one request", async () => {
	useAppStore.setState({ layoutDocumentsByWorkspace: { w1: layoutWithChatTab("s1") } });

	const first = hydrateChatResource("w1", "s1");
	const second = hydrateChatResource("w1", "s1");

	expect(second).toBe(first);
	expect(requests).toHaveLength(1);

	pending?.resolve({
		result: {
			summary: summary("s1", "w1"),
			messages: [],
			configOptions: [],
			capabilities: EMPTY_RUNTIME.capabilities,
			plan: null,
		},
		syncedTick: 0,
	});
	await Promise.all([first, second]);
});

test("hydrateChatResource installs the runtime from the record-composed summary and the republished config/capabilities/plan, by field not position", async () => {
	useAppStore.setState({ layoutDocumentsByWorkspace: { w1: layoutWithChatTab("s1") } });

	const install = hydrateChatResource("w1", "s1");
	expect(requests).toEqual([
		{ method: "session.getMessages", params: { workspaceId: "w1", sessionId: "s1" } },
	]);

	const messages: ChatMessage[] = [
		{ role: "user", id: "m1", timestamp: 0, content: [{ type: "text", text: "hi" }] },
	];
	const configOptions: ConfigOption[] = [
		{
			id: "model",
			name: "Model",
			category: "model",
			control: { type: "select", value: "a", groups: [] },
		},
	];
	const plan: AgentPlan = { entries: [{ text: "step one", status: "pending" }] };
	pending?.resolve({
		result: {
			summary: summary("s1", "w1", { title: "Deploy fix" }),
			messages,
			configOptions,
			capabilities: EMPTY_RUNTIME.capabilities,
			plan,
		},
		syncedTick: 3,
	});

	expect(await install).toBe(true);

	const runtime = useAppStore.getState().sessions.s1;
	expect(runtime?.messages).toBe(messages);
	expect(runtime?.configOptions).toBe(configOptions);
	expect(runtime?.plan).toBe(plan);
	expect(runtime?.capabilities).toBe(EMPTY_RUNTIME.capabilities);
	const tab = useAppStore.getState().tabsByWorkspace.w1?.find((t) => t.kind === "chat");
	expect(tab).toMatchObject({ sessionId: "s1", name: "Deploy fix" });
});

test("hydrateChatResource aborts without installing the runtime when the chat is no longer placed by the time the read resolves", async () => {
	useAppStore.setState({ layoutDocumentsByWorkspace: { w1: layoutWithChatTab("s1") } });

	const install = hydrateChatResource("w1", "s1");
	useAppStore.setState({ layoutDocumentsByWorkspace: { w1: layoutWithChatTab("other-session") } });

	pending?.resolve({
		result: {
			summary: summary("s1", "w1"),
			messages: [],
			configOptions: [],
			capabilities: EMPTY_RUNTIME.capabilities,
			plan: null,
		},
		syncedTick: 0,
	});

	expect(await install).toBe(false);
	expect(useAppStore.getState().sessions.s1).toBeUndefined();
});

test("currentChatDestination reports the tab current when it is the selected tab in its group", () => {
	useAppStore.setState({
		activeWorkspaceId: "w1",
		layoutDocumentsByWorkspace: { w1: layoutWithChatTab("s1", "placed-tab") },
		layoutAttentionByWorkspace: {
			w1: {
				selectedByGroup: { center: "placed-tab" },
				lastFocusedCenterGroupId: "center",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: {},
			},
		},
	});
	const tab: Extract<LayoutCenterTab, { kind: "chat" }> = {
		kind: "chat",
		id: "requested-tab",
		name: "Chat",
		sessionId: "s1",
	};

	expect(currentChatDestination("w1", tab, null).current).toBe(true);
});

test("currentChatDestination reports the tab not current when a different tab is selected in its group", () => {
	useAppStore.setState({
		activeWorkspaceId: "w1",
		layoutDocumentsByWorkspace: { w1: layoutWithChatTab("s1", "placed-tab") },
		layoutAttentionByWorkspace: {
			w1: {
				selectedByGroup: { center: "some-other-tab" },
				lastFocusedCenterGroupId: "center",
				lastFocusedSideGroupId: {},
				navigationClockByGroup: {},
			},
		},
	});
	const tab: Extract<LayoutCenterTab, { kind: "chat" }> = {
		kind: "chat",
		id: "requested-tab",
		name: "Chat",
		sessionId: "s1",
	};

	expect(currentChatDestination("w1", tab, null).current).toBe(false);
});
