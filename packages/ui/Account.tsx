const TONES = {
	critical:
		"[&::-webkit-progress-value]:bg-feedback-error [&::-moz-progress-bar]:bg-feedback-error",
	warning:
		"[&::-webkit-progress-value]:bg-feedback-warning [&::-moz-progress-bar]:bg-feedback-warning",
	normal: "[&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary",
};

export function accountReadingLabel(provider: string, fetchedAt: number): string {
	const minutes = Math.max(0, Math.round((Date.now() - fetchedAt) / 60_000));
	const hours = Math.round(minutes / 60);
	const age =
		minutes < 1
			? "just now"
			: minutes < 60
				? `${minutes}m ago`
				: hours < 48
					? `${hours}h ago`
					: `${Math.round(hours / 24)}d ago`;
	return `${provider} read this ${age}, on ${new Date(fetchedAt).toLocaleString()}.`;
}

function resetLabel(at: number): string | null {
	if (!Number.isFinite(at)) return null;
	const minutes = Math.round((at - Date.now()) / 60_000);
	if (minutes <= 0) return "Reset since this reading";
	if (minutes < 60) return `Resets in ${minutes}m`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `Resets in ${hours}h` : `Resets in ${Math.round(hours / 24)}d`;
}

export function AccountRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-8">
			<span className="shrink-0 tr-text-ui text-text-muted">{label}</span>
			<span title={value} className="min-w-0 truncate tr-text-ui text-text-default">
				{value}
			</span>
		</div>
	);
}

export function AccountUsageWindow({
	id,
	label,
	percent,
	resetsAt,
	severity = "normal",
	testIdPrefix,
}: {
	id: string;
	label: string;
	percent: number;
	resetsAt: number | null;
	severity?: keyof typeof TONES;
	testIdPrefix: string;
}) {
	const used = Math.max(0, Math.min(100, percent));
	const reset = resetsAt === null ? null : resetLabel(resetsAt);
	return (
		<div
			data-testid={`${testIdPrefix}-usage-window`}
			data-window={id}
			className="flex flex-col gap-2"
		>
			<div className="flex items-baseline justify-between gap-8">
				<span className="truncate tr-text-ui text-text-default">{label}</span>
				<span
					data-testid={`${testIdPrefix}-usage-percent`}
					className="shrink-0 tr-text-ui text-text-default"
				>
					{used}% used
				</span>
			</div>
			<progress
				aria-label={`${label} usage`}
				value={used}
				max={100}
				className={`h-4 w-full overflow-hidden rounded-[var(--radius-sm)] border-0 bg-control-bg appearance-none [&::-webkit-progress-bar]:bg-control-bg ${TONES[severity]}`}
			/>
			{reset ? <span className="tr-text-metadata text-text-subtle">{reset}</span> : null}
		</div>
	);
}
