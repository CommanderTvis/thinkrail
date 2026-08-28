/**
 * The desktop shell announces itself with plain globals its preload sets, so `apps/web` keeps depending
 * on nothing but contracts. Both are absent in a browser tab, where every call here is inert.
 */
declare global {
	interface Window {
		__thinkrailDesktop?: boolean;
		__thinkrailToggleWindowZoom?: () => void;
	}
}

export function isDesktopShell(): boolean {
	return typeof window !== "undefined" && window.__thinkrailDesktop === true;
}

/**
 * Ask the window to do what macOS does when a title bar is double-clicked. Electrobun's drag region
 * wires window *move* only, so without this the gesture is dead on a title bar we draw ourselves.
 */
export function requestWindowZoomToggle(): void {
	if (typeof window === "undefined") return;
	window.__thinkrailToggleWindowZoom?.();
}
