import { detectAgents, forgetAgent, readAgentCatalog, recordAgent } from "@thinkrail/acp";
import type { AgentRegistryEntry, DetectedAgent, InstalledAgent } from "@thinkrail/contracts";
import { agentsDir, BUNDLED_AGENT_ID, listInstalledAgents } from "../agent";

type AgentCatalogPublisher = () => void;

let publisher: AgentCatalogPublisher | null = null;

export function setAgentCatalogPublisher(next: AgentCatalogPublisher | null): void {
	publisher = next;
}

export function publishAgentCatalogChanged(): void {
	publisher?.();
}

export interface AddAgentParams {
	id: string;
	name: string;
	command: string;
	args: string[];
}

export async function addAgent(params: AddAgentParams): Promise<InstalledAgent> {
	const id = params.id.trim();
	if (id.length === 0) throw new Error("An agent needs an id.");
	if (id === BUNDLED_AGENT_ID) {
		throw new Error(`"${BUNDLED_AGENT_ID}" is the bundled agent's id — pick another.`);
	}
	const command = params.command.trim();
	if (command.length === 0) throw new Error(`"${id}" needs a command to launch.`);
	const catalog = await readAgentCatalog(agentsDir());
	if (catalog.some((entry) => entry.id === id)) {
		throw new Error(`An agent named "${id}" is already registered — remove it first.`);
	}

	const name = params.name.trim();
	await recordAgent(agentsDir(), {
		id,
		name: name.length === 0 ? id : name,
		origin: "external",
		launch: { command, args: params.args },
	});
	publishAgentCatalogChanged();

	const added = (await listInstalledAgents()).find((agent) => agent.id === id);
	if (added === undefined) throw new Error(`"${id}" did not land in the agent catalog.`);
	return added;
}

export async function removeAgent(agentId: string): Promise<void> {
	if (agentId === BUNDLED_AGENT_ID) {
		throw new Error(`"${BUNDLED_AGENT_ID}" is the bundled agent and cannot be removed.`);
	}
	const catalog = await readAgentCatalog(agentsDir());
	if (!catalog.some((entry) => entry.id === agentId)) {
		throw new Error(`No agent named "${agentId}" is registered.`);
	}
	await forgetAgent(agentsDir(), agentId);
	publishAgentCatalogChanged();
}

export async function listDetectedAgents(
	entries: readonly AgentRegistryEntry[],
): Promise<DetectedAgent[]> {
	return detectAgents({ entries, catalog: await readAgentCatalog(agentsDir()) });
}
