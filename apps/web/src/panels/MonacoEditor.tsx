import {
	type EditorSelectionChange,
	MonacoEditor as KitMonacoEditor,
} from "@/panels/MonacoEditorBase";
import type { ResourceViewProps } from "@/resources";
import { LoadingRegion } from "../components/Skeleton";
import { useAppStore } from "../store";
import { reportIdeDocumentClosed } from "../transport";
import { emitEditorEvent, findEditorRef } from "./editorEvents";
import { sendSelectionToChat } from "./sendSelectionToChat";

export default function MonacoEditor({
	resource,
	content,
	review,
	viewState,
	onViewState,
	edit,
	focusLine,
	onFocusHandled,
}: ResourceViewProps) {
	const fileLineWidth = useAppStore((state) => state.fileLineWidth);
	const fileLineWidthBounded = useAppStore((state) => state.fileLineWidthBounded);
	const editorGpu = useAppStore((state) => state.editorGpuRendering);
	const ligatures = useAppStore((state) => state.codeFontLigatures);

	const text = content.kind === "text" ? content.text : "";
	return (
		<KitMonacoEditor
			path={resource.path}
			content={text}
			review={review}
			viewState={viewState}
			onViewState={onViewState}
			focusLine={focusLine}
			onFocusHandled={onFocusHandled}
			workspaceId={resource.workspaceId}
			editable={edit !== undefined}
			onChange={edit?.onChange}
			onSave={edit?.onSave}
			lineWidth={fileLineWidth}
			lineWidthBounded={fileLineWidthBounded}
			gpuRendering={editorGpu}
			ligatures={ligatures}
			loading={<LoadingRegion rows={12} className="h-full w-full p-12" />}
			onSelectionChange={(change: EditorSelectionChange) => {
				const {
					workspaceId: ws,
					path: p,
					startLine,
					startColumn,
					endLine,
					endColumn,
					text: selected,
				} = change;
				useAppStore
					.getState()
					.setEditorSelection(
						ws,
						change.empty
							? null
							: { text: selected, startLine, endLine, language: change.language, path: p },
					);
				const ref = findEditorRef(ws, p);
				if (ref) {
					emitEditorEvent({
						kind: "selection",
						editor: ref,
						selection: change.empty
							? null
							: { startLine, startColumn, endLine, endColumn, text: selected },
					});
				}
			}}
			onSendToChat={(change: EditorSelectionChange) => {
				useAppStore.getState().detachEditorSelection(change.workspaceId);
				void sendSelectionToChat(change);
			}}
			onClose={(ws, p) => {
				useAppStore.getState().setEditorSelection(ws, null);
				reportIdeDocumentClosed(ws, p);
			}}
		/>
	);
}
