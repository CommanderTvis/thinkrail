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
 * Copy for a message that names the host. In a browser the host is a separate computer worth naming; on
 * the desktop it is this one, and "host" reads as a stranger's machine. See panels/SPEC.md.
 */
export function hostWording(remote: string, desktop: string): string {
	return isDesktopShell() ? desktop : remote;
}
