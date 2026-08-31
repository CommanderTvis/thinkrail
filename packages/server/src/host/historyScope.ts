import type {
	HistoryScope,
	Project,
	TranscriptCorpusSession,
	Workspace,
} from "@thinkrail/contracts";

export interface HistoryScopeBinding {
	includes: (session: TranscriptCorpusSession) => boolean;
	projectOf: (session: TranscriptCorpusSession) => string | undefined;
}

export function buildHistoryScope(
	scope: HistoryScope,
	projects: Project[],
	workspacesByProject: (projectId: string) => Array<Pick<Workspace, "id" | "projectId">>,
): HistoryScopeBinding {
	const projectByWorkspace = new Map<string, string>();
	for (const project of projects) {
		for (const ws of workspacesByProject(project.id)) projectByWorkspace.set(ws.id, ws.projectId);
	}

	const projectOf = (session: TranscriptCorpusSession): string | undefined =>
		projectByWorkspace.get(session.workspaceId);

	if (scope.kind === "all") return { includes: () => true, projectOf };
	if (scope.kind === "chat") {
		return { includes: (session) => session.sessionId === scope.sessionId, projectOf };
	}
	if (scope.kind === "workspace") {
		return { includes: (session) => session.workspaceId === scope.workspaceId, projectOf };
	}
	return { includes: (session) => projectOf(session) === scope.projectId, projectOf };
}
