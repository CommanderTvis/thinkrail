export { isDesktopShell } from "../lib/desktopShell";

/**
 * Ask the window to do what macOS does when a title bar is double-clicked. Electrobun's drag region
 * wires window *move* only, so without this the gesture is dead on a title bar we draw ourselves.
 */
export function requestWindowZoomToggle(): void {
	if (typeof window === "undefined") return;
	window.__thinkrailToggleWindowZoom?.();
}
