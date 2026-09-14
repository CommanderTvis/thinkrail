import * as pdfjs from "pdfjs-dist";
// Vite emits the worker as its own asset and hands back its final URL. It must be a real emitted file:
// the desktop app serves the built bundle from disk, where a bare specifier would not resolve.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjs.PDFDocumentProxy;

/**
 * Returns the *loading task*, not just the promise: `destroy()` lives there, and it is what aborts an
 * in-flight fetch and tears down the worker when a tab closes mid-load.
 */
export function loadPdf(url: string): pdfjs.PDFDocumentLoadingTask {
	return pdfjs.getDocument({ url });
}

/**
 * The selectable text over a rasterized page. pdf.js positions each span from `--total-scale-factor`,
 * which is CSS the container has to carry — see `pdfTextLayer.css`.
 */
export function renderTextLayer(
	page: pdfjs.PDFPageProxy,
	container: HTMLElement,
	scale: number,
): { cancel(): void } {
	container.replaceChildren();
	container.style.setProperty("--total-scale-factor", String(scale));
	const layer = new pdfjs.TextLayer({
		textContentSource: page.streamTextContent(),
		container,
		viewport: page.getViewport({ scale }),
	});
	layer.render().catch(() => {});
	return layer;
}
