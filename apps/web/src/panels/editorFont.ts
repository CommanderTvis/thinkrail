export function cssVar(name: string): string | undefined {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

export function editorFontSize(): number {
	return Number.parseFloat(cssVar("--tr-font-size-s11") ?? "") || 11;
}
