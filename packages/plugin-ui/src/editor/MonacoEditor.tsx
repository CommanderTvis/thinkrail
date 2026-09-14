import MonacoReact, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type { editor, Selection } from "monaco-editor";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	defineThinkrailTheme,
	EDITOR_THEME,
	sharedEditorOptions,
	watchThemeSwap,
} from "./monacoSetup";
import { applyReviewDecorations } from "./reviewGutter";
import type { EditorReview } from "./reviewTypes";
import { attachReviewCommenting, attachReviewThreads } from "./reviewWidgets";

const beforeMount: BeforeMount = (m) => defineThinkrailTheme(m);

export interface EditorSelectionChange {
	workspaceId: string;
	path: string;
	text: string;
	language: string;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	empty: boolean;
}

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

export function MonacoEditor({
	path,
	content,
	review,
	focusLine,
	onFocusHandled,
	workspaceId,
	editable,
	onChange,
	onSave,
	lineWidth,
	lineWidthBounded,
	gpuRendering = false,
	ligatures = false,
	onSelectionChange,
	onSendToChat,
	onClose,
	loading,
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
	lineWidth: number;
	lineWidthBounded: boolean;
	gpuRendering?: boolean;
	ligatures?: boolean;
	onSelectionChange?: ((change: EditorSelectionChange) => void) | undefined;
	onSendToChat?: ((change: EditorSelectionChange) => void) | undefined;
	onClose?: ((workspaceId: string, path: string) => void) | undefined;
	loading?: ReactNode;
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
	const selectionChangeRef = useRef(onSelectionChange);
	selectionChangeRef.current = onSelectionChange;
	const sendToChatRef = useRef(onSendToChat);
	sendToChatRef.current = onSendToChat;
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

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
			sendToChatRef.current?.({
				...selectionForChat(codeEditor, range),
				path: pathRef.current,
				workspaceId: ws,
				startColumn: range.startColumn,
				endColumn: range.endColumn,
				empty: false,
			});
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
			selectionChangeRef.current?.({
				...selectionForChat(codeEditor, range),
				endLine: range.endLineNumber,
				path: pathRef.current,
				workspaceId: ws,
				startColumn: range.startColumn,
				endColumn: range.endColumn,
				empty: range.isEmpty(),
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
			closeRef.current?.(ws, pathRef.current);
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
			loading={loading}
			onChange={(value) => onChange?.(value ?? "")}
			options={{
				...sharedEditorOptions(lineWidth, lineWidthBounded, gpuRendering, ligatures),
				readOnly: !editable,
			}}
		/>
	);
}
