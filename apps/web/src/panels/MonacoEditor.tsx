import { type EditorSelectionChange, MonacoEditor as KitMonacoEditor } from "@thinkrail/ui/editor";
import type { editor } from "monaco-editor/esm/vs/editor/editor.api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ResourceViewProps, SurfaceReview } from "@/resources";
import { LoadingRegion } from "../components/Skeleton";
import { useAppStore } from "../store";
import { reportIdeDocumentClosed } from "../transport";
import { emitEditorEvent, findEditorRef } from "./editorEvents";
import { MonacoReviewZones } from "./MonacoReviewZones";
import {
	applyReviewDecorations,
	attachReviewCommenting,
	attachReviewThreads,
	type MonacoReviewZoneState,
} from "./reviewWidgets";
import { sendSelectionToChat } from "./sendSelectionToChat";

function reviewFocusLine(review: SurfaceReview): number | null {
	const range = review.focus?.anchor.selectors.find((selector) => selector.kind === "lineRange");
	return range?.kind === "lineRange" ? range.startLine : null;
}

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
	const threadsRef = useRef<ReturnType<typeof attachReviewThreads> | null>(null);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const decorationsRef = useRef<string[]>([]);
	const [reviewZones, setReviewZones] = useState<MonacoReviewZoneState>({
		threads: [],
		composer: null,
	});

	const closeComposer = useCallback(() => threadsRef.current?.closeComposer(), []);
	const layoutReviewZones = useCallback(() => threadsRef.current?.layout(), []);
	const syncThreads = useCallback((target: SurfaceReview) => {
		if (!editorRef.current) return;
		threadsRef.current?.setThreads(target.threads);
		decorationsRef.current = applyReviewDecorations(
			editorRef.current,
			decorationsRef.current,
			target.threads,
		);
	}, []);

	const onEditorMount = (codeEditor: editor.IStandaloneCodeEditor) => {
		editorRef.current = codeEditor;
		if (!review) return undefined;
		const threads = attachReviewThreads(codeEditor, setReviewZones);
		const detach = attachReviewCommenting(codeEditor, threads);
		threadsRef.current = threads;
		syncThreads(review);
		const line = reviewFocusLine(review);
		if (line !== null) {
			codeEditor.revealLineInCenter(line);
			review.onFocusHandled();
		}
		return () => {
			detach();
			threads.dispose();
		};
	};

	useEffect(() => {
		if (review) syncThreads(review);
	}, [review, syncThreads]);

	useEffect(() => {
		if (!review || !editorRef.current) return;
		const line = reviewFocusLine(review);
		if (line === null) return;
		editorRef.current.revealLineInCenter(line);
		review.onFocusHandled();
	}, [review]);

	const text = content.kind === "text" ? content.text : "";
	return (
		<KitMonacoEditor
			path={resource.path}
			content={text}
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
			onEditorMount={onEditorMount}
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
		>
			<MonacoReviewZones
				zones={reviewZones}
				review={review}
				onCloseComposer={closeComposer}
				onRendered={layoutReviewZones}
			/>
		</KitMonacoEditor>
	);
}
