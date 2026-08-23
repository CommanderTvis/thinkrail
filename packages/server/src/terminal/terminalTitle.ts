import type { TerminalAgentKind } from "@thinkrail/contracts";

export function adoptedTitle(title: string, agent: TerminalAgentKind | undefined): string {
	const cleaned = title.replaceAll("\u0000", "").trim();
	return agent === "claude" ? cleaned.replace(/^[^\p{L}\p{N}\s]\s+/u, "") : cleaned;
}
