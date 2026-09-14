import type { EditorReview } from "@thinkrail/plugin-ui/editor";
import {
	type EditorSelectionChange,
	MonacoEditor as KitMonacoEditor,
} from "@thinkrail/plugin-ui/editor";
import { LoadingRegion } from "../components/Skeleton";
import { useAppStore } from "../store";
import { reportIdeDocumentClosed } from "../transport";
import { emitEditorEvent, findEditorRef } from "./editorEvents";
import { sendSelectionToChat } from "./sendSelectionToChat";

export default function MonacoEditor({
	path,
	content,
	review,
	focusLine,
	onFocusHandled,
	workspaceId,
	editable,
	onChange,
	onSave,
}: {
	path: string;
	content: string;
	review?: EditorReview;
	focusLine?: number | undefined;
	onFocusHandled?: (() => void) | undefined;
	workspaceId?: string | undefined;
	editable?: boolean | undefined;
	onChange?: ((value: string) => void) | undefined;
	onSave?: (() => void) | undefined;
}) {
	const fileLineWidth = useAppStore((state) => state.fileLineWidth);
	const fileLineWidthBounded = useAppStore((state) => state.fileLineWidthBounded);
	const editorGpu = useAppStore((state) => state.editorGpuRendering);
	const ligatures = useAppStore((state) => state.codeFontLigatures);

	return (
		<KitMonacoEditor
			path={path}
			content={content}
			{...(review ? { review } : {})}
			{...(focusLine !== undefined ? { focusLine } : {})}
			{...(onFocusHandled ? { onFocusHandled } : {})}
			{...(workspaceId !== undefined ? { workspaceId } : {})}
			{...(editable !== undefined ? { editable } : {})}
			{...(onChange ? { onChange } : {})}
			{...(onSave ? { onSave } : {})}
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
					text,
				} = change;
				useAppStore
					.getState()
					.setEditorSelection(
						ws,
						change.empty ? null : { text, startLine, endLine, language: change.language, path: p },
					);
				const ref = findEditorRef(ws, p);
				if (ref) {
					emitEditorEvent({
						kind: "selection",
						editor: ref,
						selection: change.empty ? null : { startLine, startColumn, endLine, endColumn, text },
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
