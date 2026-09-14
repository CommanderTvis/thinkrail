import type { ClaudeCodeStatusPush } from "../contracts";

/**
 * The last push seen per tab, so `statusSnapshot` can answer a client that mounts or reconnects mid-
 * session — the wire channel itself is push-only and carries nothing to replay. Ephemeral: nothing here
 * needs to survive a restart, since a revived terminal's agent re-reports on its own.
 */
const byWorkspace = new Map<string, Map<string, ClaudeCodeStatusPush>>();

export function recordStatusPush(push: ClaudeCodeStatusPush): void {
	let tabs = byWorkspace.get(push.workspaceId);
	if (!tabs) {
		tabs = new Map();
		byWorkspace.set(push.workspaceId, tabs);
	}
	tabs.set(push.tabKey, push);
}

export function statusSnapshotOf(workspaceId: string): ClaudeCodeStatusPush[] {
	return [...(byWorkspace.get(workspaceId)?.values() ?? [])];
}

export function forgetStatus(workspaceId: string, tabKey: string): void {
	byWorkspace.get(workspaceId)?.delete(tabKey);
}
