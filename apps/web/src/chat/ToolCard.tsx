import {
	RiCheckLine as Check,
	RiArrowRightSLine as ChevronRight,
	RiLoader4Line as Loader2,
	RiCloseLine as X,
} from "@remixicon/react";
import type { ToolCallBlock } from "@thinkrail/contracts";
import { cn } from "@/lib";
import { useFold } from "./foldState";
import { ToolRendererBody } from "./ToolRendererBody";
import { getToolSummary, resolveProminence } from "./toolRegistry";

export function ToolCard({
	block,
	streaming,
	workspaceRoot,
	onOpenFile,
}: {
	block: ToolCallBlock;
	streaming: boolean;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const { toolCallId, toolName, status } = block;
	const isError = status === "error" || status === "abandoned";
	const renderProps = {
		toolCallId,
		toolName,
		args: block.arguments,
		result: block.result,
		status,
		workspaceRoot,
		onOpenFile,
		streaming,
	};
	const summary = getToolSummary(toolName, renderProps);

	const autoExpand = isError || (resolveProminence(toolName).defaultExpanded && status === "done");
	const [expanded, toggle] = useFold(toolCallId, autoExpand);

	return (
		<div
			data-testid="tool-card"
			data-tool={toolName}
			data-status={status}
			data-expanded={expanded}
			className="rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg"
		>
			<button
				type="button"
				data-testid="tool-card-toggle"
				aria-expanded={expanded}
				onClick={toggle}
				className="flex w-full cursor-pointer select-none items-center gap-4 px-8 py-4 text-left tr-text-metadata outline-none focus-visible:ring-2 focus-visible:ring-primary"
			>
				{status === "running" || status === "pending" ? (
					<Loader2 className="size-12 shrink-0 animate-spin text-text-muted motion-reduce:animate-none" />
				) : isError ? (
					<X className="size-12 shrink-0 text-feedback-error" />
				) : (
					<Check className="size-12 shrink-0 text-feedback-success" />
				)}
				<span className="shrink-0 text-text-default">{toolName}</span>
				{summary ? (
					<span className="min-w-0 flex-1 truncate text-text-muted" title={summary}>
						{summary}
					</span>
				) : (
					<span className="flex-1" />
				)}
				<ChevronRight
					className={`size-16 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
			</button>
			{expanded ? (
				<div className={cn("px-8 pb-4", isError && "text-feedback-error")}>
					<ToolRendererBody {...renderProps} imageLabel={summary} />
				</div>
			) : null}
		</div>
	);
}
