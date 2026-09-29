export {
	type EditorSelectionChange,
	type MarkdownRehypePlugins,
	type ResourceCodeHost,
	type ResourceCodeLanguage,
	type ResourceEditorEvents,
	ResourceEnvironmentProvider,
	type ResourceFileReviewProps,
	type ResourceHost,
	ResourceHostProvider,
	type ResourceMarkdown,
	type ResourceMarkdownProps,
	type ResourcePreferences,
	ResourcePreferencesProvider,
	type ResourceReviewSendProps,
	type ResourceScope,
	ResourceScopeProvider,
	useOptionalResourceHost,
	useResourceScope,
} from "./host";
export {
	type AnchorDraft,
	anchorLabel,
	canonicalWorkspacePath,
	describeResource,
	diffRendererCapabilities,
	diffResourceMeta,
	type HunkActions,
	type HunkTriage,
	isPlaceable,
	outdatedReason,
	PENDING_TEXT_META,
	type ResourceAnchorCapability,
	type ResourceContent,
	type ResourceDescriptor,
	type ResourceDiffProps,
	type ResourceEdit,
	type ResourceEnvironment,
	type ResourceIntent,
	type ResourceRenderer,
	type ResourceViewModule,
	type ResourceViewProps,
	type ReviewThread,
	type ReviewThreadActions,
	registerResourceRenderer,
	rendererImplementationKey,
	rendererLabel,
	rendererTestId,
	resolveRenderers,
	resourceContent,
	resourceRendererRevision,
	type SurfaceReview,
	selectResourceRenderer,
	subscribeResourceRenderers,
	threadLabel,
} from "./registry";
export { createAskAgentRequest } from "./renderers/code/changeBlocks";
export { registerBundledResourceRenderers } from "./renderers/register";
export { ReviewDraftContext, type ReviewDraftPersistence } from "./renderers/reviewDraftState";
export { editorFontSize, editorGpuUsable } from "./support/editorFont";
export { stripFrontmatter } from "./support/frontmatter";
export { GuardedRendererDiff } from "./support/GuardedRendererDiff";
export { surfaceLineCount, VIRTUALIZED_DIFF_LINES } from "./support/largeDiff";
export { slugify } from "./support/markdownLinks";
export { type RendererLayout, RendererToggles } from "./support/RendererToggles";
export {
	ResourcePreview,
	type ResourcePreviewLayout,
	type ResourcePreviewProps,
} from "./support/ResourcePreview";
export { ReviewThreadCard } from "./support/ReviewThreadCard";
export {
	RendererView,
	usePlacedThreadIds,
	usePreloadResourceView,
	useRendererSelection,
} from "./support/rendererMount";
export { frontmatterOffset } from "./support/sourceLines";
export { UnplacedReviewStrip } from "./support/UnplacedReviewStrip";
export { useScrollViewState, viewStateScrollTop } from "./support/useScrollViewState";
export {
	clampZoomScale,
	isZoomGesture,
	ZOOM_SCALE_STEP,
	zoomScaleForWheel,
} from "./support/zoomGesture";
