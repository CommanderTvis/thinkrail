import { FileSymlink } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { abbreviateHomePath, isMarkdownPath, isPdfPath } from "@/lib/utils";
import { LoadingRegion } from "../components/Skeleton";
import type { ExternalFileTab, FileTab } from "../store";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { jsonKeyLine } from "./jsonKeyLine";
import { reviewFlagFor } from "./reviewModel";
import { SendReviewButton } from "./SendReviewButton";
import { ToggleSegment } from "./ToggleSegment";
import { useLiveTabContent } from "./useLiveTabContent";
import { useFileReview } from "./useReviewCommenting";

const MonacoEditor = lazy(() => import("./MonacoEditor"));
const MarkdownPreview = lazy(() => import("./MarkdownPreview"));
const PdfPreview = lazy(() => import("./PdfPreview"));

const loading = <LoadingRegion rows={12} className="h-full p-12" />;

export function FilePane({ tab }: { tab: FileTab | ExternalFileTab }) {
	const setFileTabView = useAppStore((s) => s.setFileTabView);
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
				? Promise.resolve({ content: "" })
				: getTransport().request(external ? "claudeConfig.readFile" : "fs.readFile", {
						workspaceId: tab.workspaceId,
						path: tab.path,
					}),
		applyFresh: ({ content }, tick) =>
			useAppStore.getState().updateFileTabContent(tab.workspaceId, tab.id, content, tick),
		keepCurrent: (tick) =>
			useAppStore.getState().updateFileTabContent(tab.workspaceId, tab.id, tab.content, tick),
	});

	const editor = (
		<Suspense fallback={loading}>
			<MonacoEditor
				path={tab.path}
				content={tab.content}
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
			className="flex h-8 shrink-0 items-center gap-xs border-border-default border-b bg-container-header-bg px-sm"
		>
			<FileSymlink className="size-3.5 shrink-0 text-agent-claude" />
			<span className="shrink-0 tr-text-label-pill text-text-subtle uppercase">
				outside worktree
			</span>
			<span title={tab.path} className="min-w-0 truncate tr-code-text text-text-muted">
				{abbreviateHomePath(tab.path)}
			</span>
			<span className="ml-auto shrink-0 tr-text-metadata text-text-subtle">read-only</span>
		</div>
	) : null;

	if (externalBar) {
		return (
			<div className="flex h-full min-h-0 flex-col">
				{externalBar}
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
		if (!fileHasDraft) return editor;
		return (
			<div className="flex h-full min-h-0 flex-col">
				<div
					data-testid="file-review-toolbar"
					role="toolbar"
					aria-label="Review actions"
					className="flex h-32 shrink-0 items-center justify-end gap-4 border-border-default border-b bg-container-header-bg px-12"
				>
					<SendReviewButton workspaceId={tab.workspaceId} path={tab.path} />
				</div>
				<div className="min-h-0 flex-1">{editor}</div>
			</div>
		);
	}

	const view = tab.view ?? "rendered";
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="markdown-view-toggle"
				role="toolbar"
				aria-label="Markdown view mode"
				className="flex h-32 shrink-0 items-center justify-end gap-4 border-border-default border-b bg-container-header-bg px-12"
			>
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
			</div>
			<div className="min-h-0 flex-1">
				{view === "rendered" ? (
					<Suspense fallback={loading}>
						<div className="h-full motion-safe:animate-reveal">
							<MarkdownPreview
								content={tab.content}
								workspaceId={tab.workspaceId}
								path={tab.path}
								review={review}
							/>
						</div>
					</Suspense>
				) : (
					editor
				)}
			</div>
		</div>
	);
}
