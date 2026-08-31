import type { InstalledAgent } from "@thinkrail/contracts";

export type AgentBannerReason = "none-installed" | "unavailable" | "no-provider";

export type AgentBannerState = { kind: "none" } | { kind: "no-agent"; reason: AgentBannerReason };

export interface AgentBannerInput {
	agents: InstalledAgent[] | null;
	resolvedAgentId: string | null;
	providersConfigured: boolean | null;
}

export function sortInstalledAgents(agents: InstalledAgent[]): InstalledAgent[] {
	return [...agents].sort((a, b) => {
		const bundled = Number(b.origin === "bundled") - Number(a.origin === "bundled");
		return bundled !== 0 ? bundled : a.name.localeCompare(b.name);
	});
}

export function pickSelectedAgentId(
	agents: InstalledAgent[],
	current: string | null,
	defaultAgentId: string | null,
): string | null {
	if (current && agents.some((a) => a.id === current)) return current;
	if (defaultAgentId && agents.some((a) => a.id === defaultAgentId)) return defaultAgentId;
	return sortInstalledAgents(agents)[0]?.id ?? null;
}

export function parseAgentArgs(text: string): string[] {
	return text.trim().split(/\s+/).filter(Boolean);
}

export function formatAgentArgs(args: string[]): string {
	return args.join(" ");
}

export function selectBannerAgent(
	agents: InstalledAgent[],
	resolvedAgentId: string | null,
): InstalledAgent | null {
	if (!resolvedAgentId) return null;
	const agent = agents.find((a) => a.id === resolvedAgentId);
	return agent && !agent.unavailable ? agent : null;
}

export function agentBannerState(input: AgentBannerInput): AgentBannerState {
	if (input.agents === null) return { kind: "none" };
	const agent = selectBannerAgent(input.agents, input.resolvedAgentId);
	if (!agent) {
		const named = input.agents.some((a) => a.id === input.resolvedAgentId);
		return { kind: "no-agent", reason: named ? "unavailable" : "none-installed" };
	}
	if (!(agent.capabilities?.providerConfig ?? true)) return { kind: "none" };
	if (input.providersConfigured !== false) return { kind: "none" };
	return { kind: "no-agent", reason: "no-provider" };
}
