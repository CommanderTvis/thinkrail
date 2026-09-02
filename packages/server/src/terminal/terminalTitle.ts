export function adoptedTitle(title: string): string {
	const cleaned = title.replaceAll("\u0000", "").trim();
	return cleaned.replace(/^[^\p{L}\p{N}\s]+\s+/u, "");
}
