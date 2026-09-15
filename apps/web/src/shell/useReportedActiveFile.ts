import { useEffect } from "react";
import { selectAttentionCenterFilePath, useAppStore } from "../store";
import { reportIdeActiveFile } from "../transport";

export function useReportedActiveFile(workspaceId: string): void {
	const path = useAppStore((state) => selectAttentionCenterFilePath(state, workspaceId));
	useEffect(() => {
		if (path) reportIdeActiveFile(workspaceId, path);
	}, [workspaceId, path]);
}
