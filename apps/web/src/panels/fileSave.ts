import type { FileWriteResult } from "@thinkrail/contracts";
import { isAbsolutePath, mergeText } from "../lib";
import { type EditorTab, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";

interface Buffer {
	workspaceId: string;
	id: string;
	path: string;
	content: string;
	hash: string;
	draft: string;
	external?: { content: string; hash: string };
}

function bufferOf(workspaceId: string, tabId: string): Buffer | null {
	const tabs: EditorTab[] = useAppStore.getState().tabsByWorkspace[workspaceId] ?? [];
	const tab = tabs.find((candidate) => candidate.id === tabId);
	if (!tab || (tab.kind !== "file" && tab.kind !== "external-file")) return null;
	return {
		workspaceId,
		id: tab.id,
		path: tab.path,
		content: tab.content,
		hash: tab.hash ?? "",
		draft: tab.draft ?? tab.content,
		...(tab.external ? { external: tab.external } : {}),
	};
}

export function isFileTabDirty(tab: EditorTab): boolean {
	if (tab.kind !== "file" && tab.kind !== "external-file") return false;
	return tab.draft !== undefined && tab.draft !== tab.content;
}

/** Folds what is on disk into the buffer without writing anything — the banner's "merge now". */
export function mergeDiskIntoDraft(workspaceId: string, tabId: string): void {
	const buffer = bufferOf(workspaceId, tabId);
	const disk = buffer?.external;
	if (!buffer || !disk) return;
	const merged = mergeText(buffer.content, buffer.draft, disk.content);
	useAppStore.getState().applyFileTabMerge(workspaceId, tabId, merged.text, disk);
	if (merged.conflicts > 0) {
		toast.error(
			`${merged.conflicts} conflicting ${merged.conflicts === 1 ? "region" : "regions"} left marked in the buffer.`,
			"Merged with conflicts",
		);
	}
}

/**
 * Writes the buffer, but only over the content the editor last read. A file that moved underneath comes
 * back instead of being overwritten: it is merged into the buffer for another look, and saving again is
 * then an ordinary write against the newer base. See panels/SPEC.md.
 */
export async function saveFileTab(workspaceId: string, tabId: string): Promise<void> {
	const buffer = bufferOf(workspaceId, tabId);
	if (!buffer || buffer.draft === buffer.content) return;

	const params = {
		workspaceId,
		path: buffer.path,
		content: buffer.draft,
		baseHash: buffer.hash,
	};
	let result: FileWriteResult;
	try {
		result = isAbsolutePath(buffer.path)
			? await getTransport().request("claudeConfig.writeFile", params)
			: await getTransport().request("fs.writeFile", params);
	} catch (cause) {
		toast.error(errorText(cause), "Couldn't save the file");
		return;
	}

	if (result.written) {
		useAppStore.getState().settleFileTabSave(workspaceId, tabId, buffer.draft, result.hash);
		return;
	}

	const merged = mergeText(buffer.content, buffer.draft, result.disk.content);
	useAppStore.getState().applyFileTabMerge(workspaceId, tabId, merged.text, result.disk);
	toast.error(
		merged.conflicts > 0
			? `Changed on disk since you opened it. ${merged.conflicts} conflicting ${merged.conflicts === 1 ? "region is" : "regions are"} marked in the buffer — resolve them and save again.`
			: "Changed on disk since you opened it. Both sets of edits are in the buffer now — save again to write them.",
		"Not saved",
	);
}
