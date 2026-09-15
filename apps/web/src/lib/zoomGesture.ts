export const ZOOM_MIN_SCALE = 0.25;
export const ZOOM_MAX_SCALE = 6;
export const ZOOM_SCALE_STEP = 1.15;

export function clampZoomScale(scale: number): number {
	return Math.min(ZOOM_MAX_SCALE, Math.max(ZOOM_MIN_SCALE, scale));
}

/** A wheel notch in lines or pages, in the pixels the rest of this file counts in. */
const DELTA_MODE_PIXELS = [1, 16, 100];

/**
 * How much of the gesture makes one doubling: bigger is slower. A trackpad pinch arrives as a stream of
 * small deltas, so the zoom has to follow their *size* — a fixed step per event is what made it leap.
 */
const ZOOM_SENSITIVITY = 100;

/** A mouse notch is one gesture, not a hundred pixels of pinch: past this, more delta is the same step. */
const ZOOM_MAX_DELTA = 12;

/**
 * Where a wheel gesture leaves the zoom. A negative `deltaY` is a pinch-open / scroll-up, which zooms in.
 * Proportional to the delta, so a pinch is as fine-grained as the fingers moving it. See panels/SPEC.md.
 */
export function zoomScaleForWheel(scale: number, deltaY: number, deltaMode = 0): number {
	const pixels = deltaY * (DELTA_MODE_PIXELS[deltaMode] ?? 1);
	const bounded = Math.max(-ZOOM_MAX_DELTA, Math.min(ZOOM_MAX_DELTA, pixels));
	return clampZoomScale(scale * Math.exp(-bounded / ZOOM_SENSITIVITY));
}

/**
 * Whether a wheel event is a zoom gesture rather than a scroll: macOS delivers a trackpad pinch as a wheel
 * event with `ctrlKey` set, whatever the platform's own shortcut modifier happens to be.
 */
export function isZoomGesture(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
	return event.ctrlKey || event.metaKey;
}
