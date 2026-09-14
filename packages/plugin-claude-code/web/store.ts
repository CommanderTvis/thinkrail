import { create } from "zustand";
import type { AgentTodoItem, ClaudeCodeStatus, ClaudeCodeStatusPush } from "../contracts";
import { parseAgentTodos } from "../webValues";

export interface ClaudeCodeSessionState {
	status: ClaudeCodeStatus;
	summary?: string;
	model?: string;
	effort?: string;
	cwd?: string;
	todos?: AgentTodoItem[];
}

interface ClaudeCodeStore {
	byWorkspace: Record<string, Record<string, ClaudeCodeSessionState>>;
	applyPush: (push: ClaudeCodeStatusPush) => void;
	evictWorkspace: (workspaceId: string) => void;
}

export const useClaudeCodeStore = create<ClaudeCodeStore>((set) => ({
	byWorkspace: {},
	applyPush: (push) =>
		set((s) => {
			// Model and effort ride events that carry them and are absent from the rest, so the last
			// reported answer stands until a newer one arrives rather than blinking out between turns. A
			// facts-only push (a model switch) carries a null status for the same reason.
			const previous = s.byWorkspace[push.workspaceId]?.[push.tabKey];
			const settled = push.status ?? previous?.status;
			if (!settled) return {};
			const model = push.report.model ?? previous?.model;
			const effort = push.report.effort ?? previous?.effort;
			const cwd = push.report.cwd ?? previous?.cwd;
			const todos = parseAgentTodos(push.report.todos) ?? previous?.todos;
			return {
				byWorkspace: {
					...s.byWorkspace,
					[push.workspaceId]: {
						...s.byWorkspace[push.workspaceId],
						[push.tabKey]: {
							status: settled,
							...(push.report.summary ? { summary: push.report.summary } : {}),
							...(model ? { model } : {}),
							...(effort ? { effort } : {}),
							...(cwd ? { cwd } : {}),
							...(todos ? { todos } : {}),
						},
					},
				},
			};
		}),
	evictWorkspace: (workspaceId) =>
		set((s) => {
			if (!(workspaceId in s.byWorkspace)) return {};
			const { [workspaceId]: _dropped, ...byWorkspace } = s.byWorkspace;
			return { byWorkspace };
		}),
}));
