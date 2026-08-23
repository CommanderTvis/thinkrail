import type { TerminalAgentKind } from "@thinkrail/contracts";
import { captureProcessSnapshot, findDescendantProcess, type ProcessSnapshot } from "./processTree";

export const AGENT_POLL_MS = 2500;

const DETECTED_AGENTS: readonly TerminalAgentKind[] = ["claude", "pi"];

const KEY_SEP = "\u0000";

export interface AgentWatchTarget {
	workspaceId: string;
	tabKey: string;
	pid: number;
}

export interface AgentWatchDeps {
	listTargets: () => AgentWatchTarget[];
	onWorkspaceChanged: (workspaceId: string) => void;
	onAgentCleared?: (workspaceId: string, tabKey: string) => void;
	onAgentDetected?: (workspaceId: string, tabKey: string, agentPid: number) => void;
	capture?: () => ProcessSnapshot | null;
	schedule?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
	cancel?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface AgentWatch {
	agentFor(workspaceId: string, tabKey: string): TerminalAgentKind | undefined;
	poke(): void;
	forget(workspaceId: string, tabKey: string): void;
	stop(): void;
}

function indexOf(workspaceId: string, tabKey: string): string {
	return workspaceId + KEY_SEP + tabKey;
}

function workspaceOf(index: string): string {
	return index.slice(0, index.indexOf(KEY_SEP));
}

export function createAgentWatch(deps: AgentWatchDeps): AgentWatch {
	const capture = deps.capture ?? captureProcessSnapshot;
	const schedule = deps.schedule ?? ((fn, ms) => setInterval(fn, ms));
	const cancel = deps.cancel ?? ((handle) => clearInterval(handle));

	const agents = new Map<string, TerminalAgentKind>();
	let timer: ReturnType<typeof setInterval> | null = null;

	const idle = (): void => {
		if (timer === null) return;
		cancel(timer);
		timer = null;
	};

	const dropAll = (changed: Set<string>): void => {
		for (const index of agents.keys()) changed.add(workspaceOf(index));
		agents.clear();
	};

	const sweep = (): void => {
		const changed = new Set<string>();
		const targets = deps.listTargets();

		if (targets.length === 0) {
			idle();
			dropAll(changed);
		} else {
			const snapshot = capture();
			if (!snapshot) return;

			const live = new Set<string>();
			for (const target of targets) {
				const index = indexOf(target.workspaceId, target.tabKey);
				live.add(index);
				const previous = agents.get(index);
				const found = findDescendantProcess(snapshot, target.pid, DETECTED_AGENTS);
				const next = found?.name ?? undefined;
				if (previous === next) continue;
				if (next === undefined) {
					agents.delete(index);
					if (previous !== undefined) deps.onAgentCleared?.(target.workspaceId, target.tabKey);
				} else {
					agents.set(index, next);
					if (found) deps.onAgentDetected?.(target.workspaceId, target.tabKey, found.pid);
				}
				changed.add(target.workspaceId);
			}
			for (const index of [...agents.keys()]) {
				if (live.has(index)) continue;
				agents.delete(index);
				changed.add(workspaceOf(index));
			}
		}

		for (const workspaceId of changed) deps.onWorkspaceChanged(workspaceId);
	};

	return {
		agentFor: (workspaceId, tabKey) => agents.get(indexOf(workspaceId, tabKey)),
		// Arms the timer only; sweeping inline would block attach — see SPEC.md.
		poke() {
			if (timer === null && deps.listTargets().length > 0) timer = schedule(sweep, AGENT_POLL_MS);
		},
		forget(workspaceId, tabKey) {
			agents.delete(indexOf(workspaceId, tabKey));
		},
		stop() {
			idle();
			agents.clear();
		},
	};
}
