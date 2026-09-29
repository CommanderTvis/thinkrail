export { describeResource } from "./describe";
export {
	registerResourceRenderer,
	resolveRenderers,
	resourceRendererRevision,
	subscribeResourceRenderers,
} from "./registry";
export { anchorLabel, isPlaceable } from "./review";
export type {
	AnchorDraft,
	HunkActions,
	ResourceAnchorCapability,
	ResourceContent,
	ResourceDescriptor,
	ResourceDiffProps,
	ResourceEdit,
	ResourceEnvironment,
	ResourceIntent,
	ResourceRenderer,
	ResourceViewProps,
	ReviewThread,
	ReviewThreadActions,
	SurfaceReview,
} from "./types";
