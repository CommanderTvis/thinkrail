import { beforeEach, expect, mock, test } from "bun:test";
import type { PluginRosterEntry } from "@thinkrail/contracts";
import type { ActivationGuard } from "./context";

const pushHandlers = new Map<string, (data: unknown) => void>();
const requests: { method: string; params: unknown }[] = [];
let snapshotResult: unknown[] = [];
let createSessionImpl: () => Promise<{
	result: { sessionId: string; model: string; thinkingLevel: string };
	syncedTick: number;
}> = async () => {
	throw new Error("not used in this test");
};

const actualTransport = await import("../../transport");
mock.module("../../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: async (method: string, params: unknown) => {
			requests.push({ method, params });
			if (method === "plugin.demo.list") return snapshotResult;
			if (method === "session.prompt") return { ok: true };
			throw new Error(`unexpected method in test: ${method}`);
		},
		subscribe: (channel: string, handler: (data: unknown) => void) => {
			pushHandlers.set(channel, handler);
			return () => pushHandlers.delete(channel);
		},
		httpBase: () => "http://localhost",
	}),
	createSessionWithSkillBaseline: () => createSessionImpl(),
	watchWorkspaceForLiveContent: async () => {},
}));

const { createWebContext } = await import("./context");
const { useAppStore } = await import("../../store");

const entry: PluginRosterEntry = {
	id: "demo",
	label: "Demo",
	icon: "puzzle-2",
	version: "0.0.0",
	wireVersion: 1,
	origin: "builtin",
	status: "active",
	dependsOn: [],
	modifiesSystemPrompt: false,
	contributes: { sideTools: [], fileViewers: [] },
	channels: {
		items: { kind: "state", snapshot: "list", key: ["workspaceId"] },
	},
};

beforeEach(() => {
	pushHandlers.clear();
	requests.length = 0;
	snapshotResult = [];
	createSessionImpl = async () => {
		throw new Error("not used in this test");
	};
	useAppStore.setState({
		status: "connecting",
		connectionGeneration: 0,
		terminalsByWorkspace: {},
		activeTerminalByWorkspace: {},
		activeWorkspaceId: null,
		fsChangesByWorkspace: {},
	});
});

test("subscribing to a state channel reads the snapshot with the scope as params, then streams pushes", async () => {
	snapshotResult = [{ workspaceId: "w1", value: "from-snapshot" }];
	const ctx = createWebContext(entry, { current: true, disposers: [] });
	const seen: unknown[] = [];
	const unsubscribe = ctx.subscribe("items", (payload) => seen.push(payload), {
		workspaceId: "w1",
	});

	await Promise.resolve();
	await Promise.resolve();

	expect(requests).toEqual([{ method: "plugin.demo.list", params: { workspaceId: "w1" } }]);
	expect(seen).toEqual([{ workspaceId: "w1", value: "from-snapshot" }]);
	unsubscribe();
});

test("drops a push whose key fields differ from the subscribed scope", async () => {
	const ctx = createWebContext(entry, { current: true, disposers: [] });
	const seen: unknown[] = [];
	const unsubscribe = ctx.subscribe("items", (payload) => seen.push(payload), {
		workspaceId: "w1",
	});
	await Promise.resolve();
	await Promise.resolve();

	pushHandlers.get("plugin.demo.items")?.({ workspaceId: "w1", value: "matching" });
	pushHandlers.get("plugin.demo.items")?.({ workspaceId: "w2", value: "other-scope" });

	expect(seen).toEqual([{ workspaceId: "w1", value: "matching" }]);
	unsubscribe();
});

test("re-reads the snapshot when the connection generation advances", async () => {
	const ctx = createWebContext(entry, { current: true, disposers: [] });
	const unsubscribe = ctx.subscribe("items", () => {}, { workspaceId: "w1" });
	await Promise.resolve();
	await Promise.resolve();
	expect(requests).toHaveLength(1);

	useAppStore.getState().setStatus("connected");
	await Promise.resolve();
	await Promise.resolve();

	expect(requests).toHaveLength(2);
	unsubscribe();
});

test("unsubscribing stops both the push subscription and the reconnect watch", async () => {
	const ctx = createWebContext(entry, { current: true, disposers: [] });
	const seen: unknown[] = [];
	const unsubscribe = ctx.subscribe("items", (payload) => seen.push(payload), {
		workspaceId: "w1",
	});
	await Promise.resolve();
	await Promise.resolve();
	unsubscribe();

	pushHandlers.get("plugin.demo.items")?.({ workspaceId: "w1", value: "after-unsubscribe" });
	useAppStore.getState().setStatus("connected");
	await Promise.resolve();
	await Promise.resolve();

	expect(seen).toEqual([]);
	expect(requests).toHaveLength(1);
});

test("openChat submits the prompt into the new session instead of leaving it as a draft", async () => {
	createSessionImpl = async () => ({
		result: { sessionId: "s1", model: "sonnet", thinkingLevel: "medium" },
		syncedTick: 1,
	});
	const ctx = createWebContext(entry, { current: true, disposers: [] });

	const { sessionId } = await ctx.openChat("w1", { prompt: "hello" });

	expect(sessionId).toBe("s1");
	expect(requests).toContainEqual({
		method: "session.prompt",
		params: { sessionId: "s1", text: "hello" },
	});
	expect(useAppStore.getState().sessions.s1?.turns.at(-1)).toMatchObject({
		kind: "user",
		message: { role: "user", content: "hello" },
	});
});

test("openTerminal places and selects a fresh tabKey", async () => {
	const ctx = createWebContext(entry, { current: true, disposers: [] });

	const { tabKey } = await ctx.openTerminal("w1", { tabKey: "t1", command: "echo hi" });

	expect(tabKey).toBe("t1");
	expect(useAppStore.getState().terminalsByWorkspace.w1?.map((tab) => tab.tabKey)).toEqual(["t1"]);
	expect(useAppStore.getState().activeTerminalByWorkspace.w1).toBe("t1");
});

test("openTerminal attaches to a tabKey already in the host catalog instead of no-oping", async () => {
	useAppStore.getState().addTerminal("w1", undefined, undefined, "center", true, "t1");
	useAppStore.getState().setActiveTerminalTab("w1", "other");
	const ctx = createWebContext(entry, { current: true, disposers: [] });

	const { tabKey } = await ctx.openTerminal("w1", { tabKey: "t1" });

	expect(tabKey).toBe("t1");
	expect(useAppStore.getState().terminalsByWorkspace.w1?.map((tab) => tab.tabKey)).toEqual(["t1"]);
	expect(useAppStore.getState().activeTerminalByWorkspace.w1).toBe("t1");
});

test("watchHost fires on a real change to the selected workspace + revision, not on an unrelated write, and stops after dispose", () => {
	const activation: ActivationGuard = { current: true, disposers: [] };
	const ctx = createWebContext(entry, activation);
	const seen: { workspaceId: string | null; revision: number }[] = [];
	const unwatch = ctx.watchHost(
		(host) => ({
			workspaceId: host.activeWorkspaceId,
			revision: host.activeWorkspaceId ? (host.workspaceRevisions[host.activeWorkspaceId] ?? 0) : 0,
		}),
		(value) => seen.push(value),
	);

	useAppStore.getState().noteFsChanged({
		workspaceId: "other",
		paths: [],
		truncated: false,
		skillChange: "none",
	});
	expect(seen).toEqual([]);

	useAppStore.setState({ activeWorkspaceId: "w1" });
	expect(seen).toEqual([{ workspaceId: "w1", revision: 0 }]);

	useAppStore.getState().noteFsChanged({
		workspaceId: "w1",
		paths: ["spec.md"],
		truncated: false,
		skillChange: "none",
	});
	expect(seen).toEqual([
		{ workspaceId: "w1", revision: 0 },
		{ workspaceId: "w1", revision: 1 },
	]);

	unwatch();
	useAppStore.getState().noteFsChanged({
		workspaceId: "w1",
		paths: ["spec.md"],
		truncated: false,
		skillChange: "none",
	});
	expect(seen).toHaveLength(2);
	expect(activation.disposers).toHaveLength(1);
});
