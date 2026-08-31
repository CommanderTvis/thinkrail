import { join } from "node:path";
import type { AgentLaunchSpec } from "@thinkrail/acp";
import { readAgentCatalog } from "@thinkrail/acp";
import type { InstalledAgent } from "@thinkrail/contracts";
import { readFile, resolveWorktreeFile, writeFile } from "../fs";
import { dataDir, loadConfig, loadProjects, loadWorkspaces } from "../persistence";
import {
	createAgentTerminal,
	killAgentTerminal,
	readAgentTerminal,
	releaseAgentTerminal,
	waitForAgentTerminalExit,
} from "../terminal";
import type {
	AgentDirectory,
	AgentTerminals,
	ResolvedAgent,
	WorkspaceLocation,
	WorkspaceLookup,
	WorktreeFiles,
} from "./ports";
import {
	type AgentCandidates,
	bundledAgent,
	listAgents,
	preferredAgentId,
	resolveAgent,
} from "./resolve";

export function agentsDir(): string {
	return join(dataDir(), "agents");
}

let bundledLaunch: AgentLaunchSpec = { command: process.execPath, args: ["acp-pi"] };

export function setBundledAgentLaunch(launch: AgentLaunchSpec): void {
	bundledLaunch = launch;
}

async function candidates(): Promise<AgentCandidates> {
	return { bundled: bundledAgent(bundledLaunch), installed: await readAgentCatalog(agentsDir()) };
}

export const hostAgentDirectory: AgentDirectory = {
	async resolve(projectId: string | undefined): Promise<ResolvedAgent> {
		const project =
			projectId === undefined
				? undefined
				: loadProjects().find((candidate) => candidate.id === projectId);
		return resolveAgent(preferredAgentId(project, loadConfig()), await candidates());
	},

	async byId(agentId: string): Promise<ResolvedAgent> {
		return resolveAgent(agentId, await candidates());
	},

	async list(): Promise<InstalledAgent[]> {
		return listAgents(await candidates());
	},
};

export const hostWorkspaces: WorkspaceLookup = {
	find(workspaceId: string): WorkspaceLocation | undefined {
		const workspace = loadWorkspaces().find((candidate) => candidate.id === workspaceId);
		if (workspace === undefined) return undefined;
		return {
			workspaceId: workspace.id,
			projectId: workspace.projectId,
			cwd: workspace.worktreePath,
		};
	},
};

export const hostFiles: WorktreeFiles = {
	read: (workspaceId, path) => readFile(workspaceId, path).content,
	write: (workspaceId, path, content) => {
		writeFile(workspaceId, path, content);
	},
	resolve: (workspaceId, path) => resolveWorktreeFile(workspaceId, path),
};

export const hostTerminals: AgentTerminals = {
	create: (request) => createAgentTerminal(request),
	read: (terminalId) => readAgentTerminal(terminalId),
	waitForExit: (terminalId) => waitForAgentTerminalExit(terminalId),
	kill: (terminalId) => {
		killAgentTerminal(terminalId);
	},
	release: (terminalId) => {
		releaseAgentTerminal(terminalId);
	},
};
