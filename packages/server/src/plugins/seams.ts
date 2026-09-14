import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type {
	AppConfig,
	PluginRosterEntry,
	Project,
	TerminalAgentRecord,
	Workspace,
} from "@thinkrail/contracts";
import type { TerminalRef } from "@thinkrail/plugin-api";
import type { GitRunOptions, GitRunResult, PluginCall } from "@thinkrail/plugin-api/host";
import type { Logger } from "../log";

export interface BundledPluginRuntime {
	factories: ExtensionFactory[];
	skillsDir: string | null;
	assetsDir: string | null;
}

export interface PluginHostSeams {
	readonly dataDir: string;
	publish(channel: string, payload: unknown, target?: PluginCall): void;
	publishRoster(roster: PluginRosterEntry[]): void;
	publicBaseUrl(): string;
	terminal: {
		token(terminal: TerminalRef): string;
		forToken(token: string): TerminalRef | null;
		agentRecord(terminal: TerminalRef): TerminalAgentRecord | null;
		setAgentRecord(terminal: TerminalRef, record: TerminalAgentRecord | null): void;
		write(terminal: TerminalRef, data: string): void;
		list(): readonly (TerminalRef & { pid: number | null })[];
		workspaceForProcess(pid: number): string | null;
	};
	sessions: {
		send(sessionId: string, text: string): Promise<void>;
	};
	workspaces: {
		projects(): readonly Project[];
		list(projectId?: string): readonly Workspace[];
		get(id: string): Workspace | null;
		watch(id: string): Promise<void>;
		suggestName(workspaceId: string, hint: { prompt?: string; turn?: string }): void;
	};
	git(cwd: string, args: readonly string[], options?: GitRunOptions): Promise<GitRunResult>;
	config(): AppConfig;
	resourcesChanged(): void;
	logger(scope: string): Logger;
	bundledPluginRuntime(id: string): BundledPluginRuntime;
}
