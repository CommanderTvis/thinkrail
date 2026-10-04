import {
	RiArrowRightSLine as Next,
	RiArrowLeftSLine as Previous,
	RiCursorLine as SelectText,
	RiZoomInLine as ZoomIn,
	RiZoomOutLine as ZoomOut,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";

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
	const t = useT();
	return (
		<div className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-8">
			<IconButton
				icon={Previous}
				label={t("viewer.pdf.previousPage")}
				disabled={page <= 1}
				onClick={() => onPage(page - 1)}
			/>
			<span className="min-w-64 text-center tr-text-metadata text-text-muted">
				{page} / {pageCount}
			</span>
			<IconButton
				icon={Next}
				label={t("viewer.pdf.nextPage")}
				disabled={page >= pageCount}
				onClick={() => onPage(page + 1)}
			/>
			<IconButton
				icon={ZoomOut}
				label={t("viewer.pdf.zoomOut")}
				onClick={() => onZoom(zoom / 1.2)}
			/>
			<Button
				variant="ghost"
				size="s"
				data-testid="pdf-zoom-level"
				aria-label={t("viewer.pdf.resetZoom")}
				onClick={() => onZoom(1)}
			>
				{Math.round(zoom * 100)}%
			</Button>
			<IconButton icon={ZoomIn} label={t("viewer.pdf.zoomIn")} onClick={() => onZoom(zoom * 1.2)} />
			{/* A drag on a page draws a comment region; this hands the drag to the text instead. */}
			{onSelectText ? (
				<IconButton
					icon={SelectText}
					label={selectText ? t("viewer.pdf.commentRegions") : t("viewer.pdf.selectText")}
					data-testid="pdf-select-text"
					aria-pressed={selectText ?? false}
					selected={selectText ?? false}
					className="ml-auto"
					onClick={() => onSelectText(!selectText)}
				/>
			) : null}
		</div>
	);
}
