import { getTransport } from "../transport";

function encodeFilesPath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

export function worktreeFileUrl(workspaceId: string, path: string): string {
	return `${getTransport().httpBase()}/files/${encodeURIComponent(workspaceId)}/${encodeFilesPath(path)}`;
}
