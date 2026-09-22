import { RiFileTransferLine as FileSymlink } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	describeResource,
	PENDING_TEXT_META,
	RendererView,
	rendererImplementationKey,
	rendererTestId,
	resolveRenderers,
	resourceContent,
	selectResourceRenderer,
	UnplacedReviewStrip,
	usePlacedThreadIds,
} from "@thinkrail/resource-renderers";
import { OutlineColumn, OutlineToggle, scrollToHeading } from "@thinkrail/ui/Outline";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { Suspense, useCallback, useMemo, useState } from "react";
import { OutlineColumn, OutlineToggle, scrollToHeading } from "@/panels/Outline";
import { EmbeddedSplit } from "../components/EmbeddedSplit";
import { abbreviateHomePath, isPhoneViewport, usePhoneViewport } from "../lib";
import { type ExternalFileTab, type FileTab, useAppStore } from "../store";
import { getTransport, wsErrorCode } from "../transport";
import { isFileTabDirty, mergeDiskIntoDraft, saveFileTab } from "./fileSave";
import { jsonKeyLine } from "./jsonKeyLine";
import { type HeadingEntry, sourceHeadings } from "./outlineTree";
import { resourceBytesUrl, useResetViewStateOnImplementationChange } from "./resourcePane";
import { reviewFlagFor } from "./reviewModel";
import { SendReviewButton } from "./SendReviewButton";
import { useLiveTabContent } from "./useLiveTabContent";
import { useFileReview } from "./useReviewCommenting";

const MARKDOWN_RENDERER_ID = "thinkrail/markdown";

const loading = <LoadingRegion rows={12} className="h-full p-12" testId="file-pane-loading" />;

function FilePaneBody({ tab }: { tab: FileTab | ExternalFileTab }) {
	const t = useT();
	const mobile = usePhoneViewport();
	const setTabRenderer = useAppStore((state) => state.setTabRenderer);
	const setFileTabSplit = useAppStore((state) => state.setFileTabSplit);
	const setFileTabOutline = useAppStore((state) => state.setFileTabOutline);
	const paneDirection = useAppStore((state) => state.localLayoutPreferences.defaultPaneDirection);
	const setFileTabDeleted = useAppStore((state) => state.setFileTabDeleted);
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

	const deleted = tab.deletedOnDisk === true;
	useLiveTabContent(tab, {
		read: () =>
			getTransport()
				.request("fs.readFile", { workspaceId: tab.workspaceId, path: tab.path })
				.then(
					(fresh) => {
						if (deleted) setFileTabDeleted(tab.workspaceId, tab.id, false);
						return fresh;
					},
					(cause: unknown) => {
						if (wsErrorCode(cause) === "FILE_NOT_FOUND") {
							setFileTabDeleted(tab.workspaceId, tab.id, true);
						}
						throw cause;
					},
				),
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
	const { placedThreadIds, onPlacedThreadIds } = usePlacedThreadIds(implementationKey);
	useResetViewStateOnImplementationChange(tab.workspaceId, tab.id, implementationKey);
	const content = resourceContent(buffer, tab.meta, () =>
		resourceBytesUrl(tab.workspaceId, tab.path),
	);
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
				{t("panels.filePane.outsideWorktree")}
			</span>
			<span title={tab.path} className="min-w-0 truncate tr-code-text text-text-muted">
				{abbreviateHomePath(tab.path)}
			</span>
			<span className="ml-auto shrink-0 tr-text-metadata text-text-subtle">
				{dirty ? t("panels.filePane.unsaved") : ""}
			</span>
		</div>
	);

	const diskBar = deleted ? (
		<div
			data-testid="file-deleted-on-disk"
			className="flex shrink-0 items-center gap-8 border-feedback-error border-b bg-container-header-bg px-8 py-4 tr-text-metadata text-text-default"
		>
			{t("panels.filePane.deletedOnDisk")}
		</div>
	) : tab.external ? (
		<div
			data-testid="file-disk-changed"
			className="flex shrink-0 flex-wrap items-center gap-8 border-feedback-warning border-b bg-container-header-bg px-8 py-4 tr-text-metadata text-text-default"
		>
			<span>{t("panels.filePane.changedOnDisk")}</span>
			<button
				type="button"
				data-testid="file-disk-merge"
				// Editor chrome never takes the caret: the buffer keeps focus so Ctrl+S still reaches it.
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => mergeDiskIntoDraft(tab.workspaceId, tab.id)}
				className="rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-8 py-2 hover:bg-control-bg-hovered"
			>
				{t("panels.filePane.mergeIntoEdits")}
			</button>
			<button
				type="button"
				data-testid="file-disk-discard"
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => useAppStore.getState().discardFileTabDraft(tab.workspaceId, tab.id)}
				className="rounded-[var(--radius-sm)] border border-border-default px-8 py-2 text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				{t("panels.filePane.discardEdits")}
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
				mobile={mobile}
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
					aria-label={t("panels.filePane.resourceView")}
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
							label={t(candidate.labelKey)}
							active={!split && candidate.id === renderer.id}
							onClick={() => setTabRenderer(tab.workspaceId, tab.id, candidate.id)}
						/>
					))}
					{splittable ? (
						<ToggleSegment
							testid="view-toggle-split"
							label={t("panels.filePane.split")}
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
											title: t("panels.filePane.preview"),
											content: (
												<Suspense fallback={loading}>
													<RendererView
														key={companionKey}
														renderer={preview}
														mobile={mobile}
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
