import type { ContextUsage, SessionStats } from "@thinkrail/contracts";
import { formatTokens, tokenUsageParts } from "@thinkrail/plugin-ui";

export function formatCost(cost: number): string {
	return `$${cost.toFixed(3)}`;
}

export function formatElapsed(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function usageParts(stats: SessionStats): string[] {
	const parts = tokenUsageParts(stats.tokens);
	if (stats.cost) parts.push(formatCost(stats.cost));
	return parts;
}

export function contextPart(usage: ContextUsage): { bar: string; text: string } {
	const filled =
		usage.percent === null ? 0 : Math.round(Math.min(100, Math.max(0, usage.percent)) / 20);
	const contextWindow = formatTokens(usage.contextWindow);
	return {
		bar: `${"▰".repeat(filled)}${"▱".repeat(5 - filled)}`,
		text:
			usage.percent === null
				? `?/${contextWindow}`
				: `${usage.percent.toFixed(1)}%/${contextWindow}`,
	};
}

export function SessionStatsBar({ stats }: { stats: SessionStats | null }) {
	if (!stats) return null;
	const parts = usageParts(stats);
	const context = stats.contextUsage ? contextPart(stats.contextUsage) : null;
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
