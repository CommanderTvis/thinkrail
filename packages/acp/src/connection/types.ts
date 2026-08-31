import type {
	AgentAuthMethod,
	AgentDescriptor,
	AgentProviderInfo,
	ChatCapabilities,
	ChatEvent,
	ConfigOption,
	ConfigValue,
	MessageId,
	PromptContent,
	SessionId,
	SessionRecord,
	TurnSettlement,
} from "@thinkrail/contracts";
import type { AgentProfile } from "../capabilities";
import type { AcpClientDelegates } from "../client";
import type { AssemblerClock } from "../translate";

export interface AgentLaunchSpec {
	command: string;
	args: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export interface AgentExit {
	code: number | null;
	signal: string | null;
	stderrTail: string;
	stdoutNoise: string;
}

export interface SpawnedProcess {
	readonly stdin: WritableStream<Uint8Array>;
	readonly stdout: ReadableStream<Uint8Array>;
	readonly stderr: ReadableStream<Uint8Array>;
	readonly exited: Promise<{ code: number | null; signal: string | null }>;
	kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export type ProcessSpawner = (launch: AgentLaunchSpec) => SpawnedProcess;

export type McpServerOffer =
	| { kind: "acp"; name: string; serverId: string }
	| { kind: "http"; name: string; url: string; headers?: { name: string; value: string }[] };

export interface NewSessionInput {
	cwd: string;
	additionalDirectories?: string[];
	mcpServers?: McpServerOffer[];
}

export interface LoadSessionInput extends NewSessionInput {
	sessionId: SessionId;
	replay?: (events: ChatEvent[]) => void;
}

export interface PromptInput {
	sessionId: SessionId;
	content: PromptContent[];
	steer?: "steer" | "followUp";
}

export interface SessionHandle {
	sessionId: SessionId;
	configOptions: ConfigOption[];
}

export interface AgentConnection {
	readonly agent: AgentDescriptor;
	readonly capabilities: ChatCapabilities;
	readonly signal: AbortSignal;
	readonly exited: Promise<AgentExit>;
	readonly authMethods: AgentAuthMethod[];
	newSession(input: NewSessionInput): Promise<SessionHandle>;
	loadSession(input: LoadSessionInput): Promise<SessionHandle>;
	listSessions(cwd?: string): Promise<SessionRecord[]>;
	deleteSession(sessionId: SessionId): Promise<void>;
	closeSession(sessionId: SessionId): Promise<void>;
	prompt(input: PromptInput): Promise<{ messageId: MessageId; settlement: TurnSettlement }>;
	cancel(sessionId: SessionId): Promise<void>;
	setConfigOption(input: {
		sessionId: SessionId;
		optionId: string;
		value: ConfigValue;
	}): Promise<ConfigOption[]>;
	authenticate(methodId: string, value?: string): Promise<void>;
	logout(methodId?: string): Promise<void>;
	listProviders(): Promise<AgentProviderInfo[]>;
	setProvider(routing: {
		providerId: string;
		apiType: string;
		baseUrl: string;
		headers?: Record<string, string>;
	}): Promise<void>;
	disableProvider(providerId: string): Promise<void>;
	ext<R>(method: string, params: Record<string, unknown>): Promise<R>;
	close(): Promise<AgentExit>;
}

export interface ConnectAgentOptions {
	agent: AgentDescriptor;
	launch: AgentLaunchSpec;
	delegates: AcpClientDelegates;
	profile?: AgentProfile;
	clock?: AssemblerClock;
	spawn?: ProcessSpawner;
	handshakeTimeoutMs?: number;
	onCapabilities?: (capabilities: ChatCapabilities) => void;
	onExit?: (exit: AgentExit) => void;
}
