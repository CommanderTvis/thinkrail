import type {
	AgentLaunchSpec,
	AgentProfile,
	McpEndpoint,
	TerminalExit,
	TerminalOutput,
} from "@thinkrail/acp";
import type {
	AgentDescriptor,
	AgentStatus,
	ChatEventPayload,
	ElicitationPush,
	InstalledAgent,
	PermissionPush,
	SessionDeletedPayload,
	SessionId,
} from "@thinkrail/contracts";

export interface WorkspaceLocation {
	workspaceId: string;
	projectId: string;
	cwd: string;
}

export interface WorkspaceLookup {
	find(workspaceId: string): WorkspaceLocation | undefined;
}

export interface WorktreeFiles {
	read(workspaceId: string, path: string): string;
	write(workspaceId: string, path: string, content: string): void;
	resolve(workspaceId: string, path: string): string;
}

export interface AgentTerminalRequest {
	workspaceId: string;
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd: string;
	outputByteLimit?: number;
}

export interface AgentTerminals {
	create(request: AgentTerminalRequest): string;
	read(terminalId: string): TerminalOutput;
	waitForExit(terminalId: string): Promise<TerminalExit>;
	kill(terminalId: string): void;
	release(terminalId: string): void;
}

export interface ResolvedAgent {
	descriptor: AgentDescriptor;
	launch: AgentLaunchSpec;
	profile?: AgentProfile;
}

export interface AgentDirectory {
	resolve(projectId: string | undefined): Promise<ResolvedAgent>;
	byId(agentId: string): Promise<ResolvedAgent>;
	list(): Promise<InstalledAgent[]>;
}

export interface McpHttpEndpoint {
	url: string;
	headers?: { name: string; value: string }[];
}

export interface McpToolServer {
	readonly name: string;
	readonly serverId: string;
	httpEndpoint(): McpHttpEndpoint | null;
	open(serverId: string): Promise<McpEndpoint>;
}

export interface AgentPublishers {
	chat(payload: ChatEventPayload): void;
	permission(push: PermissionPush): void;
	elicitation(push: ElicitationPush): void;
	sessionDeleted(payload: SessionDeletedPayload): void;
}

export type AgentStatusSink = (agentId: string, status: AgentStatus) => void;

export interface SessionClock {
	now(): number;
	nextId(): string;
}

export interface SessionLocation {
	sessionId: SessionId;
	workspaceId: string;
	cwd: string;
}
