import { useEffect, useMemo, useRef } from "react";
import type { Components } from "react-markdown";
import { stripFrontmatter } from "@/lib/utils";
import { Markdown, type MarkdownRehypePlugins } from "../chat/Markdown";
import { reportIdeSelection } from "../transport";
import { FrontmatterProperties } from "./FrontmatterProperties";
import { alertComponents, remarkGithubAlerts } from "./markdownAlerts";
import { documentComponents, remarkHeadingIds } from "./markdownLinks";
import { type ComposerInsert, PreviewCommenting } from "./PreviewCommenting";
import { ReviewThreadCard } from "./ReviewThreadCard";
import {
	frontmatterOffset,
	indivisibleSpans,
	snapSplitLine,
	sourceLineRehype,
	stampedSelectionLines,
} from "./sourceLines";
import type { EditorReview } from "./useReviewCommenting";

const DOCUMENT_PROSE = [
	"tr-prose-doc max-w-none break-words text-pretty text-text-default",
	"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
	"[&_h1]:mt-0 [&_h1]:mb-12 [&_h1]:border-border-default [&_h1]:border-b [&_h1]:pb-4 [&_h1]:text-balance",
	"[&_h2]:mt-24 [&_h2]:mb-12 [&_h2]:border-border-default [&_h2]:border-b [&_h2]:pb-4 [&_h2]:text-balance",
	"[&_h3]:mt-16 [&_h3]:mb-8 [&_h3]:text-balance",
	"[&_h4]:mt-16 [&_h4]:mb-8 [&_h4]:text-balance",
	"[&_h5]:mt-12 [&_h5]:mb-4",
	"[&_h6]:mt-12 [&_h6]:mb-4 [&_h6]:text-text-muted",
	"[&_p]:my-12 [&_strong]:text-text-default",
	"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary-muted hover:[&_a]:decoration-primary",
	"[&_ul]:my-12 [&_ul]:list-disc [&_ul]:pl-[1.6em] [&_ol]:my-12 [&_ol]:list-decimal [&_ol]:pl-[1.6em] [&_li]:my-4",
	"[&_li>ul]:my-4 [&_li>ol]:my-4 [&_li_p]:my-4",
	"[&_.task-list-item]:list-none [&_input[type=checkbox]]:mr-4 [&_input[type=checkbox]]:accent-primary",
	"[&_blockquote]:my-12 [&_blockquote]:border-primary-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-12 [&_blockquote]:text-text-muted [&_blockquote>:first-child]:mt-0 [&_blockquote>:last-child]:mb-0",
	"[&_hr]:my-24 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-border-default",
	"[&_table]:my-12 [&_table]:block [&_table]:w-max [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse",
	"[&_th]:border [&_th]:border-border-default [&_th]:bg-container-elevated-bg [&_th]:px-8 [&_th]:py-4 [&_th]:text-left",
	"[&_td]:border [&_td]:border-border-default [&_td]:px-8 [&_td]:py-4 [&_td]:align-top",
	"[&_tbody_tr:nth-child(2n)]:bg-sunken",
	"[&_pre]:my-12",
	"[&_img]:my-12 [&_img]:max-w-full [&_img]:rounded-[var(--radius-sm)]",
].join(" ");

export function MarkdownDocument({
	content,
	workspaceId,
	path,
}: {
	content: string;
	workspaceId: string;
	path: string;
}) {
	const components = useMemo(() => documentComponents({ workspaceId, path }), [path, workspaceId]);
	return (
		<Markdown
			text={stripFrontmatter(content)}
			className={DOCUMENT_PROSE}
			remarkPlugins={[remarkGithubAlerts, remarkHeadingIds]}
			components={{ ...alertComponents, ...components }}
		/>
	);
}

interface FlowInsert {
	key: string;
	line: number;
	node: React.ReactNode;
}

function splicedSegments(
	stripped: string,
	rawOffset: number,
	inserts: FlowInsert[],
): { key: string; text: string; stampOffset: number; nodes: React.ReactNode[] }[] {
	const lines = stripped.split("\n");
	const spans = indivisibleSpans(stripped);
	const ordered = [...inserts].sort((a, b) => a.line - b.line);
	const segments: { key: string; text: string; stampOffset: number; nodes: React.ReactNode[] }[] =
		[];
	let cursor = 0;
	const tail: React.ReactNode[] = [];
	for (const insert of ordered) {
		const anchored = insert.line - rawOffset;
		if (anchored < 1 || anchored > lines.length) {
			tail.push(insert.node);
			continue;
		}
		const end = snapSplitLine(spans, anchored);
		if (end <= cursor) {
			const last = segments.at(-1);
			if (last) last.nodes.push(insert.node);
			else tail.push(insert.node);
			continue;
		}
		segments.push({
			key: `seg-${end}`,
			text: lines.slice(cursor, end).join("\n"),
			stampOffset: rawOffset + cursor,
			nodes: [insert.node],
		});
		cursor = end;
	}
	segments.push({
		key: "seg-tail",
		text: lines.slice(cursor).join("\n"),
		stampOffset: rawOffset + cursor,
		nodes: tail,
	});
	return segments;
}

/**
 * Reports a selection made in the *rendered* document to the Claude Code bridge, so selecting a passage
 * here reaches a running agent exactly as selecting code in the editor does. The line span comes from the
 * same `data-md-line-*` stamps the review comments use, which are **block-level**: the reported range is
 * the enclosing block's, while the text is the exact selection. That mismatch is why the transport's
 * de-dupe keys on the text as well as the range. No-ops unless Claude Code is enabled. See panels/SPEC.md.
 */
function useReportedPreviewSelection(
	container: React.RefObject<HTMLElement | null>,
	workspaceId: string,
	path: string,
): void {
	useEffect(() => {
		const onSelectionChange = () => {
			const root = container.current;
			const selection = document.getSelection();
			if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
			if (!root.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
			const text = selection.toString();
			if (text.trim() === "") return;
			const lines = stampedSelectionLines(root);
			if (!lines) return;
			const lastLine = text.slice(text.lastIndexOf("\n") + 1);
			reportIdeSelection({
				workspaceId,
				path,
				text,
				selection: {
					startLine: lines.startLine,
					startColumn: 1,
					endLine: lines.endLine,
					endColumn: lastLine.length + 1,
				},
			});
		};
		document.addEventListener("selectionchange", onSelectionChange);
		return () => document.removeEventListener("selectionchange", onSelectionChange);
	}, [container, workspaceId, path]);
}

export default function MarkdownPreview({
	content,
	workspaceId,
	path,
	review,
	onContentEdit,
}: {
	content: string;
	workspaceId: string;
	path: string;
	review?: EditorReview;
	onContentEdit?: ((next: string) => void) | undefined;
}) {
	const components = useMemo(() => documentComponents({ workspaceId, path }), [path, workspaceId]);
	const documentRef = useRef<HTMLDivElement>(null);
	useReportedPreviewSelection(documentRef, workspaceId, path);

	const properties = onContentEdit ? (
		<FrontmatterProperties content={content} onEdit={onContentEdit} />
	) : null;

	const body = review ? (
		<ReviewedDocument
			content={content}
			review={review}
			components={components}
			documentRef={documentRef}
			properties={properties}
		/>
	) : (
		<div ref={documentRef} className="h-full overflow-auto bg-container-workspace-bg">
			{properties}
			<article className="mx-auto max-w-[78ch] px-24 py-16">
				<MarkdownDocument content={content} workspaceId={workspaceId} path={path} />
			</article>
		</div>
	);

	return (
		<div
			{...(review ? {} : { "data-testid": "markdown-preview" })}
			className="flex h-full min-h-0 flex-col bg-container-workspace-bg"
		>
			<div className="min-h-0 flex-1">{body}</div>
		</div>
	);
}

function ReviewedDocument({
	content,
	review,
	components,
	documentRef,
	properties,
}: {
	content: string;
	review: EditorReview;
	components: Components;
	documentRef: React.RefObject<HTMLDivElement | null>;
	properties: React.ReactNode;
}) {
	const stripped = stripFrontmatter(content);
	const rawOffset = frontmatterOffset(content, stripped);
	const mdProps = (stampOffset: number) => ({
		className: DOCUMENT_PROSE,
		remarkPlugins: [remarkGithubAlerts, remarkHeadingIds],
		rehypePlugins: [[sourceLineRehype, { offset: stampOffset }]] as MarkdownRehypePlugins,
		components: { ...alertComponents, ...components },
	});
	const threadInserts: FlowInsert[] = review.threads.map((thread) => ({
		key: thread.id,
		line: thread.endLine,
		node: <ReviewThreadCard key={thread.id} thread={thread} actions={review.actions} />,
	}));
	return (
		<PreviewCommenting source={content} review={review}>
			{(composer: ComposerInsert | null) => {
				const inserts = composer
					? [...threadInserts, { key: "composer", line: composer.line, node: composer.node }]
					: threadInserts;
				const segments = splicedSegments(stripped, rawOffset, inserts);
				return (
					<>
						{properties}
						<article ref={documentRef} className="mx-auto max-w-[78ch] px-24 py-16">
							{segments.map((segment) => (
								<div key={segment.key}>
									{segment.text && (
										<Markdown text={segment.text} {...mdProps(segment.stampOffset)} />
									)}
									{segment.nodes}
								</div>
							))}
						</article>
					</>
				);
			}}
		</PreviewCommenting>
	);
}
