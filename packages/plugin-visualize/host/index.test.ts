import { afterEach, expect, test } from "bun:test";
import type {
	TerminalAgentRecord,
	Workspace,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import type { PluginToolDefinition, TerminalRef } from "@thinkrail/plugin-api";
import type {
	PluginHostContext,
	RevivePrefill,
	TerminalEvent,
	WorkspaceEvent,
} from "@thinkrail/plugin-api/host";
import type { visualizeContract } from "../contracts";
import host from "./index";
import { resetVisualizations } from "./store";

type Contract = typeof visualizeContract;

afterEach(() => {
	resetVisualizations();
});

function fakeContext() {
	const methods = new Map<string, (params: unknown) => unknown>();
	const tools: PluginToolDefinition[] = [];
	const published: unknown[] = [];
	const state = new Map<string, unknown>();
	const agentRecords = new Map<string, TerminalAgentRecord>();
	let terminalObserver: ((event: TerminalEvent) => void) | undefined;
	let workspaceObserver: ((event: WorkspaceEvent) => void) | undefined;

	const ctx: PluginHostContext<Contract> = {
		id: "visualize",
		log: { debug() {}, info() {}, warn() {}, error() {} },
		assetsDir: null,
		method: (name, handler) => methods.set(name as string, handler as (params: unknown) => unknown),
		publish: (_channel, payload) => published.push(payload),
		route: () => {},
		publicBaseUrl: () => "http://localhost:0",
		tool: (definition) => tools.push(definition),
		terminalEnv: () => {},
		terminalToken: () => "token",
		terminalForToken: () => null,
		agentRecord: (terminal) =>
			agentRecords.get(`${terminal.workspaceId} ${terminal.tabKey}`) ?? null,
		setAgentRecord: () => {},
		onTerminal: (handler) => {
			terminalObserver = handler;
		},
		terminals: () => [],
		workspaceForProcess: () => null,
		revivePrefill: (
			_hook: (terminal: TerminalRef, record: TerminalAgentRecord) => RevivePrefill | null,
		) => {},
		writeTerminal: () => {},
		sendToSession: async () => {},
		projects: () => [],
		workspaces: (): readonly Workspace[] => [],
		workspace: () => null,
		watchWorkspace: async () => {},
		onWorkspace: (handler) => {
			workspaceObserver = handler;
		},
		onFsChanged: (_handler: (payload: WorkspaceFsChangedPayload) => void) => {},
		suggestWorkspaceName: () => {},
		settings: () => ({}),
		onSettings: () => {},
		readState: (name, fallback) =>
			state.has(name) ? (state.get(name) as typeof fallback) : fallback,
		writeState: (name, value) => state.set(name, value),
		git: async () => ({ ok: true, out: "", err: "" }),
		dependency: (() => ({
			async request() {
				throw new Error("no dependency in this test");
			},
			subscribe: () => () => {},
		})) as PluginHostContext<Contract>["dependency"],
	};

	return {
		ctx,
		methods,
		tools,
		published,
		setAgentRecord: (terminal: TerminalRef, record: TerminalAgentRecord) =>
			agentRecords.set(`${terminal.workspaceId} ${terminal.tabKey}`, record),
		fireTerminalEvent: (event: TerminalEvent) => terminalObserver?.(event),
		fireWorkspaceEvent: (event: WorkspaceEvent) => workspaceObserver?.(event),
	};
}

test("the visualize tool draws, publishes the workspace's map, and get reads it back", async () => {
	const fake = fakeContext();
	await host.activate(fake.ctx);

	const tool = fake.tools.find((t) => t.name === "visualize");
	if (!tool) throw new Error("visualize tool not registered");

	const drawing = tool.run(
		{ type: "diagram", title: "Wired", mermaid: "graph TD;A-->B;" },
		{ cwd: "/tmp", workspaceId: "w1", terminal: { workspaceId: "w1", tabKey: "t1" } },
	);
	const report = fake.methods.get("report");
	if (!report) throw new Error("report method not registered");
	report({ workspaceId: "w1", tabKey: "t1", revision: 1 });
	const drawn = await drawing;
	expect(drawn.isError).toBeUndefined();
	expect(fake.published.at(-1)).toEqual({
		workspaceId: "w1",
		visualizations: {
			t1: {
				title: "Wired",
				args: { type: "diagram", title: "Wired", mermaid: "graph TD;A-->B;" },
				revision: 1,
			},
		},
	});

	const get = fake.methods.get("get");
	if (!get) throw new Error("get method not registered");
	expect(get({ workspaceId: "w1" })).toEqual({
		workspaceId: "w1",
		visualizations: {
			t1: {
				title: "Wired",
				args: { type: "diagram", title: "Wired", mermaid: "graph TD;A-->B;" },
				revision: 1,
			},
		},
	});
});

test("a resumed session adopts its drawing when the terminal reports agentChanged", async () => {
	const fake = fakeContext();
	await host.activate(fake.ctx);

	const tool = fake.tools.find((t) => t.name === "visualize");
	if (!tool) throw new Error("visualize tool not registered");
	const drawing = tool.run(
		{ type: "diagram", title: "Kept", mermaid: "graph TD;A;" },
		{ cwd: "/tmp", workspaceId: "w1", terminal: { workspaceId: "w1", tabKey: "t1" } },
	);
	fake.methods.get("report")?.({ workspaceId: "w1", tabKey: "t1", revision: 1 });
	await drawing;

	fake.fireTerminalEvent({
		kind: "agentChanged",
		terminal: { workspaceId: "w1", tabKey: "t1" },
		record: { sessionId: "sess-1" } as TerminalAgentRecord,
	});

	fake.fireTerminalEvent({
		kind: "agentChanged",
		terminal: { workspaceId: "w1", tabKey: "t9" },
		record: { sessionId: "sess-1" } as TerminalAgentRecord,
	});

	const get = fake.methods.get("get");
	expect(get?.({ workspaceId: "w1" })).toEqual({
		workspaceId: "w1",
		visualizations: {
			t1: {
				title: "Kept",
				args: { type: "diagram", title: "Kept", mermaid: "graph TD;A;" },
				revision: 1,
			},
			t9: {
				title: "Kept",
				args: { type: "diagram", title: "Kept", mermaid: "graph TD;A;" },
				revision: 1,
			},
		},
	});
});

test("removing a workspace forgets its drawings", async () => {
	const fake = fakeContext();
	await host.activate(fake.ctx);
	const tool = fake.tools.find((t) => t.name === "visualize");
	if (!tool) throw new Error("visualize tool not registered");
	const drawing = tool.run(
		{ type: "diagram", mermaid: "graph TD;A;" },
		{ cwd: "/tmp", workspaceId: "w1", terminal: { workspaceId: "w1", tabKey: "t1" } },
	);
	fake.methods.get("report")?.({ workspaceId: "w1", tabKey: "t1", revision: 1 });
	await drawing;

	fake.fireWorkspaceEvent({ kind: "removed", projectId: "p1", id: "w1" });

	const get = fake.methods.get("get");
	expect(get?.({ workspaceId: "w1" })).toEqual({ workspaceId: "w1", visualizations: {} });
});
