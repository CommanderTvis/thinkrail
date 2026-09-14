import { create } from "zustand";
import type { TerminalVisualization } from "../contracts";

interface VisualizeStoreState {
	byWorkspace: Record<string, Record<string, TerminalVisualization>>;
	setWorkspace: (
		workspaceId: string,
		visualizations: Record<string, TerminalVisualization>,
	) => void;
}

export const useVisualizeStore = create<VisualizeStoreState>((set) => ({
	byWorkspace: {},
	setWorkspace: (workspaceId, visualizations) =>
		set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: visualizations } })),
}));
