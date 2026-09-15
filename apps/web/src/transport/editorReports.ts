import { emitEditorEvent, findEditorRef } from "../panels/editorEvents";

interface ReportedSelection {
	workspaceId: string;
	path: string;
	text: string;
	selection: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}

/**
 * Feeds a selection into the generic editor-event stream (W12, `panels/editorEvents.ts`) by workspace and
 * path rather than a live `EditorRef`, for callers that only have those two — `apps/web/src/plugins/loader/
 * context.ts`'s `editors.reportSelection` among them. An empty `text` reports presence only, the same
 * convention `MonacoEditor`'s own direct `emitEditorEvent` call uses for an empty selection.
 */
export function reportIdeSelection(payload: ReportedSelection): void {
	const ref = findEditorRef(payload.workspaceId, payload.path);
	if (!ref) return;
	emitEditorEvent({
		kind: "selection",
		editor: ref,
		selection: payload.text === "" ? null : { ...payload.selection, text: payload.text },
	});
}

/** Presence only, no selection — which file the user is *in*. */
export function reportIdeActiveFile(workspaceId: string, path: string): void {
	const ref = findEditorRef(workspaceId, path);
	if (ref) emitEditorEvent({ kind: "selection", editor: ref, selection: null });
}

export function reportIdeDocumentClosed(workspaceId: string, path: string): void {
	const ref = findEditorRef(workspaceId, path);
	if (ref) emitEditorEvent({ kind: "closed", editor: ref });
}
