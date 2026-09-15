import { RiFileTransferLine as FileSymlink } from "@remixicon/react";
import {
	type ComponentType,
	type LazyExoticComponent,
	lazy,
	Suspense,
	useCallback,
	useMemo,
	useState,
} from "react";
import { OutlineColumn, OutlineToggle, scrollToHeading } from "@/panels/Outline";
import { EmbeddedSplit } from "../components/EmbeddedSplit";
import { LoadingRegion } from "../components/Skeleton";
import { abbreviateHomePath, isPhoneViewport, usePhoneViewport } from "../lib";
import {
	describeResource,
	type ResourceContent,
	type ResourceRenderer,
	type ResourceViewProps,
	resolveRenderers,
} from "../resources";
import { type ExternalFileTab, type FileTab, useAppStore } from "../store";
import { getTransport } from "../transport";
import { isFileTabDirty, mergeDiskIntoDraft, saveFileTab } from "./fileSave";
import { jsonKeyLine } from "./jsonKeyLine";
import { type HeadingEntry, sourceHeadings } from "./outlineTree";
import {
	PENDING_TEXT_META,
	rendererImplementationKey,
	rendererTestId,
	resourceBytesUrl,
	selectResourceRenderer,
	useResetViewStateOnImplementationChange,
} from "./resourcePane";
import { reviewFlagFor } from "./reviewModel";
import { SendReviewButton } from "./SendReviewButton";
import { ToggleSegment } from "./ToggleSegment";
import { UnplacedReviewStrip } from "./UnplacedReviewStrip";
import { useLiveTabContent } from "./useLiveTabContent";
import { useFileReview } from "./useReviewCommenting";

const MARKDOWN_RENDERER_ID = "thinkrail/markdown";

const loading = <LoadingRegion rows={12} className="h-full p-12" />;

function contentFor(tab: FileTab | ExternalFileTab): ResourceContent {
	const meta = tab.meta;
	const text = tab.draft ?? tab.content;
	if (!meta) return { kind: "text", text, hash: "" };
	if (meta.hash === null || meta.byteLength === null) return { kind: "absent" };
	if (meta.text) return { kind: "text", text, hash: meta.hash };
	return {
		kind: "bytes",
		url: resourceBytesUrl(tab.workspaceId, tab.path),
		hash: meta.hash,
		byteLength: meta.byteLength,
	};
}

const viewComponents = new Map<string, LazyExoticComponent<ComponentType<ResourceViewProps>>>();

function RendererView({
	renderer,
	implementationKey,
	...props
}: ResourceViewProps & { renderer: ResourceRenderer; implementationKey: string }) {
	let Component = viewComponents.get(implementationKey);
	if (!Component) {
		if (!renderer.loadView) {
			throw new Error(`Resource renderer has no view loader: ${renderer.id}`);
		}
		Component = lazy(renderer.loadView);
		viewComponents.set(implementationKey, Component);
	}
	return <Component {...props} />;
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
	if (left.size !== right.size) return false;
	for (const id of left) if (!right.has(id)) return false;
	return true;
}

function FilePaneBody({ tab }: { tab: FileTab | ExternalFileTab }) {
	const mobile = usePhoneViewport();
	const setTabRenderer = useAppStore((state) => state.setTabRenderer);
	const setFileTabSplit = useAppStore((state) => state.setFileTabSplit);
	const setFileTabOutline = useAppStore((state) => state.setFileTabOutline);
	const paneDirection = useAppStore((state) => state.localLayoutPreferences.defaultPaneDirection);
	const review = useFileReview(tab.workspaceId, tab.path, "inline");
	const reviewComments = useAppStore(
		(state) => state.reviewsByWorkspace[tab.workspaceId]?.comments,
	);
	const fileHasDraft = useMemo(
		() => reviewFlagFor(reviewComments, tab.path) === "draft",
		[reviewComments, tab.path],
	);

	const file = tab.kind === "file" ? tab : null;
	const clearFocus = useCallback(() => useAppStore.getState().clearFileFocus(tab.path), [tab.path]);
	const buffer = tab.draft ?? tab.content;

	// Resolved against the text the editor holds, never sent as a line by the host — see panels/SPEC.md.
	const focusRequest = useAppStore((s) =>
		s.fileFocusRequest?.path === tab.path ? s.fileFocusRequest : undefined,
	);
	const focusKeyPath = focusRequest && "keyPath" in focusRequest ? focusRequest.keyPath : undefined;
	const requestedLine = focusRequest && "line" in focusRequest ? focusRequest.line : undefined;
	const focusLine = useMemo(
		() =>
			requestedLine ??
			(focusKeyPath ? (jsonKeyLine(buffer, focusKeyPath) ?? undefined) : undefined),
		[requestedLine, focusKeyPath, buffer],
	);
	const [outlineLine, setOutlineLine] = useState<number | undefined>(undefined);

	useLiveTabContent(tab, {
		read: () =>
			getTransport().request("fs.readFile", { workspaceId: tab.workspaceId, path: tab.path }),
		applyFresh: ({ content, meta }, tick) =>
			useAppStore.getState().updateFileTabContent(tab.workspaceId, tab.id, content, meta, tick),
		keepCurrent: (tick) =>
			useAppStore
				.getState()
				.updateFileTabContent(tab.workspaceId, tab.id, tab.content, tab.meta, tick),
	});

	const dirty = isFileTabDirty(tab);
	const edit = useMemo(
		() => ({
			onChange: (next: string) =>
				useAppStore.getState().setFileTabDraft(tab.workspaceId, tab.id, next),
			onSave: () => void saveFileTab(tab.workspaceId, tab.id),
		}),
		[tab.workspaceId, tab.id],
	);

	const resource = useMemo(
		() => describeResource(tab.workspaceId, tab.path, tab.meta ?? PENDING_TEXT_META),
		[tab.workspaceId, tab.path, tab.meta],
	);
	const candidates = useMemo(
		() => resolveRenderers(resource, "view", { mobile }),
		[resource, mobile],
	);
	const source = candidates.at(-1);
	const preview = file
		? candidates.find((candidate) => candidate.id === MARKDOWN_RENDERER_ID)
		: undefined;
	const splittable = !mobile && preview !== undefined && source !== undefined;
	const split = splittable && (file?.split ?? false);
	// An external tab is the source and nothing else: its path is outside the worktree every richer
	// renderer reads its bytes from.
	const renderer =
		file && !split
			? selectResourceRenderer(candidates, file.rendererId, tab.path)
			: selectResourceRenderer(candidates, source?.id, tab.path);
	const implementationKey = rendererImplementationKey(renderer.id, mobile);
	const [placement, setPlacement] = useState<{
		implementationKey: string;
		ids: ReadonlySet<string>;
	} | null>(null);
	const onPlacedThreadIds = useCallback(
		(ids: ReadonlySet<string>) => {
			setPlacement((current) => {
				if (current?.implementationKey === implementationKey && sameIds(current.ids, ids)) {
					return current;
				}
				return { implementationKey, ids: new Set(ids) };
			});
		},
		[implementationKey],
	);
	const placedThreadIds =
		placement?.implementationKey === implementationKey ? placement.ids : undefined;
	useResetViewStateOnImplementationChange(tab.workspaceId, tab.id, implementationKey);
	const content = contentFor(tab);
	const editable = content.kind === "text";
	const reviews = [review.worktree];
	const toggles = file && candidates.length >= 2 ? candidates : [];
	const showToolbar = toggles.length > 0 || fileHasDraft;
	const saveViewState = (state: unknown) => {
		const current = useAppStore
			.getState()
			.tabsByWorkspace[tab.workspaceId]?.find((candidate) => candidate.id === tab.id);
		if (
			current?.kind === "file" &&
			!current.split === !split &&
			(split || current.rendererId === undefined || current.rendererId === renderer.id) &&
			rendererImplementationKey(renderer.id, isPhoneViewport()) === implementationKey
		) {
			useAppStore.getState().setTabViewState(tab.workspaceId, tab.id, state);
		}
	};

	// The tab strip can only show a basename, which is ambiguous across scopes — three files here are all
	// called settings.json. The full path is the only thing that says which one this is.
	const externalBar = file ? null : (
		<div
			data-testid="external-file-path"
			className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-8"
		>
			<FileSymlink className="size-14 shrink-0 text-agent-claude" />
			<span className="shrink-0 tr-text-label-pill text-text-subtle uppercase">
				outside worktree
			</span>
			<span title={tab.path} className="min-w-0 truncate tr-code-text text-text-muted">
				{abbreviateHomePath(tab.path)}
			</span>
			<span className="ml-auto shrink-0 tr-text-metadata text-text-subtle">
				{dirty ? "unsaved" : ""}
			</span>
		</div>
	);

	const diskBar = tab.external ? (
		<div
			data-testid="file-disk-changed"
			className="flex shrink-0 flex-wrap items-center gap-8 border-feedback-warning border-b bg-container-header-bg px-8 py-4 tr-text-metadata text-text-default"
		>
			<span>This file changed on disk while you were editing it.</span>
			<button
				type="button"
				data-testid="file-disk-merge"
				// Editor chrome never takes the caret: the buffer keeps focus so Ctrl+S still reaches it.
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => mergeDiskIntoDraft(tab.workspaceId, tab.id)}
				className="rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-8 py-2 hover:bg-control-bg-hovered"
			>
				Merge into my edits
			</button>
			<button
				type="button"
				data-testid="file-disk-discard"
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => useAppStore.getState().discardFileTabDraft(tab.workspaceId, tab.id)}
				className="rounded-[var(--radius-sm)] border border-border-default px-8 py-2 text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				Discard mine, take the file
			</button>
		</div>
	) : null;

	const outlineOpen = preview !== undefined && (file?.outlineOpen ?? false);
	// Scanning a large document for headings is not free, and this runs on every render of the pane.
	const headings = useMemo(
		() => (outlineOpen ? sourceHeadings(buffer) : []),
		[outlineOpen, buffer],
	);
	// Overleaf-style: one click lands both sides. The preview scrolls to the heading's rendered element
	// (by slug id, or by line stamp in the review path's segmented render); the editor reveals the line.
	const jumpToHeading = (entry: HeadingEntry) => {
		scrollToHeading(entry);
		setOutlineLine(entry.line);
	};
	const rendersSource = renderer.id === source?.id;
	const landingLine = rendersSource ? (focusLine ?? outlineLine) : focusLine;

	const main = (
		<Suspense fallback={loading}>
			<RendererView
				key={implementationKey}
				renderer={renderer}
				implementationKey={implementationKey}
				resource={resource}
				content={content}
				review={review.worktree}
				onPlacedThreadIds={onPlacedThreadIds}
				viewState={file?.viewState}
				onViewState={saveViewState}
				{...(editable ? { edit } : {})}
				{...(landingLine !== undefined ? { focusLine: landingLine } : {})}
				onFocusHandled={() => {
					clearFocus();
					setOutlineLine(undefined);
				}}
			/>
		</Suspense>
	);
	const companionKey = preview ? rendererImplementationKey(preview.id, mobile) : "";

	return (
		<div className="flex h-full min-h-0 flex-col">
			{externalBar}
			{showToolbar ? (
				<div
					data-testid="resource-view-toggle"
					role="toolbar"
					aria-label="Resource view"
					className="flex h-32 shrink-0 items-center justify-end gap-4 border-border-default border-b bg-container-header-bg px-12"
				>
					{preview ? (
						<OutlineToggle
							active={outlineOpen}
							onClick={() => setFileTabOutline(tab.workspaceId, tab.id, !outlineOpen)}
						/>
					) : null}
					<SendReviewButton workspaceId={tab.workspaceId} path={tab.path} />
					{toggles.map((candidate) => (
						<ToggleSegment
							key={candidate.id}
							testid={rendererTestId(candidate.id)}
							label={candidate.label}
							active={!split && candidate.id === renderer.id}
							onClick={() => setTabRenderer(tab.workspaceId, tab.id, candidate.id)}
						/>
					))}
					{splittable ? (
						<ToggleSegment
							testid="view-toggle-split"
							label="Split"
							active={split}
							onClick={() => setFileTabSplit(tab.workspaceId, tab.id, true)}
						/>
					) : null}
				</div>
			) : null}
			{diskBar}
			<UnplacedReviewStrip
				reviews={reviews}
				renderer={renderer}
				intent="view"
				candidates={candidates}
				{...(placedThreadIds ? { placedThreadIds } : {})}
				onSelectRenderer={(rendererId) => setTabRenderer(tab.workspaceId, tab.id, rendererId)}
			/>
			<div className="flex min-h-0 flex-1">
				{outlineOpen ? <OutlineColumn headings={headings} onSelect={jumpToHeading} /> : null}
				{/* `min-w-0` is load-bearing: a flex item defaults to `min-width:auto` and so refuses to shrink
				    below its content, which makes the scroller grow instead of scrolling a wide table sideways. */}
				<div className="min-h-0 min-w-0 flex-1">
					{splittable ? (
						<EmbeddedSplit
							direction={paneDirection}
							companion={
								split && preview
									? {
											title: "Preview",
											content: (
												<Suspense fallback={loading}>
													<RendererView
														key={companionKey}
														renderer={preview}
														implementationKey={companionKey}
														resource={resource}
														content={content}
														review={review.worktree}
														{...(editable ? { edit } : {})}
													/>
												</Suspense>
											),
											onClose: () => setTabRenderer(tab.workspaceId, tab.id, source.id),
										}
									: null
							}
						>
							{main}
						</EmbeddedSplit>
					) : (
						main
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * Ctrl/Cmd+S belongs to the pane, not the editor alone: the disk-changed bar's buttons take focus, and a
 * save request from there is the same request. Scoped here rather than to the window, where a focused
 * terminal would swallow it. See panels/SPEC.md.
 */
export function FilePane({ tab }: { tab: FileTab | ExternalFileTab }) {
	return (
		<section
			aria-label={tab.name}
			className="contents"
			onKeyDown={(event) => {
				if (event.key !== "s" || !(event.ctrlKey || event.metaKey)) return;
				event.preventDefault();
				void saveFileTab(tab.workspaceId, tab.id);
			}}
		>
			<FilePaneBody tab={tab} />
		</section>
	);
}
