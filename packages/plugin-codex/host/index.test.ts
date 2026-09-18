import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalAgentRecord } from "@thinkrail/contracts";
import type { PluginHostContext, RevivePrefill } from "@thinkrail/plugin-api/host";
import type { CodexStatusPush, codexContract } from "../contracts";
import host from "./index";

type Context = PluginHostContext<typeof codexContract>;

let previousHome: string | undefined;
let home: string;
beforeEach(() => {
	previousHome = process.env.CODEX_HOME;
	home = mkdtempSync(join(tmpdir(), "tr-cx-"));
	process.env.CODEX_HOME = home;
});
afterEach(() => {
	if (previousHome === undefined) delete process.env.CODEX_HOME;
	else process.env.CODEX_HOME = previousHome;
	rmSync(home, { recursive: true, force: true });
});

function context(initial: TerminalAgentRecord | null = null) {
	const terminal = { workspaceId: "workspace", tabKey: "terminal" };
	let record = initial;
	let route: Parameters<Context["route"]>[0] | undefined;
	let revive: Parameters<Context["revivePrefill"]>[0] | undefined;
	const published: unknown[] = [];
	const ctx: Context = {
		id: "codex",
		assetsDir: null,
		log: { debug() {}, info() {}, warn() {}, error() {} },
		method() {},
		publish: (_channel, payload) => {
			published.push(payload);
		},
		route: (handler) => {
			route = handler;
		},
		publicBaseUrl: () => "http://localhost:0",
		tool() {},
		externalFiles() {},
		terminalEnv() {},
		terminalToken: () => "token",
		terminalForToken: (token) => (token === "token" ? terminal : null),
		agentRecord: () => record,
		setAgentRecord: (_terminal, next) => {
			record = next;
		},
		onTerminal() {},
		terminals: () => [],
		workspaceForProcess: () => null,
		revivePrefill: (handler) => {
			revive = handler;
		},
		writeTerminal() {},
		sendToSession: async () => {},
		projects: () => [],
		workspaces: () => [],
		workspace: () => null,
		watchWorkspace: async () => {},
		onWorkspace() {},
		onFsChanged() {},
		suggestWorkspaceName() {},
		settings: () => ({ command: "codex --model configured", mcp: false }),
		onSettings() {},
		readState: (_name, fallback) => fallback,
		writeState() {},
		git: async () => ({ ok: true, out: "", err: "" }),
		dependency: () => {
			throw new Error("unused");
		},
	};
	return {
		ctx,
		record: () => record,
		published,
		revive: (agent: TerminalAgentRecord): RevivePrefill | null => revive?.(terminal, agent) ?? null,
		report: (extra: Record<string, unknown> = {}) =>
			route?.(
				new Request("http://localhost/status/token", {
					method: "POST",
					body: JSON.stringify({
						hook_event_name: "SessionStart",
						session_id: "codex-session",
						...extra,
					}),
				}),
				"status/token",
			),
	};
}

test("revive registration filters agent kinds and offers an editable, normalized fallback", async () => {
	const fixture = context();
	const dispose = await host.activate(fixture.ctx);
	try {
		expect(fixture.revive({ kind: "claude", command: "claude" })).toBeNull();
		expect(
			fixture.revive({
				kind: "codex",
				command: "codex resume stale old-prompt -m model",
				sessionId: "unsaved",
			}),
		).toEqual({ text: "codex -m model resume --last" });
		expect(fixture.revive({ kind: "codex", command: "codex --model" })).toBeNull();
	} finally {
		await dispose?.();
	}
});

test("a Codex hook replaces another agent's record without inheriting its command", async () => {
	const fixture = context({
		kind: "claude",
		command: "claude --model opus",
		sessionId: "codex-session",
	});
	const dispose = await host.activate(fixture.ctx);
	try {
		expect((await fixture.report())?.status).toBe(200);
		expect(fixture.record()).toEqual({
			kind: "codex",
			command: "codex --model configured",
			sessionId: "codex-session",
		});
	} finally {
		await dispose?.();
	}
});

test("a hook's rollout supplies the session's token totals and plan to the pushed status", async () => {
	const fixture = context();
	const rollout = join(home, "rollout.jsonl");
	writeFileSync(
		rollout,
		[
			{
				type: "response_item",
				payload: {
					type: "function_call",
					name: "update_plan",
					arguments: JSON.stringify({ plan: [{ step: "Fix it", status: "in_progress" }] }),
				},
			},
			{
				type: "event_msg",
				payload: {
					type: "token_count",
					info: {
						total_token_usage: {
							input_tokens: 23611,
							cached_input_tokens: 11008,
							cache_write_input_tokens: 0,
							output_tokens: 33,
						},
					},
				},
			},
		]
			.map((line) => `${JSON.stringify(line)}\n`)
			.join(""),
	);
	const dispose = await host.activate(fixture.ctx);
	try {
		await fixture.report({ hook_event_name: "PostToolUse", transcript_path: rollout });
		expect(fixture.published.at(-1) as CodexStatusPush).toMatchObject({
			status: "running",
			usage: { input: 12603, output: 33, cacheRead: 11008, cacheWrite: 0 },
			plan: [{ content: "Fix it", status: "in_progress" }],
		});
	} finally {
		await dispose?.();
	}
});
