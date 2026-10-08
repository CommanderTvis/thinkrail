import { expect, test } from "bun:test";
import {
	clampZoomScale,
	isZoomGesture,
	ZOOM_MAX_SCALE,
	ZOOM_MIN_SCALE,
	zoomScaleForWheel,
} from "./zoomGesture";

test("clamping keeps a scale inside the readable range", () => {
	expect(clampZoomScale(1)).toBe(1);
	expect(clampZoomScale(0.0001)).toBe(ZOOM_MIN_SCALE);
	expect(clampZoomScale(1000)).toBe(ZOOM_MAX_SCALE);
});

test("a pinch-open (negative deltaY) zooms in, a pinch-close zooms out", () => {
	expect(zoomScaleForWheel(1, -1)).toBeGreaterThan(1);
	expect(zoomScaleForWheel(1, 1)).toBeLessThan(1);
});

test("the zoom follows the size of the gesture, so a pinch is not a leap", () => {
	// One tick of a pinch moves the page by a percent or two; ten of them move it as far as one big one.
	expect(zoomScaleForWheel(1, -1)).toBeCloseTo(1.01, 2);
	let stepped = 1;
	for (let i = 0; i < 10; i++) stepped = zoomScaleForWheel(stepped, -1);
	expect(stepped).toBeCloseTo(zoomScaleForWheel(1, -10), 5);
});

test("a mouse notch is one step whatever units it arrives in", () => {
	const notch = zoomScaleForWheel(1, -100);
	expect(notch).toBeCloseTo(1.13, 2);
	// Lines and pages are the same gesture in other units, not a hundred times the zoom.
	expect(zoomScaleForWheel(1, -3, 1)).toBeCloseTo(notch, 5);
	expect(zoomScaleForWheel(1, -1, 2)).toBeCloseTo(notch, 5);
});

test("repeated zooming settles at the bounds rather than running away", () => {
	let out = 1;
	for (let i = 0; i < 100; i++) out = zoomScaleForWheel(out, 100);
	expect(out).toBe(ZOOM_MIN_SCALE);

	let inward = 1;
	for (let i = 0; i < 100; i++) inward = zoomScaleForWheel(inward, -100);
	expect(inward).toBe(ZOOM_MAX_SCALE);
});

test("a zoom step is reversible, so pinching back returns to where it started", () => {
	expect(zoomScaleForWheel(zoomScaleForWheel(2, -1), 1)).toBeCloseTo(2);
});

test("macOS delivers a trackpad pinch as ctrlKey, whatever the platform shortcut modifier is", () => {
	expect(isZoomGesture({ ctrlKey: true, metaKey: false })).toBe(true);
	expect(isZoomGesture({ ctrlKey: false, metaKey: true })).toBe(true);
	expect(isZoomGesture({ ctrlKey: false, metaKey: false })).toBe(false);
});
