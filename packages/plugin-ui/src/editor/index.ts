export { applyCodeFont, cssVar, editorFontSize } from "./editorFont";
export { editorWrappingOptions } from "./editorWrapping";
export { type EditorSelectionChange, MonacoEditor } from "./MonacoEditor";
export { decorateEditorContextMenus } from "./monacoMenuIcons";
export {
	defineThinkrailTheme,
	EDITOR_THEME,
	gpuAcceleration,
	languageForPath,
	sharedEditorOptions,
	THEME,
	watchThemeSwap,
} from "./monacoSetup";
export { applyReviewDecorations, type LineSelection } from "./reviewGutter";
export type { EditorReview, SideReview } from "./reviewTypes";
export {
	attachReviewCommenting,
	attachReviewThreads,
	type ReviewCommentingCallbacks,
	type ReviewThreadActions,
	type ReviewThreadData,
	threadLabel,
} from "./reviewWidgets";
