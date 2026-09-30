export type BackgroundCommand = {
  id: string; sessionId: string; name: string; command: string; status: 'running' | 'stopping' | 'completed' | 'error' | 'stopped';
  startedAt: number; finishedAt?: number; exitCode?: number | null; errorMessage?: string;
};
export type SubagentResource = {childSessionId: string; parentSessionId: string; roleName?: string; task: string; status: string; createdAt: string; abortReason?: string};
export type SessionResources = {workspaceId: string; sessionId: string; commands: BackgroundCommand[]; subagents: SubagentResource[]};
export type CommandOutput = {available: true; command: BackgroundCommand; output: {text: string; truncated: boolean}} | {available: false};

const commandActive = (command: BackgroundCommand) => command.status === 'running' || command.status === 'stopping';
const subagentActive = (child: SubagentResource) => child.status === 'queued' || child.status === 'running';

export function resourceGroups(resources: SessionResources | null) {
  const commands = resources?.commands ?? [], subagents = resources?.subagents ?? [];
  return {
    commands: commands.filter(commandActive), subagents: subagents.filter(subagentActive),
    finishedCommands: commands.filter(command => !commandActive(command)), finishedSubagents: subagents.filter(child => !subagentActive(child)),
  };
}

export function resourcesLabel(activeCount: number | null) {
  return `Resources, ${activeCount === null ? 'active count unavailable' : `${activeCount} active`}`;
}
