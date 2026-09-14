import type { EditorEvent, EditorRef } from "@thinkrail/plugin-api/web";
import type { EditorTab } from "../store";
import { useAppStore } from "../store";
import { isFileTabDirty } from "./fileSave";

type EditorEventHandler = (event: EditorEvent) => void;

const handlers = new Set<EditorEventHandler>();

export function emitEditorEvent(event: EditorEvent): void {
	for (const handler of handlers) handler(event);
}

export function onEditorEvent(handler: EditorEventHandler): () => void {
	handlers.add(handler);
	return () => {
		handlers.delete(handler);
	};
}

export function findEditorRef(workspaceId: string, path: string): EditorRef | null {
	const tab = (useAppStore.getState().tabsByWorkspace[workspaceId] ?? []).find(
		(candidate): candidate is Extract<EditorTab, { kind: "file" | "external-file" }> =>
			(candidate.kind === "file" || candidate.kind === "external-file") && candidate.path === path,
	);
	if (!tab) return null;
	return { id: tab.id, workspaceId, path, kind: tab.kind, dirty: isFileTabDirty(tab) };
}
