import { expect, test } from "bun:test";
import {
	clampPdfScale,
	isPdfZoomGesture,
	PDF_MAX_SCALE,
	PDF_MIN_SCALE,
	pdfScaleForWheel,
} from "./pdfZoom";

test("clamping keeps a scale inside the readable range", () => {
	expect(clampPdfScale(1)).toBe(1);
	expect(clampPdfScale(0.0001)).toBe(PDF_MIN_SCALE);
	expect(clampPdfScale(1000)).toBe(PDF_MAX_SCALE);
});

test("a pinch-open (negative deltaY) zooms in, a pinch-close zooms out", () => {
	expect(pdfScaleForWheel(1, -1)).toBeGreaterThan(1);
	expect(pdfScaleForWheel(1, 1)).toBeLessThan(1);
});

test("the zoom follows the size of the gesture, so a pinch is not a leap", () => {
	// One tick of a pinch moves the page by a percent or two; ten of them move it as far as one big one.
	expect(pdfScaleForWheel(1, -1)).toBeCloseTo(1.01, 2);
	let stepped = 1;
	for (let i = 0; i < 10; i++) stepped = pdfScaleForWheel(stepped, -1);
	expect(stepped).toBeCloseTo(pdfScaleForWheel(1, -10), 5);
});

test("a mouse notch is one step whatever units it arrives in", () => {
	const notch = pdfScaleForWheel(1, -100);
	expect(notch).toBeCloseTo(1.13, 2);
	// Lines and pages are the same gesture in other units, not a hundred times the zoom.
	expect(pdfScaleForWheel(1, -3, 1)).toBeCloseTo(notch, 5);
	expect(pdfScaleForWheel(1, -1, 2)).toBeCloseTo(notch, 5);
});

test("repeated zooming settles at the bounds rather than running away", () => {
	let out = 1;
	for (let i = 0; i < 100; i++) out = pdfScaleForWheel(out, 100);
	expect(out).toBe(PDF_MIN_SCALE);

	let inward = 1;
	for (let i = 0; i < 100; i++) inward = pdfScaleForWheel(inward, -100);
	expect(inward).toBe(PDF_MAX_SCALE);
});

test("a zoom step is reversible, so pinching back returns to where it started", () => {
	expect(pdfScaleForWheel(pdfScaleForWheel(2, -1), 1)).toBeCloseTo(2);
});

test("macOS delivers a trackpad pinch as ctrlKey, whatever the platform shortcut modifier is", () => {
	expect(isPdfZoomGesture({ ctrlKey: true, metaKey: false })).toBe(true);
	expect(isPdfZoomGesture({ ctrlKey: false, metaKey: true })).toBe(true);
	expect(isPdfZoomGesture({ ctrlKey: false, metaKey: false })).toBe(false);
});
