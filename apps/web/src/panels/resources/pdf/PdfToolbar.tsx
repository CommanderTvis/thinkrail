import {
	RiArrowRightSLine as Next,
	RiArrowLeftSLine as Previous,
	RiCursorLine as SelectText,
	RiZoomInLine as ZoomIn,
	RiZoomOutLine as ZoomOut,
} from "@remixicon/react";
import { Button } from "@thinkrail/ui/button";
import { IconTooltip } from "@thinkrail/ui/tooltip";

export function PdfToolbar({
	page,
	pageCount,
	zoom,
	selectText,
	onPage,
	onZoom,
	onSelectText,
}: {
	page: number;
	pageCount: number;
	zoom: number;
	selectText?: boolean | undefined;
	onPage: (page: number) => void;
	onZoom: (zoom: number) => void;
	onSelectText?: ((selectText: boolean) => void) | undefined;
}) {
	return (
		<div className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-8">
			<Button
				variant="ghost"
				size="icon"
				aria-label="Previous PDF page"
				disabled={page <= 1}
				onClick={() => onPage(page - 1)}
			>
				<Previous className="size-16" />
			</Button>
			<span className="min-w-64 text-center tr-text-metadata text-text-muted">
				{page} / {pageCount}
			</span>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Next PDF page"
				disabled={page >= pageCount}
				onClick={() => onPage(page + 1)}
			>
				<Next className="size-16" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Zoom PDF out"
				onClick={() => onZoom(zoom / 1.2)}
			>
				<ZoomOut className="size-14" />
			</Button>
			<button
				type="button"
				data-testid="pdf-zoom-level"
				aria-label="Reset PDF zoom"
				onClick={() => onZoom(1)}
				className="min-w-40 rounded-[var(--radius-sm)] text-center tr-text-metadata text-text-muted outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
			>
				{Math.round(zoom * 100)}%
			</button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Zoom PDF in"
				onClick={() => onZoom(zoom * 1.2)}
			>
				<ZoomIn className="size-14" />
			</Button>
			{/* A drag on a page draws a comment region; this hands the drag to the text instead. */}
			{onSelectText ? (
				<IconTooltip label={selectText ? "Comment on regions" : "Select text"}>
					<Button
						variant="ghost"
						size="icon"
						data-testid="pdf-select-text"
						aria-label="Select text"
						aria-pressed={selectText}
						className={selectText ? "ml-auto bg-control-bg-selected text-text-default" : "ml-auto"}
						onClick={() => onSelectText(!selectText)}
					>
						<SelectText className="size-14" />
					</Button>
				</IconTooltip>
			) : null}
		</div>
	);
}
