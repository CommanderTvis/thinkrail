import type { AcpClientDelegates, McpEndpoint } from "@thinkrail/acp";
import type {
	ChatEvent,
	ElicitationRequest,
	ElicitationResponse,
	PermissionDecision,
	PermissionRequest,
	SessionId,
} from "@thinkrail/contracts";
import type { AgentTerminals, SessionLocation, WorktreeFiles } from "./ports";

export interface DelegateHost {
	files: WorktreeFiles;
	terminals: AgentTerminals;
	locate(sessionId: SessionId): SessionLocation | undefined;
	publish(sessionId: SessionId, events: ChatEvent[]): void;
	askPermission(request: PermissionRequest): Promise<PermissionDecision>;
	askElicitation(request: ElicitationRequest): Promise<ElicitationResponse>;
	closeElicitation(elicitationId: string): void;
	openMcp(serverId: string): Promise<McpEndpoint>;
}

export function sliceLines(content: string, line?: number, limit?: number): string {
	if (line === undefined && limit === undefined) return content;
	const lines = content.split("\n");
	const start = Math.max(0, (line ?? 1) - 1);
	const end = limit === undefined ? lines.length : start + Math.max(0, limit);
	return lines.slice(start, end).join("\n");
}

export function unknownSessionError(sessionId: SessionId): Error {
	return new Error(
		`This chat (${sessionId}) isn't attached to the running host — most likely the host restarted since it was opened. Start a new chat to continue.`,
	);
}

export function createAcpDelegates(host: DelegateHost): AcpClientDelegates {
	const mustLocate = (sessionId: SessionId): SessionLocation => {
		const location = host.locate(sessionId);
		if (location === undefined) throw unknownSessionError(sessionId);
		return location;
	};

	return {
		async readTextFile(request) {
			const location = mustLocate(request.sessionId);
			const content = host.files.read(location.workspaceId, request.path);
			return sliceLines(content, request.line, request.limit);
		},

		async writeTextFile(request) {
			const location = mustLocate(request.sessionId);
			host.files.write(location.workspaceId, request.path, request.content);
		},

		async createTerminal(request) {
			const location = mustLocate(request.sessionId);
			const cwd =
				request.cwd === undefined
					? location.cwd
					: host.files.resolve(location.workspaceId, request.cwd);
			return host.terminals.create({
				workspaceId: location.workspaceId,
				command: request.command,
				args: request.args,
				env: request.env,
				cwd,
				...(request.outputByteLimit === undefined
					? {}
					: { outputByteLimit: request.outputByteLimit }),
			});
		},

		async terminalOutput(_sessionId, terminalId) {
			return host.terminals.read(terminalId);
		},

		async waitForTerminalExit(_sessionId, terminalId) {
			return await host.terminals.waitForExit(terminalId);
		},

		async killTerminal(_sessionId, terminalId) {
			host.terminals.kill(terminalId);
		},

		async releaseTerminal(_sessionId, terminalId) {
			host.terminals.release(terminalId);
		},

		requestPermission(request) {
			return host.askPermission(request);
		},

		createElicitation(request) {
			return host.askElicitation(request);
		},

		completeElicitation(elicitationId) {
			host.closeElicitation(elicitationId);
		},

		publish(sessionId, events) {
			host.publish(sessionId, events);
		},

		openMcpEndpoint(serverId) {
			return host.openMcp(serverId);
		},
	};
}
