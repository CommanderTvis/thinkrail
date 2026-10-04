import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SurfaceReview } from "@/resources";
import { RegionReviewSurface } from "../RegionReviewSurface";
import type { Size } from "../regionReview";
import type { PdfRenderQueue } from "./pdfLoader";
import { pdfPageContentStamp, pdfRegionDraft, pdfReviewForPage } from "./pdfModel";
import { releasePdfCanvas, renderPdfPageToCanvas, renderPdfTextLayer } from "./pdfRender";
import "./pdfTextLayer.css";

export function PdfPageCanvas({
	document,
	page,
	zoom,
	liveZoom,
	selectable,
	queue,
	review,
	stamp,
	active,
	onVisibility,
	onRendered,
	registerElement,
}: {
	document: PDFDocumentProxy;
	page: number;
	zoom: number;
	liveZoom: number;
	selectable: boolean;
	queue: PdfRenderQueue;
	review?: SurfaceReview | undefined;
	stamp: string;
	active: boolean;
	onVisibility: (page: number, visible: boolean) => void;
	onRendered: (page: number, size: Size | null) => void;
	registerElement: (page: number, element: HTMLElement | null) => void;
}) {
	const rootRef = useRef<HTMLElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const textRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState<Size | null>(null);
	const pageReview = useMemo(() => pdfReviewForPage(review, page), [page, review]);

	useEffect(() => {
		const element = rootRef.current;
		if (!element) return;
		const root = element.closest<HTMLElement>("[data-pdf-scroll]");
		const observer = new IntersectionObserver(
			(entries) =>
				onVisibility(
					page,
					entries.some((entry) => entry.isIntersecting),
				),
			{ root },
		);
		observer.observe(element);
		return () => {
			observer.disconnect();
			onVisibility(page, false);
		};
	}, [onVisibility, page]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!active) {
			if (canvas) releasePdfCanvas(canvas);
			textRef.current?.replaceChildren();
			setSize(null);
			onRendered(page, null);
			return;
		}
		const controller = new AbortController();
		let task: RenderTask | null = null;
		let text: { cancel(): void } | null = null;
		if (canvas) releasePdfCanvas(canvas);
		textRef.current?.replaceChildren();
		setSize(null);
		onRendered(page, null);
		void queue
			.run(async () => {
				const target = canvasRef.current;
				if (controller.signal.aborted || !target) return;
				const rendered = await renderPdfPageToCanvas(document, page, zoom, target);
				task = rendered.task;
				if (controller.signal.aborted) {
					rendered.task.cancel();
					return;
				}
				await rendered.task.promise;
				if (controller.signal.aborted) return;
				setSize(rendered.size);
				onRendered(page, rendered.size);
				const layer = textRef.current;
				if (!layer) return;
				text = await renderPdfTextLayer(document, page, zoom, layer);
				if (controller.signal.aborted) text.cancel();
			}, controller.signal)
			.catch(() => {
				if (!controller.signal.aborted) onRendered(page, null);
			});
		return () => {
			controller.abort();
			task?.cancel();
			text?.cancel();
			const target = canvasRef.current;
			if (target) releasePdfCanvas(target);
			onRendered(page, null);
		};
	}, [active, document, onRendered, page, queue, zoom]);

	// While a pinch is still moving the last raster is stretched to the live zoom; the sharp pixels
	// arrive once the scale settles and the page is drawn again.
	const stretch = liveZoom / zoom;
	const geometry = size
		? { aspectRatio: size.width / size.height, width: size.width * stretch }
		: undefined;
	return (
		<section
			ref={(element) => {
				rootRef.current = element;
				registerElement(page, element);
			}}
			data-testid="pdf-page"
			data-page={page}
			className="flex flex-col gap-4"
		>
			<span className="tr-text-metadata text-text-muted">Page {page}</span>
			<RegionReviewSurface
				review={pageReview}
				intrinsicSize={size}
				contentStamp={pdfPageContentStamp(stamp, page)}
				className={`${size ? "mx-auto max-w-none" : "h-[640px] w-full"} border border-border-muted bg-container-workspace-bg`}
				{...(geometry ? { style: geometry } : {})}
				label={`page ${page} region`}
				draftForRegion={(region) => pdfRegionDraft(region, page)}
				passive={selectable}
			>
				<canvas ref={canvasRef} className="block h-full w-full" aria-label={`PDF page ${page}`} />
				<div
					ref={textRef}
					data-testid="pdf-text-layer"
					className="pdf-text-layer"
					style={
						size
							? { width: size.width, height: size.height, transform: `scale(${stretch})` }
							: undefined
					}
				/>
			</RegionReviewSurface>
		</section>
	);
}
