import MonacoReact, { type OnMount } from "@monaco-editor/react";
import type { editor, Selection } from "monaco-editor/esm/vs/editor/editor.api.js";
import { type ReactNode, use, useCallback, useEffect, useRef, useState } from "react";
import { MonacoReviewZones } from "@/panels/MonacoReviewZones";
import { decorateEditorContextMenus } from "@/panels/monacoMenuIcons";
import {
	EDITOR_THEME,
	fileEditorOptions,
	languageForPath,
	monacoSetup,
	watchThemeSwap,
} from "@/panels/monacoSetup";
import {
	applyReviewDecorations,
	attachReviewCommenting,
	attachReviewThreads,
	type MonacoReviewZoneState,
} from "@/panels/reviewWidgets";
import type { SurfaceReview } from "@/resources";

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

function reviewFocusLine(review: SurfaceReview): number | null {
	const range = review.focus?.anchor.selectors.find((selector) => selector.kind === "lineRange");
	return range?.kind === "lineRange" ? range.startLine : null;
}

function isEditorViewState(value: unknown): value is editor.ICodeEditorViewState {
	if (typeof value !== "object" || value === null) return false;
	return Array.isArray(Reflect.get(value, "cursorState")) && Reflect.has(value, "viewState");
}

export function MonacoEditor({
	path,
	content,
	review,
	viewState,
	onViewState,
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
	review?: SurfaceReview | undefined;
	viewState?: unknown;
	onViewState?: ((state: unknown) => void) | undefined;
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
	use(monacoSetup);
	const stopThemeWatchRef = useRef<(() => void) | null>(null);
	const menuIconsRef = useRef<{ dispose(): void } | null>(null);
	const detachRef = useRef<(() => void) | null>(null);
	const threadsRef = useRef<ReturnType<typeof attachReviewThreads> | null>(null);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const decorationsRef = useRef<string[]>([]);
	const [reviewZones, setReviewZones] = useState<MonacoReviewZoneState>({
		threads: [],
		composer: null,
	});
	const onViewStateRef = useRef(onViewState);
	onViewStateRef.current = onViewState;
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

	const onMount: OnMount = (codeEditor, m) => {
		stopThemeWatchRef.current = watchThemeSwap();
		editorRef.current = codeEditor;
		menuIconsRef.current = decorateEditorContextMenus(codeEditor);
		if (isEditorViewState(viewState)) codeEditor.restoreViewState(viewState);
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
			if (!codeEditor.getModel()) return;
			const range = event.selection;
			selectionChangeRef.current?.({
				...selectionForChat(codeEditor, range),
				path: pathRef.current,
				workspaceId: ws,
				startColumn: range.startColumn,
				endColumn: range.endColumn,
				empty: range.isEmpty(),
			});
		});
		if (review) {
			threadsRef.current = attachReviewThreads(codeEditor, setReviewZones);
			detachRef.current = attachReviewCommenting(codeEditor, threadsRef.current);
			syncThreads(review);
			const line = reviewFocusLine(review);
			if (line !== null) {
				codeEditor.revealLineInCenter(line);
				review.onFocusHandled();
			}
		}
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

	useEffect(() => {
		if (focusLine === undefined || !editorRef.current) return;
		revealAt(editorRef.current, focusLine);
		onFocusHandled?.();
	}, [focusLine, onFocusHandled]);

	useEffect(
		() => () => {
			const saved = editorRef.current?.saveViewState();
			if (saved) onViewStateRef.current?.(saved);
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
		<>
			<MonacoReact
				height="100%"
				path={path}
				value={content}
				language={languageForPath(path)}
				theme={EDITOR_THEME}
				onMount={onMount}
				loading={loading}
				onChange={(value) => onChange?.(value ?? "")}
				options={{
					...fileEditorOptions(lineWidth, lineWidthBounded, path, gpuRendering, ligatures),
					readOnly: !editable,
				}}
			/>
			<MonacoReviewZones
				zones={reviewZones}
				review={review}
				onCloseComposer={closeComposer}
				onRendered={layoutReviewZones}
			/>
		</>
	);
}
