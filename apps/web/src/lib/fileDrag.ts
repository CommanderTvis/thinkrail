export const FILE_DRAG_TYPE = "application/x-thinkrail-file";

export interface DraggedFile {
	path: string;
	kind: "dir" | "file";
}

export function startFileDrag(transfer: DataTransfer, file: DraggedFile): void {
	transfer.setData(FILE_DRAG_TYPE, JSON.stringify(file));
	transfer.setData("text/plain", file.path);
	transfer.effectAllowed = "copy";
}

/** True mid-drag, when the payload itself is still sealed and only its types are readable. */
export function carriesFileDrag(transfer: DataTransfer): boolean {
	return transfer.types.includes(FILE_DRAG_TYPE);
}

export function draggedFile(transfer: DataTransfer): DraggedFile | null {
	const raw = transfer.getData(FILE_DRAG_TYPE);
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"path" in parsed &&
			typeof parsed.path === "string" &&
			"kind" in parsed &&
			(parsed.kind === "dir" || parsed.kind === "file")
		) {
			return { path: parsed.path, kind: parsed.kind };
		}
	} catch {}
	return null;
}
