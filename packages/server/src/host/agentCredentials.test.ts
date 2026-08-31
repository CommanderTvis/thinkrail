import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentAuthOutcome } from "../agent";
import type { ProviderRouting } from "../auth";
import { openProject } from "../projects";
import { listTerminals, resetTerminalState } from "../terminal";
import {
	type AgentCredentialsPort,
	type AuthTerminalWorkspace,
	createAgentCredentialsResolver,
	firstOpenWorkspace,
} from "./agentCredentials";

function gitRun(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function makeRepo(path: string): void {
	mkdirSync(path, { recursive: true });
	gitRun(path, "init", "-b", "main");
	gitRun(path, "config", "user.email", "t@thinkrail.test");
	gitRun(path, "config", "user.name", "test");
	writeFileSync(join(path, "README.md"), "# repo\n");
	gitRun(path, "add", "-A");
	gitRun(path, "commit", "-m", "init");
}

let root: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "thinkrail-agent-credentials-"));
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
});

afterEach(() => {
	resetTerminalState();
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	rmSync(root, { recursive: true, force: true });
});

interface Recorded {
	authenticated: { agentId: string; methodId: string; env: Record<string, string> | undefined }[];
	loggedOut: { agentId: string; methodId: string | undefined }[];
	routed: { agentId: string; routing: ProviderRouting }[];
	disabled: { agentId: string; providerId: string }[];
}

function recorder(): Recorded {
	return { authenticated: [], loggedOut: [], routed: [], disabled: [] };
}

function fakePort(
	recorded: Recorded,
	outcome: AgentAuthOutcome = { kind: "handled" },
): AgentCredentialsPort {
	return {
		authMethodsFor: async () => [{ id: "oauth", name: "Sign in", kind: "agent" }],
		async authenticate(agentId, methodId, env) {
			recorded.authenticated.push({ agentId, methodId, env });
			return outcome;
		},
		async logout(agentId, methodId) {
			recorded.loggedOut.push({ agentId, methodId });
		},
		listProvidersFor: async () => [
			{ id: "main", required: true, configured: true, protocols: ["anthropic"] },
		],
		async setProvider(agentId, routing) {
			recorded.routed.push({ agentId, routing });
		},
		async disableProvider(agentId, providerId) {
			recorded.disabled.push({ agentId, providerId });
		},
	};
}

test("every operation threads the resolved agent id through to the port", async () => {
	const recorded = recorder();
	const resolver = createAgentCredentialsResolver(fakePort(recorded), async () => undefined);
	const credentials = await resolver("thinkrail-pi");

	expect(await credentials.authMethods()).toEqual([
		{ id: "oauth", name: "Sign in", kind: "agent" },
	]);
	expect(await credentials.listProviders()).toEqual([
		{ id: "main", required: true, configured: true, protocols: ["anthropic"] },
	]);

	await credentials.logout("oauth");
	await credentials.setProvider({
		providerId: "main",
		apiType: "anthropic",
		baseUrl: "https://api.anthropic.com",
	});
	await credentials.disableProvider("spare");

	expect(recorded.loggedOut).toEqual([{ agentId: "thinkrail-pi", methodId: "oauth" }]);
	expect(recorded.routed).toEqual([
		{
			agentId: "thinkrail-pi",
			routing: { providerId: "main", apiType: "anthropic", baseUrl: "https://api.anthropic.com" },
		},
	]);
	expect(recorded.disabled).toEqual([{ agentId: "thinkrail-pi", providerId: "spare" }]);
});

test("authenticate answers ok when the port already handled the method", async () => {
	const recorded = recorder();
	const resolver = createAgentCredentialsResolver(fakePort(recorded), async () => undefined);
	const credentials = await resolver("thinkrail-pi");

	const result = await credentials.authenticate({ methodId: "oauth", env: { KEY: "value" } });

	expect(result).toEqual({ outcome: "ok" });
	expect(recorded.authenticated).toEqual([
		{ agentId: "thinkrail-pi", methodId: "oauth", env: { KEY: "value" } },
	]);
});

test("authenticate opens a real terminal in the first open workspace for a terminal outcome", async () => {
	const repo = join(root, "repo");
	makeRepo(repo);
	openProject(repo);

	const recorded = recorder();
	const outcome: AgentAuthOutcome = {
		kind: "terminal",
		command: "ls",
		args: [],
		env: { AGENT_AUTH_MODE: "interactive" },
	};
	const resolver = createAgentCredentialsResolver(fakePort(recorded, outcome), firstOpenWorkspace);
	const credentials = await resolver("thinkrail-pi");

	const result = await credentials.authenticate({ methodId: "tui" });
	if (result.outcome !== "terminal")
		throw new Error(`expected a terminal outcome, got ${result.outcome}`);

	const workspace = await firstOpenWorkspace();
	expect(workspace?.id).toBeDefined();
	expect(result.workspaceId).toBe(workspace?.id ?? "");
	expect(listTerminals(result.workspaceId).some((tab) => tab.tabKey.startsWith("agent:"))).toBe(
		true,
	);
});

test("authenticate fails clearly, rather than crashing, when no project is open for a terminal outcome", async () => {
	const recorded = recorder();
	const outcome: AgentAuthOutcome = { kind: "terminal", command: "ls", args: [], env: {} };
	const resolver = createAgentCredentialsResolver(
		fakePort(recorded, outcome),
		async () => undefined,
	);
	const credentials = await resolver("thinkrail-pi");

	await expect(credentials.authenticate({ methodId: "tui" })).rejects.toThrow(/open/i);
});

test("firstOpenWorkspace reports nothing when no project has ever been opened", async () => {
	expect(await firstOpenWorkspace()).toBeUndefined();
});

test("firstOpenWorkspace resolves the default workspace of the first known project", async () => {
	const repo = join(root, "repo");
	makeRepo(repo);
	openProject(repo);

	const workspace: AuthTerminalWorkspace | undefined = await firstOpenWorkspace();
	expect(workspace).toBeDefined();
	expect(workspace?.cwd).toBe(realpathSync(repo));
});
