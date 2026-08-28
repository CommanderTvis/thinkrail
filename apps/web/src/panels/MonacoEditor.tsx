import MonacoReact, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type { editor, Selection } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { LoadingRegion } from "../components/Skeleton";
import { useAppStore } from "../store";
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
import { sendSelectionToChat } from "./sendSelectionToChat";
import type { EditorReview } from "./useReviewCommenting";

const beforeMount: BeforeMount = (m) => defineThinkrailTheme(m);

/**
 * What the chat is handed: the selected text and the lines it covers, with a trailing line the user did
 * not really select trimmed off — a selection ending in column 1 of the next line. See panels/SPEC.md.
 */
function selectionForChat(
	codeEditor: editor.IStandaloneCodeEditor,
	range: Selection,
): { text: string; startLine: number; endLine: number; language: string } {
	const model = codeEditor.getModel();
	return {
		text: model?.getValueInRange(range) ?? "",
		startLine: range.startLineNumber,
		endLine:
			range.endColumn === 1 && range.endLineNumber > range.startLineNumber
				? range.endLineNumber - 1
				: range.endLineNumber,
		language: model?.getLanguageId() ?? "",
	};
}

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
	const chatActionRef = useRef<{ dispose(): void } | null>(null);
	const saveRef = useRef(onSave);
	saveRef.current = onSave;

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
		const sendSelection = (): void => {
			const ws = workspaceIdRef.current;
			const range = codeEditor.getSelection();
			if (!ws || !range || range.isEmpty() || !codeEditor.getModel()) return;
			void sendSelectionToChat({
				...selectionForChat(codeEditor, range),
				path: pathRef.current,
				workspaceId: ws,
			});
			useAppStore.getState().detachEditorSelection(ws);
		};
		// Ctrl/Cmd+S is the editor's, never the window's — see panels/SPEC.md.
		codeEditor.onKeyDown((event) => {
			if (!(event.ctrlKey || event.metaKey)) return;
			if (event.keyCode === m.KeyCode.KeyS && !event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				saveRef.current?.();
				return;
			}
			if (event.keyCode === m.KeyCode.KeyL && event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				sendSelection();
			}
		});
		chatActionRef.current = codeEditor.addAction({
			id: `thinkrail.chat.sendSelection.${codeEditor.getId()}`,
			label: "Send selection to chat",
			precondition: "editorHasSelection",
			contextMenuGroupId: "9_cutcopypaste",
			contextMenuOrder: 3,
			run: sendSelection,
		});
		selectionRef.current = codeEditor.onDidChangeCursorSelection((event) => {
			const ws = workspaceIdRef.current;
			if (!ws) return;
			const model = codeEditor.getModel();
			if (!model) return;
			const range = event.selection;
			// The chat carries what is highlighted, so the store hears about it too — not only the Claude
			// bridge. An empty selection takes it back off. See panels/SPEC.md.
			useAppStore
				.getState()
				.setEditorSelection(
					ws,
					range.isEmpty()
						? null
						: { ...selectionForChat(codeEditor, range), path: pathRef.current },
				);
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
			chatActionRef.current?.dispose();
			const ws = workspaceIdRef.current;
			if (!ws) return;
			useAppStore.getState().setEditorSelection(ws, null);
			reportIdeDocumentClosed(ws, pathRef.current);
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
			onChange={(value) => onChange?.(value ?? "")}
			options={{ ...sharedEditorOptions(), readOnly: !editable }}
		/>
	);
}
