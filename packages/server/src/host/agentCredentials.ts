import type { AgentAuthMethod, AgentProviderInfo } from "@thinkrail/contracts";
import type { AgentAuthOutcome } from "../agent";
import { getAgentSessions } from "../agent";
import type { AgentCredentials, ProviderRouting } from "../auth";
import { setAgentCredentials } from "../auth";
import { listProjects } from "../projects";
import { createAgentTerminal } from "../terminal";
import { listWorkspaces } from "../workspaces";

export interface AgentCredentialsPort {
	authMethodsFor(agentId: string): Promise<AgentAuthMethod[]>;
	authenticate(
		agentId: string,
		methodId: string,
		env: Record<string, string> | undefined,
	): Promise<AgentAuthOutcome>;
	logout(agentId: string, methodId?: string): Promise<void>;
	listProvidersFor(agentId: string): Promise<AgentProviderInfo[]>;
	setProvider(agentId: string, routing: ProviderRouting): Promise<void>;
	disableProvider(agentId: string, providerId: string): Promise<void>;
}

export interface AuthTerminalWorkspace {
	id: string;
	cwd: string;
}

export function createAgentCredentialsResolver(
	sessions: AgentCredentialsPort,
	firstWorkspace: () => Promise<AuthTerminalWorkspace | undefined>,
): (agentId: string) => Promise<AgentCredentials> {
	return async (agentId) => ({
		authMethods: () => sessions.authMethodsFor(agentId),
		logout: (methodId) => sessions.logout(agentId, methodId),
		listProviders: () => sessions.listProvidersFor(agentId),
		setProvider: (routing) => sessions.setProvider(agentId, routing),
		disableProvider: (providerId) => sessions.disableProvider(agentId, providerId),
		async authenticate({ methodId, env }) {
			const outcome = await sessions.authenticate(agentId, methodId, env);
			if (outcome.kind === "handled") return { outcome: "ok" };
			const workspace = await firstWorkspace();
			if (workspace === undefined) {
				throw new Error(
					`${agentId} needs an open project — its sign-in terminal has nowhere to run.`,
				);
			}
			const terminalId = createAgentTerminal({
				workspaceId: workspace.id,
				command: outcome.command,
				args: outcome.args,
				env: outcome.env,
				cwd: outcome.cwd ?? workspace.cwd,
			});
			return { outcome: "terminal", workspaceId: workspace.id, terminalId };
		},
	});
}

export async function firstOpenWorkspace(): Promise<AuthTerminalWorkspace | undefined> {
	for (const project of listProjects()) {
		const [first] = await listWorkspaces(project.id, { includeDiffStats: false });
		if (first !== undefined) return { id: first.id, cwd: first.worktreePath };
	}
	return undefined;
}

export function installAgentCredentials(): void {
	setAgentCredentials(createAgentCredentialsResolver(getAgentSessions(), firstOpenWorkspace));
}
