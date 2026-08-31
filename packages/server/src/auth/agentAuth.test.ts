import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentAuthResult, AgentProviderInfo } from "@thinkrail/contracts";
import type { AgentCredentials, ProviderRouting } from "./agentAuth";
import {
	agentAuthMethods,
	agentProviders,
	authenticateAgent,
	disableAgentProvider,
	logoutAgent,
	setAgentCredentials,
	setAgentProvider,
} from "./agentAuth";
import { resetJbcentralStateForTests } from "./jbcentral";

interface Recorded {
	authenticated: { methodId: string; env?: Record<string, string> }[];
	loggedOut: (string | undefined)[];
	routed: ProviderRouting[];
	disabled: string[];
}

let recorded: Recorded;
let root: string;
let priorEnv: Record<string, string | undefined>;

function credentials(overrides: Partial<AgentCredentials> = {}): AgentCredentials {
	return {
		authMethods: async () => [{ id: "oauth", name: "Sign in", kind: "agent" }],
		authenticate: async (input): Promise<AgentAuthResult> => {
			recorded.authenticated.push(input);
			return { outcome: "ok" };
		},
		logout: async (methodId) => {
			recorded.loggedOut.push(methodId);
		},
		listProviders: async (): Promise<AgentProviderInfo[]> => [
			{ id: "main", required: true, configured: true, protocols: ["anthropic"] },
			{ id: "spare", required: false, configured: false, protocols: ["openai"] },
		],
		setProvider: async (routing) => {
			recorded.routed.push(routing);
		},
		disableProvider: async (providerId) => {
			recorded.disabled.push(providerId);
		},
		...overrides,
	};
}

function bind(overrides: Partial<AgentCredentials> = {}): void {
	const bound = credentials(overrides);
	setAgentCredentials(async (agentId) => {
		if (agentId !== "thinkrail-pi") throw new Error(`No agent named "${agentId}" is installed.`);
		return bound;
	});
}

beforeEach(async () => {
	recorded = { authenticated: [], loggedOut: [], routed: [], disabled: [] };
	await resetJbcentralStateForTests();
	root = mkdtempSync(join(tmpdir(), "thinkrail-agent-auth-"));
	priorEnv = { HOME: process.env.HOME, PATH: process.env.PATH };
	mkdirSync(join(root, "bin"), { recursive: true });
	process.env.HOME = root;
	process.env.PATH = join(root, "bin");
});

afterEach(async () => {
	setAgentCredentials(null);
	await resetJbcentralStateForTests();
	for (const [name, value] of Object.entries(priorEnv)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

describe("agent credential reads", () => {
	test("an unreachable agent advertises no auth methods", async () => {
		expect(await agentAuthMethods("ghost")).toEqual([]);

		bind({
			authMethods: async () => {
				throw new Error("synthetic agent fault");
			},
		});
		expect(await agentAuthMethods("thinkrail-pi")).toEqual([]);
	});

	test("an unreachable agent reports no providers and no Central half", async () => {
		const report = await agentProviders("ghost");
		expect(report.providers).toEqual([]);
		expect(report.jbcentral).toBeUndefined();
		expect(report.jbcentralInstall).toBeUndefined();
	});

	test("Central rides only on the agent whose profile actually uses it", async () => {
		bind();
		const pi = await agentProviders("thinkrail-pi");
		expect(pi.providers.map((provider) => provider.id)).toEqual(["main", "spare"]);
		expect(pi.jbcentral?.state).toBe("absent");
		expect(pi.jbcentralInstall?.platform).toBe(process.platform);

		setAgentCredentials(async () => credentials());
		const junie = await agentProviders("junie");
		expect(junie.providers.map((provider) => provider.id)).toEqual(["main", "spare"]);
		expect(junie.jbcentral).toBeUndefined();
		expect(junie.jbcentralInstall).toBeUndefined();
	});
});

describe("agent credential writes", () => {
	test("authenticate forwards the collected env and never echoes it back", async () => {
		bind();
		const result = await authenticateAgent({
			agentId: "thinkrail-pi",
			methodId: "env",
			env: { OPENAI_API_KEY: "synthetic-test-value" },
		});
		expect(result).toEqual({ outcome: "ok" });
		expect(recorded.authenticated).toEqual([
			{ methodId: "env", env: { OPENAI_API_KEY: "synthetic-test-value" } },
		]);
		expect(JSON.stringify(result)).not.toContain("synthetic-test-value");
	});

	test("authenticate reports a failure instead of throwing", async () => {
		bind({
			authenticate: async () => {
				throw new Error("no browser available");
			},
		});
		expect(await authenticateAgent({ agentId: "thinkrail-pi", methodId: "oauth" })).toEqual({
			outcome: "failed",
			error: "no browser available",
		});
		expect(await authenticateAgent({ agentId: "ghost", methodId: "oauth" })).toMatchObject({
			outcome: "failed",
		});
	});

	test("authenticate answers the terminal the host opened", async () => {
		bind({
			authenticate: async () => ({
				outcome: "terminal",
				workspaceId: "workspace-1",
				terminalId: "terminal-1",
			}),
		});
		expect(await authenticateAgent({ agentId: "thinkrail-pi", methodId: "tui" })).toEqual({
			outcome: "terminal",
			workspaceId: "workspace-1",
			terminalId: "terminal-1",
		});
	});

	test("logout narrows to one method and surfaces a failure", async () => {
		bind();
		await logoutAgent("thinkrail-pi", "oauth");
		await logoutAgent("thinkrail-pi");
		expect(recorded.loggedOut).toEqual(["oauth", undefined]);
		await expect(logoutAgent("ghost")).rejects.toThrow();
	});

	test("setProvider passes the routing through and surfaces a failure", async () => {
		bind();
		await setAgentProvider("thinkrail-pi", {
			providerId: "main",
			apiType: "anthropic",
			baseUrl: "https://example.invalid",
			headers: { Authorization: "synthetic" },
		});
		expect(recorded.routed).toEqual([
			{
				providerId: "main",
				apiType: "anthropic",
				baseUrl: "https://example.invalid",
				headers: { Authorization: "synthetic" },
			},
		]);
		await expect(
			setAgentProvider("ghost", {
				providerId: "main",
				apiType: "anthropic",
				baseUrl: "https://example.invalid",
			}),
		).rejects.toThrow();
	});

	test("a required provider is refused before it is disabled", async () => {
		bind();
		await expect(disableAgentProvider("thinkrail-pi", "main")).rejects.toThrow(/required/);
		await disableAgentProvider("thinkrail-pi", "spare");
		expect(recorded.disabled).toEqual(["spare"]);
	});
});
