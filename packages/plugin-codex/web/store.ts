import { create } from "zustand";
import type { CodexStatus, CodexStatusPush } from "../contracts";

export interface CodexSessionState {
	status: CodexStatus;
	model?: string;
	cwd?: string;
}

interface CodexStore {
	byWorkspace: Record<string, Record<string, CodexSessionState>>;
	applyPush: (push: CodexStatusPush) => void;
	evictWorkspace: (workspaceId: string) => void;
}

export const useCodexStore = create<CodexStore>((set) => ({
	byWorkspace: {},
	applyPush: (push) =>
		set((s) => {
			const previous = s.byWorkspace[push.workspaceId]?.[push.tabKey];
			const model = push.model ?? previous?.model;
			const cwd = push.cwd ?? previous?.cwd;
			return {
				byWorkspace: {
					...s.byWorkspace,
					[push.workspaceId]: {
						...s.byWorkspace[push.workspaceId],
						[push.tabKey]: {
							status: push.status,
							...(model ? { model } : {}),
							...(cwd ? { cwd } : {}),
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
