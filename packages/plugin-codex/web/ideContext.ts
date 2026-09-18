import type { EditorEvent, EditorRef, PluginWebContext } from "@thinkrail/plugin-api/web";
import type { CodexIdeContext, codexContract } from "../contracts";

type Selection = Extract<EditorEvent, { kind: "selection" }>["selection"];

export function editorContext(
	editors: readonly EditorRef[],
	active: EditorRef | null,
	selection: Selection,
): CodexIdeContext {
	const files = editors.filter((editor) => editor.kind !== "diff");
	const descriptor = (editor: EditorRef) => ({
		label: editor.path.split(/[\\/]/).at(-1) ?? editor.path,
		path: editor.path,
	});
	const current = files.find((editor) => editor.id === active?.id);
	return {
		openTabs: files.map(descriptor),
		activeFile: current
			? {
					...descriptor(current),
					selection: {
						start: {
							line: Math.max(0, (selection?.startLine ?? 1) - 1),
							character: Math.max(0, (selection?.startColumn ?? 1) - 1),
						},
						end: {
							line: Math.max(0, (selection?.endLine ?? 1) - 1),
							character: Math.max(0, (selection?.endColumn ?? 1) - 1),
						},
					},
					activeSelectionContent: selection?.text ?? "",
				}
			: null,
	};
}

export function registerIdeContext(ctx: PluginWebContext<typeof codexContract>): () => void {
	const selections = new Map<string, Selection>();
	const activeEditors = new Map<string, EditorRef>();
	const rememberActive = () => {
		const active = ctx.host().activeEditor;
		if (active && active.kind !== "diff") activeEditors.set(active.workspaceId, active);
	};
	rememberActive();
	const unwatch = ctx.watchHost((host) => host.activeEditor, rememberActive);
	const unobserve = ctx.editors.onEvent((event) => {
		if (event.kind === "selection") {
			selections.set(event.editor.id, event.selection);
			activeEditors.set(event.editor.workspaceId, event.editor);
		} else if (event.kind === "closed") {
			selections.delete(event.editor.id);
			if (activeEditors.get(event.editor.workspaceId)?.id === event.editor.id)
				activeEditors.delete(event.editor.workspaceId);
		}
	});
	const unsubscribe = ctx.subscribe("ideRequest", ({ requestId, workspaceId }) => {
		const host = ctx.host();
		if (host.activeWorkspaceId !== workspaceId) return;
		const active = host.activeEditor ?? activeEditors.get(workspaceId) ?? null;
		const context = editorContext(
			ctx.editors.list(workspaceId),
			active,
			active ? (selections.get(active.id) ?? null) : null,
		);
		void ctx
			.request("ideReply", { requestId, workspaceId, context, focused: document.hasFocus() })
			.catch(() => {});
	});
	return () => {
		unwatch();
		unobserve();
		unsubscribe();
	};
}
