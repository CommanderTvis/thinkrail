import { RiFileTransferLine as FileSymlink, RiLayoutLeftLine as PanelLeft } from "@remixicon/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { IconTooltip } from "@/components/ui/tooltip";
import { abbreviateHomePath, isMarkdownPath, isPdfPath } from "@/lib/utils";
import { EmbeddedSplit } from "../components/EmbeddedSplit";
import { LoadingRegion } from "../components/Skeleton";
import type { ExternalFileTab, FileTab } from "../store";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { isFileTabDirty, mergeDiskIntoDraft, saveFileTab } from "./fileSave";
import { jsonKeyLine } from "./jsonKeyLine";
import { reviewFlagFor } from "./reviewModel";
import { SendReviewButton } from "./SendReviewButton";
import { ToggleSegment } from "./ToggleSegment";
import { useLiveTabContent } from "./useLiveTabContent";
import { useFileReview } from "./useReviewCommenting";

function OutlineToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
	return (
		<IconTooltip label={active ? "Hide outline" : "Show outline"}>
			<button
				type="button"
				data-testid="md-toggle-outline"
				aria-pressed={active}
				aria-label={active ? "Hide outline" : "Show outline"}
				onClick={onClick}
				className={`flex size-24 items-center justify-center rounded-[var(--radius-sm)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
					active
						? "bg-container-elevated-bg text-text-default"
						: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				}`}
			>
				<PanelLeft className="size-14" />
			</button>
		</IconTooltip>
	);
}

const MonacoEditor = lazy(() => import("./MonacoEditor"));
const MarkdownPreview = lazy(() => import("./MarkdownPreview"));
const PdfPreview = lazy(() => import("./PdfPreview"));

const loading = <LoadingRegion rows={12} className="h-full p-12" />;

function FilePaneBody({ tab }: { tab: FileTab | ExternalFileTab }) {
	const setFileTabView = useAppStore((s) => s.setFileTabView);
	const setFileTabOutline = useAppStore((s) => s.setFileTabOutline);
	const review = useFileReview(tab.workspaceId, tab.path, "inline");
	const reviewComments = useAppStore((s) => s.reviewsByWorkspace[tab.workspaceId]?.comments);
	const fileHasDraft = useMemo(
		() => reviewFlagFor(reviewComments, tab.path) === "draft",
		[reviewComments, tab.path],
	);

	const external = tab.kind === "external-file";
	const pdf = !external && isPdfPath(tab.path);
	const clearFocus = useCallback(() => useAppStore.getState().clearFileFocus(tab.path), [tab.path]);

	// Resolved against the text the editor holds, never sent as a line by the host — see panels/SPEC.md.
	const focusKeyPath = useAppStore((s) =>
		s.fileFocusRequest?.path === tab.path ? s.fileFocusRequest.keyPath : undefined,
	);
	const focusLine = useMemo(
		() => (focusKeyPath ? (jsonKeyLine(tab.content, focusKeyPath) ?? undefined) : undefined),
		[focusKeyPath, tab.content],
	);

	// A PDF is re-fetched by this counter, and only a change that names *this file* advances it: the
	// workspace tick moves for every write anywhere, and a compile writes a dozen of them. See SPEC.md.
	const [pdfRevision, setPdfRevision] = useState(0);
	const fsChange = useAppStore((s) => s.fsChangesByWorkspace[tab.workspaceId]);
	useEffect(() => {
		if (!pdf || !fsChange) return;
		if (!fsChange.truncated && !fsChange.paths.includes(tab.path)) return;
		setPdfRevision((current) => current + 1);
	}, [pdf, fsChange, tab.path]);

	useLiveTabContent(tab, {
		// A PDF is rendered from its own bytes over its own route, never from tab.content — see PdfPreview.tsx.
		// An external tab's path is outside the worktree, so the worktree-scoped read cannot refresh it.
		read: () =>
			pdf
				? Promise.resolve({ content: "", hash: "" })
				: getTransport().request(external ? "claudeConfig.readFile" : "fs.readFile", {
						workspaceId: tab.workspaceId,
						path: tab.path,
					}),
		applyFresh: ({ content, hash }, tick) =>
			useAppStore.getState().updateFileTabContent(tab.workspaceId, tab.id, content, hash, tick),
		keepCurrent: (tick) =>
			useAppStore
				.getState()
				.updateFileTabContent(tab.workspaceId, tab.id, tab.content, tab.hash ?? "", tick),
	});

	const buffer = tab.draft ?? tab.content;
	const dirty = isFileTabDirty(tab);
	const save = useCallback(
		() => void saveFileTab(tab.workspaceId, tab.id),
		[tab.workspaceId, tab.id],
	);

	const editor = (
		<Suspense fallback={loading}>
			<MonacoEditor
				path={tab.path}
				content={buffer}
				editable={!pdf}
				onChange={(next) => useAppStore.getState().setFileTabDraft(tab.workspaceId, tab.id, next)}
				onSave={save}
				review={review}
				focusLine={focusLine}
				onFocusHandled={clearFocus}
				workspaceId={tab.workspaceId}
			/>
		</Suspense>
	);

	// The tab strip can only show a basename, which is ambiguous across scopes — three files here are all
	// called settings.json. The full path is the only thing that says which one this is.
	const externalBar = external ? (
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
	) : null;

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

	if (externalBar) {
		return (
			<div className="flex h-full min-h-0 flex-col">
				{externalBar}
				{diskBar}
				<div className="min-h-0 flex-1">{editor}</div>
			</div>
		);
	}

	if (pdf) {
		return (
			<Suspense fallback={loading}>
				<PdfPreview workspaceId={tab.workspaceId} path={tab.path} cacheBust={pdfRevision} />
			</Suspense>
		);
	}

	if (!isMarkdownPath(tab.path)) {
		// Unconditional: a changing tree around Monaco remounts it — see panels/SPEC.md.
		return (
			<div className="flex h-full min-h-0 flex-col">
				{fileHasDraft ? (
					<div
						data-testid="file-review-toolbar"
						role="toolbar"
						aria-label="Review actions"
						className="flex h-32 shrink-0 items-center justify-end gap-4 border-border-default border-b bg-container-header-bg px-8"
					>
						<SendReviewButton workspaceId={tab.workspaceId} path={tab.path} />
					</div>
				) : null}
				{diskBar}
				<div className="min-h-0 flex-1">{editor}</div>
			</div>
		);
	}

	const view = tab.view ?? "rendered";
	const paneDirection = useAppStore((s) => s.localLayoutPreferences.defaultPaneDirection);
	const preview = (
		<Suspense fallback={loading}>
			<div className="h-full motion-safe:animate-reveal">
				<MarkdownPreview
					content={buffer}
					onContentEdit={(next) =>
						useAppStore.getState().setFileTabDraft(tab.workspaceId, tab.id, next)
					}
					workspaceId={tab.workspaceId}
					path={tab.path}
					review={review}
					outlineOpen={tab.outlineOpen ?? false}
				/>
			</div>
		</Suspense>
	);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="markdown-view-toggle"
				role="toolbar"
				aria-label="Markdown view mode"
				className="flex h-32 shrink-0 items-center justify-end gap-4 border-border-default border-b bg-container-header-bg px-12"
			>
				{view !== "source" ? (
					<OutlineToggle
						active={tab.outlineOpen ?? false}
						onClick={() => setFileTabOutline(tab.id, !(tab.outlineOpen ?? false))}
					/>
				) : null}
				<SendReviewButton workspaceId={tab.workspaceId} path={tab.path} />
				<ToggleSegment
					testid="md-toggle-preview"
					label="Preview"
					active={view === "rendered"}
					onClick={() => setFileTabView(tab.id, "rendered")}
				/>
				<ToggleSegment
					testid="md-toggle-source"
					label="Source"
					active={view === "source"}
					onClick={() => setFileTabView(tab.id, "source")}
				/>
				<ToggleSegment
					testid="md-toggle-split"
					label="Split"
					active={view === "split"}
					onClick={() => setFileTabView(tab.id, "split")}
				/>
			</div>
			{diskBar}
			<div className="min-h-0 flex-1">
				{view === "split" ? (
					<EmbeddedSplit
						direction={paneDirection}
						companion={{
							title: "Preview",
							content: preview,
							onClose: () => setFileTabView(tab.id, "source"),
						}}
					>
						{editor}
					</EmbeddedSplit>
				) : view === "rendered" ? (
					preview
				) : (
					editor
				)}
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
