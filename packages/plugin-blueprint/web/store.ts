import { create } from "zustand";
import type { BlueprintState } from "../contracts";

interface BlueprintStoreState {
	byWorkspace: Record<string, BlueprintState | null>;
	setState: (workspaceId: string, state: BlueprintState | null) => void;
}

export const useBlueprintStore = create<BlueprintStoreState>((set) => ({
	byWorkspace: {},
	setState: (workspaceId, state) =>
		set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: state } })),
}));

export function evictWorkspace(workspaceId: string): void {
	useBlueprintStore.setState((s) => {
		if (!(workspaceId in s.byWorkspace)) return {};
		const { [workspaceId]: _dropped, ...byWorkspace } = s.byWorkspace;
		return { byWorkspace };
	});
}

/** A workspace authors at most one blueprint at a time; this host carries it whether the author is a
 * terminal or a chat. See SPEC.md. */
export function blueprintAuthors(
	blueprint: BlueprintState | null | undefined,
	host: { kind: "terminal" | "chat"; key: string },
): boolean {
	return (
		(host.kind === "terminal" &&
			blueprint?.author?.kind === "terminal" &&
			blueprint.author.tabKey === host.key) ||
		(host.kind === "chat" &&
			blueprint?.author?.kind === "chat" &&
			blueprint.author.sessionId === host.key)
	);
}
