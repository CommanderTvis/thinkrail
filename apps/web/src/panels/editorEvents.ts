import type { EditorTab } from "../store";
import { useAppStore } from "../store";
import { isFileTabDirty } from "./fileSave";

export interface EditorRef {
	id: string;
	workspaceId: string;
	path: string;
	kind: "file" | "external-file" | "diff";
	dirty: boolean;
}

export type EditorEvent =
	| { kind: "opened" | "closed" | "activated" | "saved"; editor: EditorRef }
	| {
			kind: "selection";
			editor: EditorRef;
			selection: {
				startLine: number;
				startColumn: number;
				endLine: number;
				endColumn: number;
				text: string;
			} | null;
	  };

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
