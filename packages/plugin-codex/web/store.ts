import { create } from "zustand";
import type {
	CodexModel,
	CodexPlanItem,
	CodexStatus,
	CodexStatusPush,
	CodexTokenUsage,
} from "../contracts";

export interface CodexSessionState {
	status: CodexStatus;
	model?: string;
	cwd?: string;
	usage?: CodexTokenUsage;
	plan?: CodexPlanItem[];
}

interface CodexStore {
	byWorkspace: Record<string, Record<string, CodexSessionState>>;
	ideContextByTerminal: Record<string, boolean>;
	models: CodexModel[];
	applyPush: (push: CodexStatusPush) => void;
	setIdeContext: (workspaceId: string, tabKey: string, enabled: boolean) => void;
	setModels: (models: CodexModel[]) => void;
	evictWorkspace: (workspaceId: string) => void;
}

export const useCodexStore = create<CodexStore>((set) => ({
	byWorkspace: {},
	ideContextByTerminal: {},
	models: [],
	applyPush: (push) =>
		set((s) => {
			const previous = s.byWorkspace[push.workspaceId]?.[push.tabKey];
			const model = push.model ?? previous?.model;
			const cwd = push.cwd ?? previous?.cwd;
			const usage = push.usage ?? previous?.usage;
			const plan = push.plan ?? previous?.plan;
			return {
				byWorkspace: {
					...s.byWorkspace,
					[push.workspaceId]: {
						...s.byWorkspace[push.workspaceId],
						[push.tabKey]: {
							status: push.status,
							...(model ? { model } : {}),
							...(cwd ? { cwd } : {}),
							...(usage ? { usage } : {}),
							...(plan ? { plan } : {}),
						},
					},
				},
			};
		}),
	setIdeContext: (workspaceId, tabKey, enabled) =>
		set((s) => ({
			ideContextByTerminal: {
				...s.ideContextByTerminal,
				[`${workspaceId}\u0000${tabKey}`]: enabled,
			},
		})),
	setModels: (models) => set({ models }),
	evictWorkspace: (workspaceId) =>
		set((s) => {
			if (!(workspaceId in s.byWorkspace)) return {};
			const { [workspaceId]: _dropped, ...byWorkspace } = s.byWorkspace;
			const ideContextByTerminal = Object.fromEntries(
				Object.entries(s.ideContextByTerminal).filter(
					([key]) => !key.startsWith(`${workspaceId}\u0000`),
				),
			);
			return { byWorkspace, ideContextByTerminal };
		}),
}));
