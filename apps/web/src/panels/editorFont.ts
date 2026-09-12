export function cssVar(name: string): string | undefined {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

export function editorFontSize(): number {
	return Number.parseFloat(cssVar("--tr-font-size-s11") ?? "") || 11;
}

/**
 * The code font is one family for every code surface, so the override is written where they all read
 * it: the `--tr-font-family-code` custom property. Empty restores the generated value. See SPEC.md.
 */
export function applyCodeFont(family: string): void {
	const root = document.documentElement;
	if (family.trim() === "") root.style.removeProperty("--tr-font-family-code");
	else root.style.setProperty("--tr-font-family-code", `${family.trim()}, monospace`);
}
