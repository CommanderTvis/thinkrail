import { useT } from "@thinkrail/locales/react";
import { type editor, KeyCode, type Selection } from "monaco-editor/editor/editor.api.js";
import { useId, useLayoutEffect, useRef, useState } from "react";
import {
	type EditorSelectionChange,
	type ResourceHost,
	useResourceHost,
	useResourcePreferences,
} from "../host";
import type { ResourceDescriptor, ResourceViewProps, SurfaceReview } from "../registry";
import { MonacoReviewZones } from "./MonacoReviewZones";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	createFileEditor,
	disposeFileEditor,
	ensureMonaco,
	fileEditorOptions,
	languageForPath,
	revealLineNow,
	syncFileModel,
	warmLanguage,
} from "./monacoSetup";
import {
	applyReviewDecorations,
	attachReviewCommenting,
	attachReviewThreads,
	type MonacoReviewZoneState,
	type ReviewCommenting,
} from "./reviewWidgets";

function focusLine(review: SurfaceReview): number | null {
	const range = review.focus?.anchor.selectors.find((selector) => selector.kind === "lineRange");
	return range?.kind === "lineRange" ? range.startLine : null;
}

/**
 * What the chat is handed: the selected text and the lines it covers, with a trailing line the user did
 * not really select trimmed off — a selection ending in column 1 of the next line. See SPEC.md.
 */
function selectionChange(
	codeEditor: editor.IStandaloneCodeEditor,
	range: Selection,
	workspaceId: string,
	path: string,
): EditorSelectionChange {
	const model = codeEditor.getModel();
	return {
		workspaceId,
		path,
		text: model?.getValueInRange(range) ?? "",
		language: model?.getLanguageId() ?? "",
		startLine: range.startLineNumber,
		startColumn: range.startColumn,
		endLine:
			range.endColumn === 1 && range.endLineNumber > range.startLineNumber
				? range.endLineNumber - 1
				: range.endLineNumber,
		endColumn: range.endColumn,
		endColumnLine: range.endLineNumber,
		empty: range.isEmpty(),
	};
}

function revealAt(codeEditor: editor.IStandaloneCodeEditor, line: number): void {
	codeEditor.setPosition({ lineNumber: line, column: 1 });
	codeEditor.revealLineInCenter(line);
}

function isEditorViewState(value: unknown): value is editor.ICodeEditorViewState {
	if (typeof value !== "object" || value === null) return false;
	return Array.isArray(Reflect.get(value, "cursorState")) && Reflect.has(value, "viewState");
}

export function warm(host: ResourceHost, resource: ResourceDescriptor): void {
	ensureMonaco(host.code);
	setTimeout(() => warmLanguage(languageForPath(resource.path)), 0);
}

export default function MonacoEditor({
	resource,
	content,
	review,
	viewState,
	onViewState,
	edit,
	focusLine: lineToFocus,
	onFocusHandled,
}: ResourceViewProps) {
	const t = useT();
	const {
		fileLineWidth,
		fileLineWidthBounded,
		editorGpuRendering = false,
		codeFontLigatures = false,
	} = useResourcePreferences();
	const host = useResourceHost();
	ensureMonaco(host.code);
	const scope = useId().replace(/[^\w-]/g, "");
	const path = resource.path;
	const text = content.kind === "text" ? content.text : "";
	const commentLabel = t("review.widget.commentOnSelection");
	const sendLabel = t("panels.monacoEditor.sendSelectionToChat");
	const editable = edit !== undefined;
	const baseOptions = fileEditorOptions(
		t,
		fileLineWidth,
		fileLineWidthBounded,
		resource.path,
		editorGpuRendering,
		codeFontLigatures,
	);
	const options = editable ? { ...baseOptions, readOnly: false } : baseOptions;
	const containerRef = useRef<HTMLDivElement | null>(null);
	const commentingRef = useRef<ReviewCommenting | null>(null);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const threadsRef = useRef<ReturnType<typeof attachReviewThreads> | null>(null);
	const decorationsRef = useRef<string[]>([]);
	const freshMountRef = useRef(false);
	const appliedRef = useRef({ scope, path, text, options });
	const latestRef = useRef({
		scope,
		path,
		text,
		options,
		commentLabel,
		viewState,
		review,
		onViewState,
		sendLabel,
		edit,
		events: host.editor,
		workspaceId: resource.workspaceId,
		lineToFocus,
		onFocusHandled,
	});
	const [reviewZones, setReviewZones] = useState<MonacoReviewZoneState>({
		threads: [],
		composer: null,
	});

	useLayoutEffect(() => {
		latestRef.current = {
			scope,
			path,
			text,
			options,
			commentLabel,
			viewState,
			review,
			onViewState,
			sendLabel,
			edit,
			events: host.editor,
			workspaceId: resource.workspaceId,
			lineToFocus,
			onFocusHandled,
		};
	});

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const mount = latestRef.current;
		const codeEditor = createFileEditor(container, mount);
		editorRef.current = codeEditor;
		freshMountRef.current = true;
		appliedRef.current = {
			scope: mount.scope,
			path: mount.path,
			text: mount.text,
			options: mount.options,
		};
		const menuIcons = decorateEditorContextMenus(codeEditor);
		if (isEditorViewState(mount.viewState)) codeEditor.restoreViewState(mount.viewState);
		const threads = mount.review ? attachReviewThreads(codeEditor, setReviewZones) : null;
		const commenting = threads
			? attachReviewCommenting(codeEditor, threads, mount.commentLabel)
			: null;
		threadsRef.current = threads;
		commentingRef.current = commenting;
		if (mount.lineToFocus !== undefined) {
			revealAt(codeEditor, mount.lineToFocus);
			mount.onFocusHandled?.();
		}
		const currentSelection = (range: Selection) => {
			const latest = latestRef.current;
			return selectionChange(codeEditor, range, latest.workspaceId, latest.path);
		};
		const sendSelection = (): void => {
			const range = codeEditor.getSelection();
			if (!range || range.isEmpty() || !codeEditor.getModel()) return;
			latestRef.current.events?.sendToChat(currentSelection(range));
		};
		// Ctrl/Cmd+S is the editor's, never the window's — see SPEC.md.
		const keys = codeEditor.onKeyDown((event) => {
			if (!(event.ctrlKey || event.metaKey)) return;
			if (event.keyCode === KeyCode.KeyS && !event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				latestRef.current.edit?.onSave();
				return;
			}
			if (event.keyCode === KeyCode.KeyL && event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				sendSelection();
			}
		});
		const chatAction = mount.events
			? codeEditor.addAction({
					id: `thinkrail.chat.sendSelection.${codeEditor.getId()}`,
					label: mount.sendLabel,
					precondition: "editorHasSelection",
					contextMenuGroupId: "9_cutcopypaste",
					contextMenuOrder: 3,
					run: sendSelection,
				})
			: null;
		const selection = codeEditor.onDidChangeCursorSelection((event) => {
			if (!codeEditor.getModel()) return;
			latestRef.current.events?.selectionChange(currentSelection(event.selection));
		});
		const changes = codeEditor.onDidChangeModelContent((event) => {
			if (event.isFlush) return;
			latestRef.current.edit?.onChange(codeEditor.getValue());
		});
		return () => {
			keys.dispose();
			chatAction?.dispose();
			selection.dispose();
			changes.dispose();
			const latest = latestRef.current;
			latest.events?.close(latest.workspaceId, latest.path);
			const saved = codeEditor.saveViewState();
			if (saved) latestRef.current.onViewState?.(saved);
			menuIcons.dispose();
			commenting?.dispose();
			threads?.dispose();
			threadsRef.current = null;
			commentingRef.current = null;
			editorRef.current = null;
			decorationsRef.current = [];
			disposeFileEditor(codeEditor);
		};
	}, []);

	useLayoutEffect(() => {
		const codeEditor = editorRef.current;
		const applied = appliedRef.current;
		if (
			!codeEditor ||
			(applied.scope === scope && applied.path === path && applied.text === text)
		) {
			return;
		}
		syncFileModel(codeEditor, { scope, path, text }, applied.text);
		appliedRef.current = { ...applied, scope, path, text };
	}, [scope, path, text]);

	useLayoutEffect(() => {
		commentingRef.current?.setLabel(commentLabel);
	}, [commentLabel]);

	useLayoutEffect(() => {
		const codeEditor = editorRef.current;
		if (!codeEditor || appliedRef.current.options === options) return;
		appliedRef.current = { ...appliedRef.current, options };
		codeEditor.updateOptions(options);
	}, [options]);

	useLayoutEffect(() => {
		const codeEditor = editorRef.current;
		if (lineToFocus === undefined || !codeEditor) return;
		revealAt(codeEditor, lineToFocus);
		onFocusHandled?.();
	}, [lineToFocus, onFocusHandled]);

	const closeComposer = () => threadsRef.current?.closeComposer();
	const layoutReviewZones = () => threadsRef.current?.layout();

	useLayoutEffect(() => {
		const codeEditor = editorRef.current;
		const freshMount = freshMountRef.current;
		freshMountRef.current = false;
		if (!review || !codeEditor) return;
		threadsRef.current?.setThreads(review.threads);
		decorationsRef.current = applyReviewDecorations(
			codeEditor,
			decorationsRef.current,
			review.threads,
		);
		const line = focusLine(review);
		if (line === null) return;
		if (freshMount) revealLineNow(codeEditor, line);
		else codeEditor.revealLineInCenter(line);
		review.onFocusHandled();
	}, [review]);

	return (
		<>
			<div ref={containerRef} className="h-full w-full text-left" />
			<MonacoReviewZones
				zones={reviewZones}
				review={review}
				onCloseComposer={closeComposer}
				onRendered={layoutReviewZones}
			/>
		</>
	);
}
