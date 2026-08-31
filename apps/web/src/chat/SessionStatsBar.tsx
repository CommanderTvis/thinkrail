import type { ChatCapabilityFlags, SessionUsage } from "@thinkrail/contracts";

export type UsageCapabilities = Pick<
	ChatCapabilityFlags,
	"cost" | "tokenBreakdown" | "contextWindow"
>;

export function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function formatCost(cost: number): string {
	return `$${cost.toFixed(3)}`;
}

export function formatElapsed(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function usageParts(
	usage: SessionUsage,
	capabilities: Pick<ChatCapabilityFlags, "cost" | "tokenBreakdown">,
): string[] {
	const parts: string[] = [];
	if (capabilities.tokenBreakdown && usage.tokens) {
		const { input, output, cacheRead, cacheWrite } = usage.tokens;
		if (input) parts.push(`↑${formatTokens(input)}`);
		if (output) parts.push(`↓${formatTokens(output)}`);
		if (cacheRead) parts.push(`R${formatTokens(cacheRead)}`);
		if (cacheWrite) parts.push(`W${formatTokens(cacheWrite)}`);
	}
	if (capabilities.cost && usage.cost) parts.push(`$${usage.cost.amount.toFixed(3)}`);
	return parts;
}

export function contextPart(usage: SessionUsage): { bar: string; text: string } | null {
	if (usage.contextWindow === null) return null;
	const percent =
		usage.contextUsed === null
			? null
			: Math.min(100, Math.max(0, (usage.contextUsed / usage.contextWindow) * 100));
	const filled = percent === null ? 0 : Math.round(percent / 20);
	const contextWindow = formatTokens(usage.contextWindow);
	return {
		bar: `${"▰".repeat(filled)}${"▱".repeat(5 - filled)}`,
		text: percent === null ? `?/${contextWindow}` : `${percent.toFixed(1)}%/${contextWindow}`,
	};
}

export function SessionStatsBar({
	usage,
	capabilities,
}: {
	usage: SessionUsage | null;
	capabilities: UsageCapabilities;
}) {
	if (!usage) return null;
	const parts = usageParts(usage, capabilities);
	const context = capabilities.contextWindow ? contextPart(usage) : null;
	if (parts.length === 0 && !context) return null;

	return (
		<div
			data-testid="session-stats"
			className="flex min-w-0 flex-nowrap items-center justify-end gap-x-4 overflow-hidden text-text-muted tr-text-metadata"
			title="Cumulative usage: ↑ input · ↓ output · R cache read · W cache write"
		>
			{parts.map((part, index) => (
				<span key={part} className="flex items-center gap-4 whitespace-nowrap">
					{index > 0 ? <span aria-hidden="true">·</span> : null}
					{part}
				</span>
			))}
			{context ? (
				<span className="flex items-center gap-4 whitespace-nowrap" title="Context window used">
					{parts.length > 0 ? <span aria-hidden="true">·</span> : null}
					<span aria-hidden="true" className="text-primary">
						{context.bar}
					</span>
					{context.text}
				</span>
			) : null}
		</div>
	);
}
