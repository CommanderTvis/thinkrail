import type { InstalledAgent } from "@thinkrail/contracts";
import { getTranscriptStore } from "../transcript";
import { hostAgentDirectory, hostFiles, hostTerminals, hostWorkspaces } from "./hostPorts";
import { AgentSessionManager } from "./manager";
import type { AgentPublishers, McpToolServer } from "./ports";

export { createStagingClock, type StagingClock } from "./clock";
export { agentsDir, setBundledAgentLaunch } from "./hostPorts";
export {
	type AgentAuthOutcome,
	AgentSessionLostError,
	AgentSessionManager,
	type AgentSessionManagerOptions,
	type SendMode,
} from "./manager";
export type {
	AgentDirectory,
	AgentPublishers,
	AgentTerminalRequest,
	AgentTerminals,
	McpHttpEndpoint,
	McpToolServer,
	ResolvedAgent,
	SessionLocation,
	WorkspaceLocation,
	WorkspaceLookup,
	WorktreeFiles,
} from "./ports";
export { BUNDLED_AGENT_ID, UnknownAgentError } from "./resolve";
export { DEFAULT_RESTART_POLICY, type RestartPolicy } from "./supervisor";

let manager: AgentSessionManager | null = null;

export function getAgentSessions(): AgentSessionManager {
	manager ??= new AgentSessionManager({
		store: getTranscriptStore(),
		workspaces: hostWorkspaces,
		agents: hostAgentDirectory,
		files: hostFiles,
		terminals: hostTerminals,
	});
	return manager;
}

export function listInstalledAgents(): Promise<InstalledAgent[]> {
	return hostAgentDirectory.list();
}

export function setAgentPublishers(publishers: Partial<AgentPublishers>): void {
	getAgentSessions().setPublishers(publishers);
}

export function setMcpToolServer(server: McpToolServer | null): void {
	getAgentSessions().setMcpToolServer(server);
}

export async function disposeAgentSessions(): Promise<void> {
	const held = manager;
	manager = null;
	if (held !== null) await held.dispose();
}
