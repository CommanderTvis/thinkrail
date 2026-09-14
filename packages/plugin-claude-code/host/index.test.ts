import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	TerminalAgentRecord,
	Workspace,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import type { TerminalRef } from "@thinkrail/plugin-api";
import type {
	PluginCall,
	PluginHostContext,
	RevivePrefill,
	TerminalEvent,
	WorkspaceEvent,
} from "@thinkrail/plugin-api/host";
import type { claudeCodeContract } from "../contracts";
import host from "./index";

type Contract = typeof claudeCodeContract;
type Method = (params: unknown, call: PluginCall) => unknown;

let home: string;
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

beforeEach(() => {
	// The IDE bridge writes a discovery lock file under `<CLAUDE_CONFIG_DIR>/ide/` on activate — isolated
	// so activating this plugin in a test never touches the developer's own `~/.claude`.
	home = mkdtempSync(join(tmpdir(), "plugin-claude-code-host-"));
	process.env.CLAUDE_CONFIG_DIR = home;
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
});

function fakeContext(workspaces: Record<string, Workspace> = {}) {
	const methods = new Map<string, Method>();
	let route: ((request: Request, subpath: string) => Response | Promise<Response>) | undefined;
	const published: { channel: string; payload: unknown; target?: PluginCall }[] = [];
	const records = new Map<string, TerminalAgentRecord | null>();
	const suggestions: { workspaceId: string; hint: { prompt?: string; turn?: string } }[] = [];
	let terminalObserver: ((event: TerminalEvent) => void) | undefined;
	let workspaceObserver: ((event: WorkspaceEvent) => void) | undefined;
	let reviveHook:
		| ((terminal: TerminalRef, record: TerminalAgentRecord) => RevivePrefill | null)
		| undefined;
	let terminalEnvContributor: ((terminal: TerminalRef) => Record<string, string>) | undefined;
	const terminals: (TerminalRef & { pid: number | null })[] = [];
	const key = (t: TerminalRef) => `${t.workspaceId} ${t.tabKey}`;

	const ctx: PluginHostContext<Contract> = {
		id: "claude-code",
		log: { debug() {}, info() {}, warn() {}, error() {} },
		assetsDir: null,
		method: (name, handler) => methods.set(name as string, handler as Method),
		publish: (channel, payload, target) => {
			published.push(
				target
					? { channel: channel as string, payload, target }
					: { channel: channel as string, payload },
			);
		},
		route: (handler) => {
			route = handler;
		},
		externalFiles: () => {},
		publicBaseUrl: () => "http://localhost:0",
		tool: () => {},
		terminalEnv: (fn) => {
			terminalEnvContributor = fn;
		},
		terminalToken: (terminal) => `token:${key(terminal)}`,
		terminalForToken: (token) => {
			const found = token.startsWith("token:") ? token.slice("token:".length) : null;
			if (!found) return null;
			const [workspaceId, tabKey] = found.split(" ");
			return workspaceId && tabKey ? { workspaceId, tabKey } : null;
		},
		agentRecord: (terminal) => records.get(key(terminal)) ?? null,
		setAgentRecord: (terminal, record) => records.set(key(terminal), record),
		onTerminal: (handler) => {
			terminalObserver = handler;
		},
		terminals: () => terminals,
		workspaceForProcess: () => null,
		revivePrefill: (hook) => {
			reviveHook = hook;
		},
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
		suggestWorkspaceName: (workspaceId, hint) => suggestions.push({ workspaceId, hint }),
		settings: () => ({ command: "claude" }),
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
		getRoute: () => route,
		published,
		records,
		terminals,
		suggestions,
		fireTerminalEvent: (event: TerminalEvent) => terminalObserver?.(event),
		fireWorkspaceEvent: (event: WorkspaceEvent) => workspaceObserver?.(event),
		getRevivePrefill: (terminal: TerminalRef, record: TerminalAgentRecord) =>
			reviveHook?.(terminal, record) ?? null,
		getTerminalEnv: (terminal: TerminalRef) => terminalEnvContributor?.(terminal) ?? {},
	};
}

test("the status route resolves a token, updates the agent record, and publishes", async () => {
	const { ctx, getRoute, published, records } = fakeContext();
	const disposer = await host.activate(ctx);
	try {
		const route = getRoute();
		if (!route) throw new Error("route not registered");
		const token = ctx.terminalToken({ workspaceId: "ws1", tabKey: "t1" });

		const unknown = await route(
			new Request("http://x/status/nope", { method: "POST" }),
			"status/nope",
		);
		expect(unknown.status).toBe(404);

		const ok = await route(
			new Request(`http://x/status/${token}`, {
				method: "POST",
				body: JSON.stringify({ event: "prompt_submit", session_id: "s1", query: "hi" }),
			}),
			`status/${token}`,
		);
		expect(await ok.text()).toBe("ok");
		expect(records.get("ws1 t1")).toEqual({ kind: "claude", command: "claude", sessionId: "s1" });
		expect(published).toEqual([
			{
				channel: "status",
				payload: {
					workspaceId: "ws1",
					tabKey: "t1",
					status: "running",
					report: { event: "prompt_submit", session_id: "s1", query: "hi" },
				},
			},
		]);
	} finally {
		if (typeof disposer === "function") await disposer();
	}
});

test("usage is read from the transcript path Claude Code reports, wherever its config dir is", async () => {
	const { ctx, getRoute, published } = fakeContext();
	const disposer = await host.activate(ctx);
	try {
		const route = getRoute();
		if (!route) throw new Error("route not registered");
		const token = ctx.terminalToken({ workspaceId: "ws1", tabKey: "t1" });
		const dir = join(home, "elsewhere", "projects", "-p");
		mkdirSync(dir, { recursive: true });
		const transcript = join(dir, "s1.jsonl");
		writeFileSync(
			transcript,
			`${JSON.stringify({
				type: "assistant",
				message: { id: "m1", usage: { input_tokens: 7, output_tokens: 300 } },
			})}\n`,
		);

		await route(
			new Request(`http://x/status/${token}`, {
				method: "POST",
				body: JSON.stringify({ event: "stop", session_id: "s1", transcript_path: transcript }),
			}),
			`status/${token}`,
		);
		expect(published.at(-1)?.payload).toMatchObject({
			usage: { input: 7, output: 300, cacheRead: 0, cacheWrite: 0 },
		});
	} finally {
		if (typeof disposer === "function") await disposer();
	}
});

test("statusSnapshot answers with one row per tab that has reported", async () => {
	const { ctx, getRoute, methods } = fakeContext();
	const disposer = await host.activate(ctx);
	try {
		const route = getRoute();
		if (!route) throw new Error("route not registered");
		const token = ctx.terminalToken({ workspaceId: "ws1", tabKey: "t1" });
		await route(
			new Request(`http://x/status/${token}`, {
				method: "POST",
				body: JSON.stringify({ event: "session_start" }),
			}),
			`status/${token}`,
		);
		const statusSnapshot = methods.get("statusSnapshot");
		if (!statusSnapshot) throw new Error("statusSnapshot not registered");
		expect(await statusSnapshot({ workspaceId: "ws1" }, { clientKey: "c" })).toEqual([
			{ workspaceId: "ws1", tabKey: "t1", status: "idle", report: { event: "session_start" } },
		]);
	} finally {
		if (typeof disposer === "function") await disposer();
	}
});

test("prompt_submit and stop feed workspace auto-naming", async () => {
	const { ctx, getRoute, suggestions } = fakeContext();
	const disposer = await host.activate(ctx);
	try {
		const route = getRoute();
		if (!route) throw new Error("route not registered");
		const token = ctx.terminalToken({ workspaceId: "ws1", tabKey: "t1" });
		await route(
			new Request(`http://x/status/${token}`, {
				method: "POST",
				body: JSON.stringify({ event: "stop", query: "do the thing", response: "done" }),
			}),
			`status/${token}`,
		);
		expect(suggestions).toEqual([
			{ workspaceId: "ws1", hint: { prompt: "do the thing", turn: "done" } },
		]);
	} finally {
		if (typeof disposer === "function") await disposer();
	}
});

test("the revive hook offers a resume command only for a claude-kind record", async () => {
	const workspace: Workspace = {
		id: "ws1",
		projectId: "p1",
		name: "ws",
		branch: "b",
		worktreePath: process.cwd(),
		baseBranch: "main",
	};
	const { ctx, getRevivePrefill } = fakeContext({ ws1: workspace });
	const disposer = await host.activate(ctx);
	try {
		expect(
			getRevivePrefill({ workspaceId: "ws1", tabKey: "t1" }, { kind: "pi", command: "pi" }),
		).toBeNull();
		const offer = getRevivePrefill(
			{ workspaceId: "ws1", tabKey: "t1" },
			{ kind: "claude", command: "claude --chrome" },
		);
		expect(offer).toEqual({ text: "claude --chrome --continue" });
	} finally {
		if (typeof disposer === "function") await disposer();
	}
});

test("terminalEnv contributes the status URL under this plugin's route", async () => {
	const { ctx, getTerminalEnv } = fakeContext();
	const disposer = await host.activate(ctx);
	try {
		const terminal = { workspaceId: "ws1", tabKey: "t1" };
		const env = getTerminalEnv(terminal);
		expect(env.THINKRAIL_AGENT_STATUS_URL).toBe(
			`http://localhost:0/plugin/claude-code/status/${ctx.terminalToken(terminal)}`,
		);
	} finally {
		if (typeof disposer === "function") await disposer();
	}
});

test("pluginUninstallPlan composes the command from the plugin's own settings, not core config", async () => {
	const { ctx, methods } = fakeContext();
	const disposer = await host.activate(ctx);
	try {
		const plan = methods.get("pluginUninstallPlan");
		if (!plan) throw new Error("pluginUninstallPlan not registered");
		expect(
			await plan(
				{ workspaceId: "ws1", name: "warp@claude-code-warp", scope: "user" },
				{ clientKey: "c" },
			),
		).toEqual({
			command: [
				"claude",
				"plugin",
				"uninstall",
				"warp@claude-code-warp",
				"--scope",
				"user",
				"--yes",
			],
		});
	} finally {
		if (typeof disposer === "function") await disposer();
	}
});
