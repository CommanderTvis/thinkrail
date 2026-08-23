import MonacoReact, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { LoadingRegion } from "../components/Skeleton";
import { reportIdeDocumentClosed, reportIdeSelection } from "../transport";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	defineThinkrailTheme,
	EDITOR_THEME,
	sharedEditorOptions,
	watchThemeSwap,
} from "./monacoSetup";
import { applyReviewDecorations } from "./reviewGutter";
import { attachReviewCommenting, attachReviewThreads } from "./reviewWidgets";
import type { EditorReview } from "./useReviewCommenting";

const beforeMount: BeforeMount = (m) => defineThinkrailTheme(m);

function revealAt(codeEditor: editor.IStandaloneCodeEditor, line: number): void {
	codeEditor.setPosition({ lineNumber: line, column: 1 });
	codeEditor.revealLineInCenter(line);
}

export default function MonacoEditor({
	path,
	content,
	review,
	focusLine,
	onFocusHandled,
	workspaceId,
}: {
	path: string;
	content: string;
	review?: EditorReview;
	focusLine?: number | undefined;
	onFocusHandled?: (() => void) | undefined;
	workspaceId?: string | undefined;
}) {
	const stopThemeWatchRef = useRef<(() => void) | null>(null);
	const menuIconsRef = useRef<{ dispose(): void } | null>(null);
	const detachRef = useRef<(() => void) | null>(null);
	const threadsRef = useRef<ReturnType<typeof attachReviewThreads> | null>(null);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const decorationsRef = useRef<string[]>([]);
	const reviewRef = useRef(review);
	reviewRef.current = review;
	const focusLineRef = useRef(focusLine);
	focusLineRef.current = focusLine;
	const focusHandledRef = useRef(onFocusHandled);
	focusHandledRef.current = onFocusHandled;
	const workspaceIdRef = useRef(workspaceId);
	workspaceIdRef.current = workspaceId;
	const pathRef = useRef(path);
	pathRef.current = path;
	const selectionRef = useRef<{ dispose(): void } | null>(null);

	const syncThreads = useCallback((target: EditorReview) => {
		if (!editorRef.current) return;
		threadsRef.current?.setThreads(target.threads);
		decorationsRef.current = applyReviewDecorations(
			editorRef.current,
			decorationsRef.current,
			target.threads,
		);
	}, []);

	const onMount: OnMount = (codeEditor, m) => {
		stopThemeWatchRef.current = watchThemeSwap(m, EDITOR_THEME);
		editorRef.current = codeEditor;
		menuIconsRef.current = decorateEditorContextMenus(codeEditor);
		// A link-opened tab already has its line when the loader resolves, after the effect below ran.
		if (focusLineRef.current !== undefined) {
			revealAt(codeEditor, focusLineRef.current);
			focusHandledRef.current?.();
		}
		selectionRef.current = codeEditor.onDidChangeCursorSelection((event) => {
			const ws = workspaceIdRef.current;
			if (!ws) return;
			const model = codeEditor.getModel();
			if (!model) return;
			const range = event.selection;
			reportIdeSelection({
				workspaceId: ws,
				path: pathRef.current,
				text: model.getValueInRange(range),
				selection: {
					startLine: range.startLineNumber,
					startColumn: range.startColumn,
					endLine: range.endLineNumber,
					endColumn: range.endColumn,
				},
			});
		});
		if (review) {
			detachRef.current = attachReviewCommenting(codeEditor, {
				onSave: (s, t) => reviewRef.current?.commenting.onSave(s, t) ?? Promise.resolve(),
				onSend: (s, t) => reviewRef.current?.commenting.onSend(s, t) ?? Promise.resolve(),
			});
			threadsRef.current = attachReviewThreads(codeEditor, {
				onSendComment: (id) => reviewRef.current?.actions.onSendComment(id) ?? Promise.resolve(),
				onDeleteComment: (id) =>
					reviewRef.current?.actions.onDeleteComment(id) ?? Promise.resolve(),
				onUpdateComment: (id, body) =>
					reviewRef.current?.actions.onUpdateComment(id, body) ?? Promise.resolve(),
			});
			syncThreads(review);
			const focus = reviewRef.current?.focus;
			if (focus) {
				codeEditor.revealLineInCenter(focus.line);
				reviewRef.current?.onFocusHandled();
			}
		}
	};

	useEffect(() => {
		if (review) syncThreads(review);
	}, [review, syncThreads]);

	useEffect(() => {
		if (!review?.focus || !editorRef.current) return;
		editorRef.current.revealLineInCenter(review.focus.line);
		review.onFocusHandled();
	}, [review]);

	useEffect(() => {
		if (focusLine === undefined || !editorRef.current) return;
		revealAt(editorRef.current, focusLine);
		onFocusHandled?.();
	}, [focusLine, onFocusHandled]);

	useEffect(
		() => () => {
			stopThemeWatchRef.current?.();
			menuIconsRef.current?.dispose();
			detachRef.current?.();
			threadsRef.current?.dispose();
			selectionRef.current?.dispose();
			const ws = workspaceIdRef.current;
			if (ws) reportIdeDocumentClosed(ws, pathRef.current);
		},
		[],
	);

	return (
		<MonacoReact
			height="100%"
			path={path}
			value={content}
			theme={EDITOR_THEME}
			beforeMount={beforeMount}
			onMount={onMount}
			loading={<LoadingRegion rows={12} className="h-full w-full p-12" />}
			options={sharedEditorOptions()}
		/>
	);
}
