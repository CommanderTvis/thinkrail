export type SessionStateRecord = {
  sessionId: string; workspaceId: string; projectId: string;
  state: {execution: 'idle' | 'running'; needsInput: unknown; completion: {completionId: string} | null; completionUnread: boolean};
};
export type SessionStates = Record<string, SessionStateRecord>;

type Scope = {workspaceId: string} | {projectId: string};

const inScope = (record: SessionStateRecord, scope: Scope) =>
  'workspaceId' in scope ? record.workspaceId === scope.workspaceId : record.projectId === scope.projectId;

export function needsAttention(states: SessionStates, scope: Scope) {
  return Object.values(states).some(record => inScope(record, scope) && (record.state.needsInput !== null || record.state.completionUnread));
}

export function isRunning(states: SessionStates, scope: Scope) {
  return Object.values(states).some(record => inScope(record, scope) && record.state.execution === 'running');
}

export function unreadCompletion(states: SessionStates, sessionId: string) {
  const state = states[sessionId]?.state;
  return state?.completionUnread ? state.completion?.completionId : undefined;
}
