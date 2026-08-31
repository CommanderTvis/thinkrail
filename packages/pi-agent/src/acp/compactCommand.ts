const COMPACT_PREFIX = "/compact";

export const COMPACT_COMMAND = {
	name: "compact",
	description: "Manually compact context · optional instructions",
} as const;

export function parseCompactCommand(text: string): { instructions?: string } | null {
	const trimmed = text.trim();
	if (trimmed === COMPACT_PREFIX) return {};
	if (!trimmed.startsWith(`${COMPACT_PREFIX} `)) return null;
	const instructions = trimmed.slice(COMPACT_PREFIX.length).trim();
	return instructions ? { instructions } : {};
}
