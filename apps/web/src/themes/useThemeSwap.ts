/**
 * Subscribes to the host page's root element for a theme change — `data-theme`, `class`, or an inline
 * `style` attribute, the three ways a host might repaint its CSS custom properties — and calls `onSwap`
 * each time. The kit has no direct line to the host's own theme runtime, so it watches the DOM instead.
 * Returns the unsubscribe function. See SPEC.md.
 */
export function useThemeSwap(onSwap: () => void): () => void {
	const observer = new MutationObserver(onSwap);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme", "class", "style"],
	});
	return () => observer.disconnect();
}
