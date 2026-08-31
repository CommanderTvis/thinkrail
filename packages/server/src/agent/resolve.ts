import type { AgentCatalogEntry, AgentLaunchSpec } from "@thinkrail/acp";
import { profileFor } from "@thinkrail/acp";
import type {
	AgentDescriptor,
	AppConfig,
	ChatCapabilities,
	ChatCapabilityFlags,
	InstalledAgent,
	Project,
} from "@thinkrail/contracts";
import type { ResolvedAgent } from "./ports";

export const BUNDLED_AGENT_ID = "thinkrail-pi";

export class UnknownAgentError extends Error {
	readonly agentId: string;

	constructor(agentId: string) {
		super(`No agent named "${agentId}" is installed.`);
		this.name = "UnknownAgentError";
		this.agentId = agentId;
	}
}

export interface AgentCandidates {
	bundled: ResolvedAgent;
	installed: readonly AgentCatalogEntry[];
}

export function bundledAgent(launch: AgentLaunchSpec): ResolvedAgent {
	const profile = profileFor(BUNDLED_AGENT_ID);
	return {
		descriptor: { id: BUNDLED_AGENT_ID, name: "ThinkRail pi", origin: "bundled" },
		launch,
		...(profile === undefined ? {} : { profile }),
	};
}

export function preferredAgentId(project: Project | undefined, config: AppConfig): string | null {
	return project?.agentId ?? config.defaultAgentId;
}

export function resolveAgent(agentId: string | null, candidates: AgentCandidates): ResolvedAgent {
	if (agentId === null || agentId === candidates.bundled.descriptor.id) return candidates.bundled;
	const entry = candidates.installed.find((candidate) => candidate.id === agentId);
	if (entry === undefined) throw new UnknownAgentError(agentId);
	return fromCatalog(entry);
}

export function listAgents(candidates: AgentCandidates): InstalledAgent[] {
	const installed = candidates.installed
		.filter((entry) => entry.id !== candidates.bundled.descriptor.id)
		.map((entry) => toInstalled(fromCatalog(entry)));
	return [toInstalled(candidates.bundled), ...installed];
}

export function describeAgent(agentId: string, agents: readonly InstalledAgent[]): AgentDescriptor {
	const known = agents.find((agent) => agent.id === agentId);
	if (known !== undefined) return known;
	return { id: agentId, name: agentId, origin: "external" };
}

function fromCatalog(entry: AgentCatalogEntry): ResolvedAgent {
	const profile = profileFor(entry.id);
	return {
		descriptor: {
			id: entry.id,
			name: entry.name,
			origin: entry.origin,
			...(entry.version === undefined ? {} : { version: entry.version }),
			...(entry.icon === undefined ? {} : { icon: entry.icon }),
		},
		launch: entry.launch,
		...(profile === undefined ? {} : { profile }),
	};
}

function toInstalled(agent: ResolvedAgent): InstalledAgent {
	return {
		...agent.descriptor,
		command: agent.launch.command,
		args: agent.launch.args,
	};
}

const DORMANT_FLAGS: ChatCapabilityFlags = {
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
};

export function dormantCapabilities(agent: AgentDescriptor): ChatCapabilities {
	const derivedFrom: ChatCapabilities["derivedFrom"] = {};
	for (const key of Object.keys(DORMANT_FLAGS) as (keyof ChatCapabilityFlags)[]) {
		derivedFrom[key] = "host";
	}
	return { ...DORMANT_FLAGS, agent, derivedFrom };
}
