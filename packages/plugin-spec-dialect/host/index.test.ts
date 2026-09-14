import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import type { specDialectContract } from "../contracts";
import host from "./index";

type Contract = typeof specDialectContract;

function fakeContext(workspaces: Record<string, Workspace>): {
	ctx: PluginHostContext<Contract>;
	methods: Map<string, (params: unknown) => unknown>;
	tools: PluginToolDefinition[];
	fireWorkspaceEvent: (event: WorkspaceEvent) => void;
} {
	const methods = new Map<string, (params: unknown) => unknown>();
	const tools: PluginToolDefinition[] = [];
	let workspaceObserver: ((event: WorkspaceEvent) => void) | undefined;
	const ctx: PluginHostContext<Contract> = {
		id: "spec-dialect",
		log: { debug() {}, info() {}, warn() {}, error() {} },
		assetsDir: null,
		method: (name, handler) => methods.set(name as string, handler as (params: unknown) => unknown),
		publish: () => {},
		route: () => {},
		publicBaseUrl: () => "http://localhost:0",
		tool: (definition) => tools.push(definition),
		terminalEnv: () => {},
		terminalToken: () => "token",
		terminalForToken: () => null,
		agentRecord: () => null,
		setAgentRecord: () => {},
		onTerminal: (_handler: (event: TerminalEvent) => void) => {},
		terminals: () => [],
		workspaceForProcess: () => null,
		revivePrefill: (
			_hook: (terminal: TerminalRef, record: TerminalAgentRecord) => RevivePrefill | null,
		) => {},
		writeTerminal: () => {},
		sendToSession: async () => {},
		projects: () => [],
		workspaces: () => Object.values(workspaces),
		workspace: (id) => workspaces[id] ?? null,
		watchWorkspace: async () => {},
		onWorkspace: (handler) => {
			workspaceObserver = handler;
		},
		onFsChanged: (_handler: (payload: WorkspaceFsChangedPayload) => void) => {},
		suggestWorkspaceName: () => {},
		settings: () => ({}),
		onSettings: () => {},
		readState: (_name, fallback) => fallback,
		writeState: () => {},
		git: async () => ({ ok: true, out: "", err: "" }),
		dependency: () => {
			throw new Error("not exercised");
		},
	};
	return {
		ctx,
		methods,
		tools,
		fireWorkspaceEvent: (event) => workspaceObserver?.(event),
	};
}

function writeSpec(root: string, rel: string, frontmatter: string): void {
	mkdirSync(join(root, rel, ".."), { recursive: true });
	writeFileSync(join(root, rel), `---\n${frontmatter}\n---\n\n## Body\n\nProse.\n`);
}

test("graph maps the worktree's spec files, and the mcp tools register", async () => {
	const worktree = mkdtempSync(join(tmpdir(), "plugin-spec-dialect-"));
	try {
		writeSpec(
			worktree,
			"SPEC.md",
			"id: root\ntype: goal-and-requirements\ntitle: Root\nstatus: active\ndependsOn: []",
		);
		const workspace: Workspace = {
			id: "ws1",
			projectId: "p1",
			name: "ws",
			branch: "b",
			worktreePath: worktree,
			baseBranch: "main",
		};
		const { ctx, methods, tools } = fakeContext({ ws1: workspace });
		const disposer = await host.activate(ctx);

		const graph = methods.get("graph");
		if (!graph) throw new Error("graph method not registered");
		const snapshot = (await graph({ workspaceId: "ws1" })) as { nodes: { id: string }[] };
		expect(snapshot.nodes.map((node) => node.id)).toEqual(["root"]);

		const mcpTools = tools.filter((tool) => tool.surfaces.includes("mcp"));
		expect(mcpTools.map((tool) => tool.name)).toEqual([
			"spec_grep",
			"spec_get",
			"spec_graph",
			"spec_create",
			"spec_update",
			"spec_delete",
			"spec_validate",
		]);
		expect(tools.every((tool) => !tool.surfaces.includes("agent"))).toBe(true);

		if (typeof disposer === "function") await disposer();
	} finally {
		rmSync(worktree, { recursive: true, force: true });
	}
});

test("graph rejects an unknown workspace", async () => {
	const { ctx, methods } = fakeContext({});
	await host.activate(ctx);
	const graph = methods.get("graph");
	if (!graph) throw new Error("graph method not registered");
	await expect(graph({ workspaceId: "ghost" })).rejects.toThrow("Unknown workspace: ghost");
});

test("removing a workspace evicts its cached index", async () => {
	const worktreeA = mkdtempSync(join(tmpdir(), "plugin-spec-dialect-a-"));
	const worktreeB = mkdtempSync(join(tmpdir(), "plugin-spec-dialect-b-"));
	try {
		writeSpec(worktreeA, "SPEC.md", "id: a\ntype: goal-and-requirements\ntitle: A");
		const workspace: Workspace = {
			id: "ws1",
			projectId: "p1",
			name: "ws",
			branch: "b",
			worktreePath: worktreeA,
			baseBranch: "main",
		};
		const workspaces: Record<string, Workspace> = { ws1: workspace };
		const { ctx, methods, fireWorkspaceEvent } = fakeContext(workspaces);
		await host.activate(ctx);
		const graph = methods.get("graph") as (params: { workspaceId: string }) => Promise<{
			nodes: { id: string }[];
		}>;

		expect((await graph({ workspaceId: "ws1" })).nodes.map((n) => n.id)).toEqual(["a"]);

		fireWorkspaceEvent({ kind: "removed", projectId: "p1", id: "ws1" });
		writeSpec(worktreeB, "SPEC.md", "id: b\ntype: goal-and-requirements\ntitle: B");
		workspaces.ws1 = { ...workspace, worktreePath: worktreeB };

		expect((await graph({ workspaceId: "ws1" })).nodes.map((n) => n.id)).toEqual(["b"]);
	} finally {
		rmSync(worktreeA, { recursive: true, force: true });
		rmSync(worktreeB, { recursive: true, force: true });
	}
});
