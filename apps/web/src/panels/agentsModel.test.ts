import { describe, expect, test } from "bun:test";
import type { ChatCapabilities, InstalledAgent } from "@thinkrail/contracts";
import {
	agentBannerState,
	formatAgentArgs,
	parseAgentArgs,
	pickSelectedAgentId,
	selectBannerAgent,
	sortInstalledAgents,
} from "./agentsModel";

function agent(patch: Partial<InstalledAgent> & { id: string }): InstalledAgent {
	return {
		name: patch.id,
		origin: "external",
		command: `/usr/bin/${patch.id}`,
		args: [],
		...patch,
	};
}

function caps(patch: Partial<ChatCapabilities>): ChatCapabilities {
	return {
		agent: { id: "a", name: "A", origin: "external" },
		derivedFrom: {},
		imageInput: false,
		embeddedContext: false,
		steering: "none",
		followUp: false,
		slashCommands: false,
		promptTemplates: false,
		modelPicker: false,
		thinkingLevel: false,
		modes: false,
		configRefresh: false,
		cost: false,
		tokenBreakdown: false,
		contextWindow: false,
		plan: "none",
		elicitation: false,
		permissions: false,
		skills: false,
		workflowSkills: false,
		mcpTools: "none",
		fileDelegation: false,
		terminalDelegation: false,
		sessionList: false,
		sessionLoad: false,
		sessionFork: false,
		sessionClose: false,
		retryVisibility: false,
		compactionVisibility: false,
		queueDepth: false,
		authentication: false,
		logout: false,
		providerConfig: false,
		jetbrainsCentral: false,
		...patch,
	};
}

describe("installed agent ordering and selection", () => {
	test("puts the bundled agent first and sorts the rest by name", () => {
		const sorted = sortInstalledAgents([
			agent({ id: "zed", name: "Zed" }),
			agent({ id: "junie", name: "Junie" }),
			agent({ id: "thinkrail-pi", name: "pi", origin: "bundled" }),
		]);
		expect(sorted.map((a) => a.id)).toEqual(["thinkrail-pi", "junie", "zed"]);
	});

	test("keeps the current selection across a reload, else falls back to the default, else the first row", () => {
		const agents = [
			agent({ id: "junie", name: "Junie" }),
			agent({ id: "thinkrail-pi", name: "pi", origin: "bundled" }),
		];
		expect(pickSelectedAgentId(agents, "junie", "thinkrail-pi")).toBe("junie");
		expect(pickSelectedAgentId(agents, "gone", "junie")).toBe("junie");
		expect(pickSelectedAgentId(agents, null, null)).toBe("thinkrail-pi");
		expect(pickSelectedAgentId([], "junie", "junie")).toBeNull();
	});
});

describe("launch arguments round-trip", () => {
	test("splits on whitespace and drops empties", () => {
		expect(parseAgentArgs("  --acp   --port 3000 ")).toEqual(["--acp", "--port", "3000"]);
		expect(parseAgentArgs("   ")).toEqual([]);
		expect(formatAgentArgs(["acp", "--acp=true"])).toBe("acp --acp=true");
	});
});

describe("welcome banner state", () => {
	const installed = [agent({ id: "pi", name: "pi", origin: "bundled" })];

	test("says nothing until the agent list is read", () => {
		expect(
			agentBannerState({ agents: null, resolvedAgentId: "pi", providersConfigured: false }),
		).toEqual({ kind: "none" });
	});

	test("reports no agent when nothing is installed", () => {
		expect(
			agentBannerState({ agents: [], resolvedAgentId: null, providersConfigured: null }),
		).toEqual({ kind: "no-agent", reason: "none-installed" });
	});

	test("reports no agent when the resolved one is unavailable or missing", () => {
		const broken = [agent({ id: "junie", name: "Junie", unavailable: "not on PATH" })];
		expect(selectBannerAgent(broken, "junie")).toBeNull();
		expect(
			agentBannerState({ agents: broken, resolvedAgentId: "junie", providersConfigured: null }),
		).toEqual({ kind: "no-agent", reason: "unavailable" });
		expect(
			agentBannerState({ agents: installed, resolvedAgentId: "gone", providersConfigured: null }),
		).toEqual({ kind: "no-agent", reason: "none-installed" });
	});

	test("reports no agent when it has no configured provider", () => {
		expect(
			agentBannerState({ agents: installed, resolvedAgentId: "pi", providersConfigured: false }),
		).toEqual({ kind: "no-agent", reason: "no-provider" });
	});

	test("stays quiet while providers are unread, connected, or not this agent's concern", () => {
		expect(
			agentBannerState({ agents: installed, resolvedAgentId: "pi", providersConfigured: null }),
		).toEqual({ kind: "none" });
		expect(
			agentBannerState({ agents: installed, resolvedAgentId: "pi", providersConfigured: true }),
		).toEqual({ kind: "none" });
		const selfManaged = [
			agent({ id: "junie", name: "Junie", capabilities: caps({ providerConfig: false }) }),
		];
		expect(
			agentBannerState({
				agents: selfManaged,
				resolvedAgentId: "junie",
				providersConfigured: false,
			}),
		).toEqual({ kind: "none" });
	});
});
