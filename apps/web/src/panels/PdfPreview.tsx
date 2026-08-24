import { Minus, Plus, RefreshCw as Refresh, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconTooltip } from "@/components/ui/tooltip";
import { worktreeFileUrl } from "./filesUrl";
import { loadPdf, type PdfDocument, renderTextLayer } from "./pdfEngine";
import "./pdfTextLayer.css";
import { clampPdfScale, isPdfZoomGesture, PDF_SCALE_STEP, pdfScaleForWheel } from "./pdfZoom";

/** How long the scale has to hold still before the pages are drawn again at it. */
const PDF_RASTER_SETTLE_MS = 120;

/**
 * One page, re-rasterized whenever the scale changes so text stays sharp at any zoom — the reason this
 * renders PDF.js itself rather than scaling a finished image. The canvas is an image of the page, so the
 * text a reader wants to select is a second layer over it. See panels/SPEC.md.
 */
function PdfPage({
	doc,
	pageNumber,
	scale,
	rasterScale,
}: {
	doc: PdfDocument;
	pageNumber: number;
	scale: number;
	rasterScale: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const textRef = useRef<HTMLDivElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const innerRef = useRef<HTMLDivElement>(null);
	const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);

	useEffect(() => {
		let cancelled = false;
		// A render in flight must be cancelled, not awaited: pinching emits scales faster than a page
		// rasterizes, and pdf.js rejects a second render onto a canvas still owned by the first.
		let task: { cancel(): void } | null = null;
		let text: { cancel(): void } | null = null;

		void doc.getPage(pageNumber).then((page) => {
			if (cancelled) return;
			const canvas = canvasRef.current;
			if (!canvas) return;

			// Rasterize at device resolution, then present at CSS size — otherwise every page is soft on a
			// retina display, which is the whole reason for rendering rather than scaling an image.
			const ratio = window.devicePixelRatio || 1;
			setPageSize(page.getViewport({ scale: 1 }));
			const viewport = page.getViewport({ scale: rasterScale * ratio });
			canvas.width = viewport.width;
			canvas.height = viewport.height;
			canvas.style.width = `${viewport.width / ratio}px`;
			canvas.style.height = `${viewport.height / ratio}px`;

			const render = page.render({ canvas, viewport });
			task = render;
			render.promise.catch(() => {});

			const layer = textRef.current;
			if (!layer) return;
			text = renderTextLayer(page, layer, rasterScale);
		});

		return () => {
			cancelled = true;
			task?.cancel();
			text?.cancel();
		};
	}, [doc, pageNumber, rasterScale]);

	// Presented at the live scale while the fingers are still moving: the pixels the last rasterization
	// produced are stretched, and the sharp ones arrive when the gesture settles. See panels/SPEC.md.
	useEffect(() => {
		const box = boxRef.current;
		const inner = innerRef.current;
		if (!box || !inner || !pageSize) return;
		box.style.width = `${pageSize.width * scale}px`;
		box.style.height = `${pageSize.height * scale}px`;
		inner.style.transform = `scale(${scale / rasterScale})`;
	}, [scale, rasterScale, pageSize]);

	return (
		<div ref={boxRef} className="relative overflow-hidden shadow-[var(--shadow-sm)]">
			<div ref={innerRef} className="absolute top-0 left-0 origin-top-left">
				<canvas ref={canvasRef} data-testid="pdf-page" data-page={pageNumber} className="block" />
				<div ref={textRef} data-testid="pdf-text-layer" className="textLayer" />
			</div>
		</div>
	);
}

export default function PdfPreview({
	workspaceId,
	path,
	cacheBust,
}: {
	workspaceId: string;
	path: string;
	cacheBust: number;
}) {
	const [doc, setDoc] = useState<PdfDocument | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [scale, setScale] = useState(1);
	const [rasterScale, setRasterScale] = useState(1);
	// A compiler rewriting the file is the reason this pane exists, and the host's watch is not the only
	// way a file changes — a reload asks for the bytes again without closing the tab. See panels/SPEC.md.
	const [reloads, setReloads] = useState(0);
	const scrollRef = useRef<HTMLDivElement>(null);
	// The page *numbers*, not indices: a page's number is its identity, and deriving the list once keeps
	// that identity out of the render loop.
	const pageNumbers = useMemo(
		() => (doc ? Array.from({ length: doc.numPages }, (_, index) => index + 1) : []),
		[doc],
	);

	useEffect(() => {
		let cancelled = false;
		setDoc(null);
		setError(null);

		const task = loadPdf(`${worktreeFileUrl(workspaceId, path)}?t=${cacheBust}.${reloads}`);
		task.promise
			.then((next) => {
				if (!cancelled) setDoc(next);
			})
			.catch((err: unknown) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			});

		return () => {
			cancelled = true;
			void task.destroy();
		};
	}, [workspaceId, path, cacheBust, reloads]);

	// The gesture is continuous; rasterizing is not. Redrawing on every wheel event is what made a pinch
	// stutter, so the pages are re-rendered once the scale stops moving. See panels/SPEC.md.
	useEffect(() => {
		if (scale === rasterScale) return;
		const timer = setTimeout(() => setRasterScale(scale), PDF_RASTER_SETTLE_MS);
		return () => clearTimeout(timer);
	}, [scale, rasterScale]);

	const zoomBy = useCallback((factor: number) => {
		setScale((current) => clampPdfScale(current * factor));
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		// macOS pinch arrives as a wheel event with ctrlKey set; ⌘/Ctrl+wheel is the same gesture by hand.
		// Non-passive so the browser's own page zoom can be suppressed in favour of the document's.
		const onWheel = (event: WheelEvent) => {
			if (!isPdfZoomGesture(event)) return;
			event.preventDefault();
			setScale((current) => pdfScaleForWheel(current, event.deltaY, event.deltaMode));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	if (error) {
		return (
			<div
				data-testid="pdf-preview-error"
				className="flex h-full flex-col items-center justify-center gap-8 p-16 text-center tr-text-ui text-feedback-error"
			>
				<span>This PDF could not be read: {error}</span>
				<button
					type="button"
					data-testid="pdf-reload"
					onClick={() => setReloads((count) => count + 1)}
					className="rounded-[var(--radius-sm)] bg-control-bg px-8 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
				>
					Try again
				</button>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="pdf-toolbar"
				role="toolbar"
				aria-label="PDF view"
				className="flex h-8 shrink-0 items-center justify-end gap-xs border-border-default border-b bg-container-header-bg px-sm"
			>
				<span className="mr-auto tr-text-metadata text-text-subtle tabular-nums">
					{doc ? `${doc.numPages} ${doc.numPages === 1 ? "page" : "pages"}` : ""}
				</span>
				<span
					data-testid="pdf-zoom-level"
					className="tr-text-metadata text-text-muted tabular-nums"
				>
					{Math.round(scale * 100)}%
				</span>
				<IconTooltip label="Reload from disk">
					<button
						type="button"
						data-testid="pdf-reload"
						aria-label="Reload from disk"
						onClick={() => setReloads((count) => count + 1)}
						className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Refresh className="size-14" />
					</button>
				</IconTooltip>
				<IconTooltip label="Zoom out">
					<button
						type="button"
						data-testid="pdf-zoom-out"
						aria-label="Zoom out"
						onClick={() => zoomBy(1 / PDF_SCALE_STEP)}
						className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Minus className="size-3.5" />
					</button>
				</IconTooltip>
				<IconTooltip label="Zoom in">
					<button
						type="button"
						data-testid="pdf-zoom-in"
						aria-label="Zoom in"
						onClick={() => zoomBy(PDF_SCALE_STEP)}
						className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Plus className="size-3.5" />
					</button>
				</IconTooltip>
				<IconTooltip label="Reset zoom">
					<button
						type="button"
						data-testid="pdf-zoom-reset"
						aria-label="Reset zoom"
						onClick={() => setScale(1)}
						className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<RotateCcw className="size-3.5" />
					</button>
				</IconTooltip>
			</div>
			<div
				ref={scrollRef}
				data-testid="pdf-preview"
				className="min-h-0 flex-1 overflow-auto bg-container-workspace-bg p-md"
			>
				{doc ? (
					<div className="flex flex-col items-center gap-md">
						{pageNumbers.map((pageNumber) => (
							<PdfPage
								key={`page-${pageNumber}`}
								doc={doc}
								pageNumber={pageNumber}
								scale={scale}
								rasterScale={rasterScale}
							/>
						))}
					</div>
				) : (
					<div className="flex h-full items-center justify-center text-text-muted">
						Loading PDF…
					</div>
				)}
			</div>
		</div>
	);
}
