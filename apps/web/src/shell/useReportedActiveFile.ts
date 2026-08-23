import { useEffect } from "react";
import { selectAttentionCenterFilePath, useAppStore } from "../store";
import { reportIdeActiveFile } from "../transport";

/**
 * Keeps a connected `claude` told which file the user is in, so presence follows a tab switch and not
 * only a selection. No-ops unless the Claude Code surface is on. See shell/SPEC.md.
 */
export function useReportedActiveFile(workspaceId: string): void {
	const path = useAppStore((state) => selectAttentionCenterFilePath(state, workspaceId));
	useEffect(() => {
		if (path) reportIdeActiveFile(workspaceId, path);
	}, [workspaceId, path]);
}
