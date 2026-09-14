import { RiLoader4Line as Loader2, RiCloseLine as X } from "@remixicon/react";
import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import {
	Button,
	type HeadingEntry,
	OutlineColumn,
	OutlineToggle,
	scrollToHeading,
} from "@thinkrail/plugin-ui";
import {
	alertComponents,
	FrontmatterProperties,
	Markdown,
	remarkGithubAlerts,
	remarkHeadingIds,
	stampedSelectionLines,
} from "@thinkrail/plugin-ui/markdown";
import { type RefObject, useEffect, useRef, useState } from "react";
import { BLUEPRINT_FILE } from "../blueprintFile";
import type {
	BlueprintBlockLines,
	BlueprintChange,
	BlueprintDoc,
	BlueprintEditTarget,
	BlueprintState,
	blueprintContract,
} from "../contracts";
import { BlueprintControlView } from "./BlueprintControl";
import { EditableText } from "./BlueprintEditable";
import { useBlueprintStore } from "./store";

type Ctx = PluginWebContext<typeof blueprintContract>;

/**
 * The spec is read like a document, not like chat: chat prose leaves `hr` to the browser, whose default
 * rule is a bright inset box with no room around it. Here it is a hairline in the border colour.
 */
const BLUEPRINT_PROSE = [
	"tr-prose-doc max-w-none break-words text-pretty text-text-default",
	"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
	"[&_h1]:mt-16 [&_h1]:mb-8 [&_h2]:mt-16 [&_h2]:mb-8 [&_h3]:mt-12 [&_h3]:mb-4",
	"[&_p]:my-8 [&_strong]:text-text-default",
	"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
	"[&_ul]:my-8 [&_ul]:list-disc [&_ul]:pl-[1.6em] [&_ol]:my-8 [&_ol]:list-decimal [&_ol]:pl-[1.6em]",
	"[&_li]:my-2 [&_li_p]:my-2",
	"[&_hr]:my-16 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-border-muted",
	"[&_blockquote]:my-8 [&_blockquote]:border-primary-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-12 [&_blockquote]:text-text-muted",
].join(" ");

/** Only worth a header line while there is nothing to read; once the spec is there it speaks for itself. */
const AWAITING_NOTE = "Waiting for the agent…";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^(#{1,6})\s+(.*)$/;

function slugify(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-");
}

/** A prose block's headings, level/text/slug/line — no frontmatter title, unlike a whole markdown file. */
function proseHeadings(text: string): HeadingEntry[] {
	const seen = new Map<string, number>();
	const found: HeadingEntry[] = [];
	let fence: string | null = null;
	text.split("\n").forEach((lineText, at) => {
		const fenceMark = FENCE.exec(lineText);
		if (fenceMark) {
			const mark = (fenceMark[1] ?? "").charAt(0);
			if (fence === null) fence = mark;
			else if (fence === mark) fence = null;
			return;
		}
		if (fence !== null) return;
		const match = ATX.exec(lineText);
		if (!match) return;
		const headingText = (match[2] ?? "")
			.replace(/\s+#+\s*$/, "")
			.replaceAll("`", "")
			.trim();
		const base = slugify(headingText);
		if (!base) return;
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		found.push({
			level: (match[1] ?? "").length,
			text: headingText,
			id: n === 0 ? base : `${base}-${n}`,
			line: at + 1,
		});
	});
	return found;
}

function changeText(change: BlueprintChange): string {
	switch (change.kind) {
		case "control-added":
			return `${change.title} · new`;
		case "control-removed":
			return `${change.title} · dropped`;
		case "control-reselected":
			return `${change.title} · ${change.from} → ${change.to}`;
		case "control-options-changed":
			return `${change.title} · new options`;
		case "prose-changed":
			return `${change.count} ${change.count === 1 ? "passage" : "passages"} rewritten`;
	}
}

function Document({
	doc,
	lines,
	disabled,
	changedIds,
	onToggle,
	onEdit,
}: {
	doc: BlueprintDoc;
	lines: Record<string, BlueprintBlockLines>;
	disabled: boolean;
	changedIds: ReadonlySet<string>;
	onToggle: (controlId: string, optionId: string) => void;
	onEdit: (target: BlueprintEditTarget, text: string) => void;
}) {
	return (
		<div data-testid="blueprint-document">
			{doc.frontmatter ? (
				<FrontmatterProperties
					content={doc.frontmatter}
					onEdit={(next) => onEdit({ kind: "frontmatter" }, next)}
				/>
			) : null}
			{doc.blocks.map((block) =>
				block.kind === "prose" ? (
					<EditableProse
						key={block.id}
						blockId={block.id}
						span={lines[block.id]}
						text={block.text}
						disabled={disabled}
						onEdit={onEdit}
					/>
				) : (
					<BlueprintControlView
						key={block.id}
						control={block.control}
						disabled={disabled}
						changed={changedIds.has(block.control.id)}
						onToggle={(optionId) => onToggle(block.control.id, optionId)}
						onEditOption={(optionId, field, text) =>
							onEdit(
								{
									kind: field === "label" ? "option-label" : "option-axis",
									controlId: block.control.id,
									optionId,
								},
								text,
							)
						}
					/>
				),
			)}
		</div>
	);
}

/** Rendered markdown until clicked, its own source while editing — the reader edits what they wrote. */
function EditableProse({
	blockId,
	span,
	text,
	disabled,
	onEdit,
}: {
	blockId: string;
	span: BlueprintBlockLines | undefined;
	text: string;
	disabled: boolean;
	onEdit: (target: BlueprintEditTarget, next: string) => void;
}) {
	return (
		<div data-md-line-start={span?.startLine} data-md-line-end={span?.endLine}>
			<EditableText
				multiline
				value={text}
				disabled={disabled}
				testId="blueprint-prose"
				placeholder="Write a passage…"
				onCommit={(next) => onEdit({ kind: "prose", blockId }, next)}
				render={(value) => (
					<Markdown
						text={value}
						className={BLUEPRINT_PROSE}
						remarkPlugins={[remarkGithubAlerts, remarkHeadingIds]}
						components={alertComponents}
					/>
				)}
			/>
		</div>
	);
}

export function createBlueprintPane(ctx: Ctx) {
	/**
	 * Reports a passage selected here to the editor-events surface, so arguing with the spec reaches the
	 * agent writing it the same way selecting code does — through W12, not a direct Claude Code import.
	 */
	function useReportedBlueprintSelection(
		container: RefObject<HTMLElement | null>,
		workspaceId: string,
	): void {
		useEffect(() => {
			const onSelectionChange = () => {
				const root = container.current;
				const selection = document.getSelection();
				if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
				if (!root.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
				const text = selection.toString();
				if (text.trim() === "") return;
				const stamps = stampedSelectionLines(root);
				if (!stamps) return;
				const lastLine = text.slice(text.lastIndexOf("\n") + 1);
				ctx.editors.reportSelection(
					{
						id: `blueprint:${workspaceId}`,
						workspaceId,
						path: BLUEPRINT_FILE,
						kind: "file",
						dirty: false,
					},
					{
						startLine: stamps.startLine,
						startColumn: 1,
						endLine: stamps.endLine,
						endColumn: lastLine.length + 1,
						text,
					},
				);
			};
			document.addEventListener("selectionchange", onSelectionChange);
			return () => document.removeEventListener("selectionchange", onSelectionChange);
		}, [container, workspaceId]);
	}

	function useBlueprintState(workspaceId: string): BlueprintState | null | undefined {
		useEffect(() => {
			void ctx.watchWorkspace(workspaceId);
			return ctx.subscribe(
				"changed",
				(payload) => useBlueprintStore.getState().setState(workspaceId, payload.state),
				{ workspaceId },
			);
		}, [workspaceId]);
		return useBlueprintStore((s) => s.byWorkspace[workspaceId]);
	}

	function BlueprintDocumentView({ state }: { state: BlueprintState }) {
		const edits = state.pendingEdits.length;
		// Dismissal is per set of changes: the next rewrite reports a different one and shows itself again.
		const signature = JSON.stringify(state.changes);
		const [dismissed, setDismissed] = useState<string | null>(null);
		const changedIds = new Set<string>(
			state.changes.flatMap((change) =>
				change.kind === "prose-changed" ? [] : [change.controlId],
			),
		);

		const confirm = () => {
			void ctx.request("confirmEdits", { workspaceId: state.workspaceId });
		};
		const revert = () => {
			void ctx.request("discardEdits", { workspaceId: state.workspaceId });
		};
		const toggle = (controlId: string, optionId: string) => {
			void ctx.request("select", { workspaceId: state.workspaceId, controlId, optionId });
		};
		const edit = (target: BlueprintEditTarget, text: string) => {
			void ctx.request("edit", { workspaceId: state.workspaceId, target, text });
		};

		const documentRef = useRef<HTMLDivElement | null>(null);
		useReportedBlueprintSelection(documentRef, state.workspaceId);

		// The same outline a markdown file gets, read from the passages: each block's headings, with its
		// line span folded in so a click can land on the block by stamp when an id collides across passages.
		const [outlineOpen, setOutlineOpen] = useState(false);
		const headings: HeadingEntry[] = state.doc.blocks.flatMap((block) => {
			if (block.kind !== "prose") return [];
			const offset = (state.lines[block.id]?.startLine ?? 1) - 1;
			return proseHeadings(block.text).map((entry) => ({ ...entry, line: entry.line + offset }));
		});

		return (
			<div
				data-testid="blueprint"
				data-phase={state.phase}
				className="flex h-full min-h-0 flex-col"
			>
				<header className="flex items-center gap-8 border-b border-border-default px-16 py-8">
					<span className="min-w-0 flex-1 truncate text-text-default">{state.brief}</span>
					{state.phase === "awaiting" ? null : (
						<OutlineToggle
							testid="blueprint-toggle-outline"
							active={outlineOpen}
							onClick={() => setOutlineOpen((current) => !current)}
						/>
					)}
					{state.phase === "awaiting" ? (
						<>
							<Loader2 className="size-16 shrink-0 animate-spin text-text-muted" />
							<span
								data-testid="blueprint-phase"
								className="shrink-0 tr-text-metadata text-text-muted"
							>
								{AWAITING_NOTE}
							</span>
						</>
					) : null}
				</header>

				{edits > 0 ? (
					<div
						data-testid="blueprint-edits"
						className="flex items-center gap-8 border-b border-border-default bg-feedback-info-subtle px-16 py-8"
					>
						<span className="min-w-0 flex-1 text-text-default">
							{edits === 1 ? "1 edit" : `${edits} edits`} not in the file yet.
						</span>
						<Button size="sm" data-testid="blueprint-confirm-edits" onClick={confirm}>
							Confirm edits
						</Button>
						<Button
							size="sm"
							variant="ghost"
							data-testid="blueprint-discard-edits"
							onClick={revert}
						>
							Revert
						</Button>
					</div>
				) : null}

				{state.changes.length > 0 && dismissed !== signature ? (
					<div
						data-testid="blueprint-changes"
						className="border-b border-border-default bg-feedback-warning-subtle px-16 py-8"
					>
						<div className="flex items-start gap-8">
							<span className="min-w-0 flex-1 text-text-default">
								{state.changes.length === 1 ? "1 thing" : `${state.changes.length} things`} moved in
								the agent's last rewrite.
							</span>
							<button
								type="button"
								data-testid="blueprint-changes-dismiss"
								aria-label="Dismiss"
								onClick={() => setDismissed(signature)}
								className="shrink-0 rounded-[var(--radius-sm)] p-2 text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
							>
								<X className="size-14" />
							</button>
						</div>
						<ul className="mt-4 flex flex-wrap gap-x-12 gap-y-4 tr-text-metadata text-text-muted">
							{state.changes.map((change) => {
								const key = `${change.kind}-${change.kind === "prose-changed" ? "" : change.controlId}`;
								// A dropped control has nothing left to scroll to; the rest are one click from their block.
								if (change.kind === "prose-changed" || change.kind === "control-removed") {
									return <li key={key}>{changeText(change)}</li>;
								}
								return (
									<li key={key}>
										<button
											type="button"
											data-testid="blueprint-change"
											data-control={change.controlId}
											onClick={() =>
												document
													.querySelector(
														`[data-testid="blueprint-control"][data-control="${change.controlId}"]`,
													)
													?.scrollIntoView({ behavior: "smooth", block: "center" })
											}
											className="rounded-[var(--radius-sm)] text-left hover:text-text-default hover:underline"
										>
											{changeText(change)}
										</button>
									</li>
								);
							})}
						</ul>
					</div>
				) : null}

				<div className="flex min-h-0 flex-1">
					{outlineOpen ? <OutlineColumn headings={headings} onSelect={scrollToHeading} /> : null}
					<div className="min-h-0 min-w-0 flex-1 overflow-auto px-16 py-12">
						<div ref={documentRef} className="mx-auto max-w-[760px]">
							{state.phase === "awaiting" ? (
								<div
									data-testid="blueprint-awaiting"
									className="flex flex-col gap-8 text-text-muted"
								>
									<p>
										The spec shows up here as soon as the agent writes it. All of it is yours to
										change.
									</p>
									{state.author?.kind === "terminal" ? (
										<p>
											Claude Code asks to trust the folder on first run. It is the new, empty folder
											for this spec — answer{" "}
											<span className="text-text-default">Yes, I trust this folder</span> in the
											terminal.
										</p>
									) : null}
								</div>
							) : (
								<Document
									doc={state.doc}
									lines={state.lines}
									disabled={false}
									changedIds={changedIds}
									onToggle={toggle}
									onEdit={edit}
								/>
							)}
						</div>
					</div>
				</div>
			</div>
		);
	}

	function BlueprintPane({ workspaceId }: { workspaceId: string }) {
		const state = useBlueprintState(workspaceId);

		if (!state) {
			return (
				<div
					data-testid="blueprint-missing"
					className="flex h-full items-center justify-center px-16 text-center text-text-muted"
				>
					This workspace has no specification open. The host keeps one only while it is running.
				</div>
			);
		}
		return <BlueprintDocumentView state={state} />;
	}

	return { BlueprintPane };
}
