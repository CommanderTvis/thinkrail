import type { SessionNotification } from "@agentclientprotocol/sdk";
import type {
	ChatEvent,
	ElicitationRequest,
	ElicitationResponse,
	PermissionDecision,
	PermissionRequest,
	SessionId,
} from "@thinkrail/contracts";

export interface TerminalCreateRequest {
	sessionId: SessionId;
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd?: string;
	outputByteLimit?: number;
}

export interface TerminalExit {
	exitCode: number | null;
	signal: string | null;
}

export interface TerminalOutput {
	output: string;
	truncated: boolean;
	exit?: TerminalExit;
}

export interface McpEndpoint {
	request(method: string, params?: Record<string, unknown>): Promise<unknown>;
	notify(method: string, params?: Record<string, unknown>): void;
	close(): void;
}

export interface AcpClientDelegates {
	readTextFile(r: {
		sessionId: SessionId;
		path: string;
		line?: number;
		limit?: number;
	}): Promise<string>;
	writeTextFile(r: { sessionId: SessionId; path: string; content: string }): Promise<void>;
	createTerminal(r: TerminalCreateRequest): Promise<string>;
	terminalOutput(sessionId: SessionId, terminalId: string): Promise<TerminalOutput>;
	waitForTerminalExit(sessionId: SessionId, terminalId: string): Promise<TerminalExit>;
	killTerminal(sessionId: SessionId, terminalId: string): Promise<void>;
	releaseTerminal(sessionId: SessionId, terminalId: string): Promise<void>;
	requestPermission(request: PermissionRequest): Promise<PermissionDecision>;
	createElicitation(request: ElicitationRequest): Promise<ElicitationResponse>;
	completeElicitation(id: string): void;
	publish(sessionId: SessionId, events: ChatEvent[]): void;
	openMcpEndpoint(serverId: string): Promise<McpEndpoint>;
}

export interface AcpClientRuntime {
	applyUpdate(notification: SessionNotification): void;
	nextId(): string;
	readonly signal: AbortSignal;
}
