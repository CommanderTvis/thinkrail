import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import type { blueprintContract } from "../contracts";
import host from "./index";

type Contract = typeof blueprintContract;

interface Fake {
	ctx: PluginHostContext<Contract>;
	methods: Map<string, (params: unknown) => unknown>;
	tools: PluginToolDefinition[];
	published: unknown[];
	terminalWrites: { terminal: TerminalRef; data: string }[];
	sentToSessions: { sessionId: string; text: string }[];
	fireFsChanged: (payload: WorkspaceFsChangedPayload) => void;
	fireTerminalEvent: (event: TerminalEvent) => void;
	revive: (terminal: TerminalRef, record: TerminalAgentRecord) => RevivePrefill | null;
	graphNodes: { id: string; path: string }[];
}

function fakeContext(workspaces: Record<string, Workspace>): Fake {
	const methods = new Map<string, (params: unknown) => unknown>();
	const tools: PluginToolDefinition[] = [];
	const published: unknown[] = [];
	const terminalWrites: { terminal: TerminalRef; data: string }[] = [];
	const sentToSessions: { sessionId: string; text: string }[] = [];
	const state = new Map<string, unknown>();
	let fsObserver: ((payload: WorkspaceFsChangedPayload) => void) | undefined;
	let terminalObserver: ((event: TerminalEvent) => void) | undefined;
	let reviveHook:
		| ((terminal: TerminalRef, record: TerminalAgentRecord) => RevivePrefill | null)
		| undefined;
	const graphNodes: { id: string; path: string }[] = [];

	const ctx: PluginHostContext<Contract> = {
		id: "blueprint",
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
		agentRecord: () => null,
		setAgentRecord: () => {},
		onTerminal: (handler) => {
			terminalObserver = handler;
		},
		terminals: () => [],
		workspaceForProcess: () => null,
		revivePrefill: (hook) => {
			reviveHook = hook;
		},
		writeTerminal: (terminal, data) => terminalWrites.push({ terminal, data }),
		sendToSession: async (sessionId, text) => {
			sentToSessions.push({ sessionId, text });
		},
		projects: () => [],
		workspaces: () => Object.values(workspaces),
		workspace: (id) => workspaces[id] ?? null,
		watchWorkspace: async () => {},
		onWorkspace: (_handler: (event: WorkspaceEvent) => void) => {},
		onFsChanged: (handler) => {
			fsObserver = handler;
		},
		suggestWorkspaceName: () => {},
		settings: () => ({}),
		onSettings: () => {},
		readState: (name, fallback) =>
			state.has(name) ? (state.get(name) as typeof fallback) : fallback,
		writeState: (name, value) => state.set(name, value),
		git: async () => ({ ok: true, out: "", err: "" }),
		dependency: (() => ({
			async request() {
				return {
					nodes: graphNodes.map((n) => ({
						...n,
						type: "task-spec",
						title: n.id,
						dependsOn: [],
						references: [],
						implements: [],
						tags: [],
					})),
				};
			},
			subscribe: () => () => {},
		})) as PluginHostContext<Contract>["dependency"],
	};

	return {
		ctx,
		methods,
		tools,
		published,
		terminalWrites,
		sentToSessions,
		fireFsChanged: (payload) => fsObserver?.(payload),
		fireTerminalEvent: (event) => terminalObserver?.(event),
		revive: (terminal, record) => reviveHook?.(terminal, record) ?? null,
		graphNodes,
	};
}

function workspaceAt(worktreePath: string): Workspace {
	return {
		id: "ws1",
		projectId: "p1",
		name: "ws",
		branch: "b",
		worktreePath,
		baseBranch: "main",
	};
}

test("open writes the record, get reads it back, and select delivers to a chat author", async () => {
	const worktree = mkdtempSync(join(tmpdir(), "plugin-blueprint-"));
	try {
		const fake = fakeContext({ ws1: workspaceAt(worktree) });
		await host.activate(fake.ctx);

		const open = fake.methods.get("open") as (params: unknown) => {
			state: { phase: string };
			opening: string;
			systemPrompt: string;
		};
		const opened = open({
			workspaceId: "ws1",
			source: { kind: "idea", brief: "lights" },
			agentId: "pi",
		});
		expect(opened.state.phase).toBe("awaiting");
		expect(opened.systemPrompt).toContain("BLUEPRINT.md");

		const get = fake.methods.get("get") as (params: unknown) => { state: { phase: string } | null };
		expect(get({ workspaceId: "ws1" }).state?.phase).toBe("awaiting");

		const setAuthor = fake.methods.get("setAuthor") as (params: unknown) => unknown;
		setAuthor({ workspaceId: "ws1", author: { kind: "chat", sessionId: "s1" } });

		writeFileSync(
			join(worktree, "BLUEPRINT.md"),
			"!control select database\n= Postgres — most conventional\n- SQLite — simplest\n",
		);
		fake.fireFsChanged({
			workspaceId: "ws1",
			paths: ["BLUEPRINT.md"],
			truncated: false,
			skillChange: "none",
		});

		const select = fake.methods.get("select") as (params: unknown) => unknown;
		select({ workspaceId: "ws1", controlId: "database", optionId: "sqlite" });

		expect(fake.sentToSessions).toHaveLength(1);
		expect(fake.sentToSessions[0]?.sessionId).toBe("s1");
		expect(fake.sentToSessions[0]?.text).toContain("database is now");
	} finally {
		rmSync(worktree, { recursive: true, force: true });
	}
});

test("select delivers into a terminal author host-side, bypassing client attachment", async () => {
	const worktree = mkdtempSync(join(tmpdir(), "plugin-blueprint-"));
	try {
		const fake = fakeContext({ ws1: workspaceAt(worktree) });
		await host.activate(fake.ctx);

		const open = fake.methods.get("open") as (params: unknown) => unknown;
		open({ workspaceId: "ws1", source: { kind: "idea", brief: "lights" }, agentId: "claude" });
		const setAuthor = fake.methods.get("setAuthor") as (params: unknown) => unknown;
		setAuthor({ workspaceId: "ws1", author: { kind: "terminal", tabKey: "t1" } });

		writeFileSync(
			join(worktree, "BLUEPRINT.md"),
			"!control select database\n= Postgres — most conventional\n- SQLite — simplest\n",
		);
		fake.fireFsChanged({
			workspaceId: "ws1",
			paths: ["BLUEPRINT.md"],
			truncated: false,
			skillChange: "none",
		});

		const select = fake.methods.get("select") as (params: unknown) => unknown;
		select({ workspaceId: "ws1", controlId: "database", optionId: "sqlite" });

		expect(fake.terminalWrites).toHaveLength(1);
		expect(fake.terminalWrites[0]?.terminal).toEqual({ workspaceId: "ws1", tabKey: "t1" });
		expect(fake.terminalWrites[0]?.data.endsWith("\r")).toBe(true);
	} finally {
		rmSync(worktree, { recursive: true, force: true });
	}
});

test("a terminal reporting its agent session records it onto the terminal author", async () => {
	const worktree = mkdtempSync(join(tmpdir(), "plugin-blueprint-"));
	try {
		const fake = fakeContext({ ws1: workspaceAt(worktree) });
		await host.activate(fake.ctx);

		(fake.methods.get("open") as (params: unknown) => unknown)({
			workspaceId: "ws1",
			source: { kind: "idea", brief: "lights" },
			agentId: "claude",
		});
		(fake.methods.get("setAuthor") as (params: unknown) => unknown)({
			workspaceId: "ws1",
			author: { kind: "terminal", tabKey: "t1" },
		});

		fake.fireTerminalEvent({
			kind: "agentChanged",
			terminal: { workspaceId: "ws1", tabKey: "t1" },
			record: { kind: "claude", command: "claude", sessionId: "sess-1" },
		});

		const get = fake.methods.get("get") as (params: unknown) => {
			state: { author: { agentSessionId?: string } | null } | null;
		};
		expect(get({ workspaceId: "ws1" }).state?.author?.agentSessionId).toBe("sess-1");

		expect(
			fake.revive(
				{ workspaceId: "ws1", tabKey: "t1" },
				{ kind: "claude", command: "claude", sessionId: "sess-1" },
			),
		).toEqual({ submit: true });
	} finally {
		rmSync(worktree, { recursive: true, force: true });
	}
});

test("blueprint_check registers on both the agent and mcp surfaces, and flags an unindexed document", async () => {
	const worktree = mkdtempSync(join(tmpdir(), "plugin-blueprint-"));
	try {
		const fake = fakeContext({ ws1: workspaceAt(worktree) });
		await host.activate(fake.ctx);

		const tool = fake.tools.find((t) => t.name === "blueprint_check");
		if (!tool) throw new Error("blueprint_check not registered");
		expect(tool.surfaces).toEqual(["agent", "mcp"]);

		const missing = await tool.run({}, { cwd: worktree, workspaceId: "ws1" });
		expect(missing.isError).toBe(true);

		writeFileSync(
			join(worktree, "BLUEPRINT.md"),
			"!control select database\n= Postgres — most conventional\n",
		);
		const unindexed = await tool.run({}, { cwd: worktree, workspaceId: "ws1" });
		expect(unindexed.text).toContain("is not indexed as a spec yet");

		fake.graphNodes.push({ id: "the-spec", path: "BLUEPRINT.md" });
		const indexed = await tool.run({}, { cwd: worktree, workspaceId: "ws1" });
		expect(indexed.text).not.toContain("is not indexed as a spec yet");
	} finally {
		rmSync(worktree, { recursive: true, force: true });
	}
});
