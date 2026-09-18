export function adoptedTitle(title: string): string {
	const cleaned = title
		.replaceAll("\u0000", "")
		.trim()
		.replace(/^\[[^\p{L}\p{N}[\]\r\n]+\]\s+[^|]+\|\s*/u, "");
	return cleaned.replace(/^[^\p{L}\p{N}\s]+\s+/u, "");
}
