import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { ClaudeAccount, ClaudeUsageWindow, claudeCodeContract } from "../contracts";

/** Claude Code has already decided how alarmed to be; the bar wears its answer, not a second opinion. */
const TONES: Record<ClaudeUsageWindow["severity"], string> = {
	critical: "bg-feedback-error",
	warning: "bg-feedback-warning",
	normal: "bg-primary",
};

function ago(ms: number): string {
	const minutes = Math.max(0, Math.round(ms / 60_000));
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** A window whose reset has already passed says so — the reading is old, not the window empty. */
function resetLabel(resetsAt: string): string | null {
	const at = Date.parse(resetsAt);
	if (Number.isNaN(at)) return null;
	const minutes = Math.round((at - Date.now()) / 60_000);
	if (minutes <= 0) return "Reset since this reading";
	if (minutes < 60) return `Resets in ${minutes}m`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `Resets in ${hours}h` : `Resets in ${Math.round(hours / 24)}d`;
}

function UsageBar({ window }: { window: ClaudeUsageWindow }) {
	const reset = window.resetsAt ? resetLabel(window.resetsAt) : null;
	return (
		<div data-testid="claude-usage-window" data-window={window.id} className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between gap-8">
				<span className="truncate tr-text-ui text-text-default">{window.label}</span>
				<span data-testid="claude-usage-percent" className="shrink-0 tr-text-ui text-text-default">
					{window.percent}%
				</span>
			</div>
			<div className="h-4 w-full overflow-hidden rounded-[var(--radius-sm)] bg-control-bg">
				<div
					className={`h-full w-[var(--fill)] ${TONES[window.severity]}`}
					style={{ "--fill": `${window.percent}%` } as React.CSSProperties}
				/>
			</div>
			{reset ? <span className="tr-text-metadata text-text-subtle">{reset}</span> : null}
		</div>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-8">
			<span className="shrink-0 tr-text-ui text-text-muted">{label}</span>
			<span className="min-w-0 truncate tr-text-ui text-text-default">{value}</span>
		</div>
	);
}

export function createClaudeAccountSurface(ctx: PluginWebContext<typeof claudeCodeContract>) {
	return function ClaudeAccountSurface({ reloads }: { reloads: number }) {
		const [account, setAccount] = useState<ClaudeAccount | null>(null);
		const [error, setError] = useState<string | null>(null);
		const [busy, setBusy] = useState(false);
		// The mount-time read has nothing to force; every later run is a manual press.
		const pressed = useRef(reloads);

		useEffect(() => {
			const refresh = pressed.current !== reloads;
			pressed.current = reloads;
			let live = true;
			setError(null);
			if (refresh) setBusy(true);
			ctx
				.request("account", refresh ? { refresh: true } : {})
				.then((next) => {
					if (live) setAccount(next);
				})
				.catch(() => {
					if (live) setError("Could not read the account.");
				})
				.finally(() => {
					if (live) setBusy(false);
				});
			return () => {
				live = false;
			};
		}, [reloads]);

		if (error) {
			return (
				<p data-testid="claude-account-error" className="p-8 tr-text-ui text-feedback-error">
					{error}
				</p>
			);
		}
		if (!account) {
			return <p className="p-8 tr-text-ui text-text-muted">Reading account…</p>;
		}

		return (
			<div data-testid="claude-account" className="flex flex-col gap-16 p-8">
				<section className="flex flex-col gap-4">
					<h3 className="tr-text-eyebrow text-text-muted">Account</h3>
					{account.loggedIn ? (
						<>
							{account.email ? <Row label="Email" value={account.email} /> : null}
							{account.subscription ? <Row label="Plan" value={account.subscription} /> : null}
							{account.organization ? (
								<Row label="Organization" value={account.organization} />
							) : null}
						</>
					) : (
						<p data-testid="claude-account-signed-out" className="tr-text-ui text-text-muted">
							Not signed in. Run <code className="tr-code-text">claude auth login</code> in a
							terminal.
						</p>
					)}
				</section>

				<section className="flex flex-col gap-8">
					<h3 className="tr-text-eyebrow text-text-muted">Usage</h3>
					{account.usage.length === 0 ? (
						<p data-testid="claude-usage-empty" className="tr-text-ui text-text-muted">
							No usage reading yet — Claude Code records one while it works.
						</p>
					) : (
						account.usage.map((window) => <UsageBar key={window.id} window={window} />)
					)}
					{account.usageFetchedAt ? (
						<span data-testid="claude-usage-age" className="tr-text-metadata text-text-subtle">
							{busy ? (
								"Asking Claude Code for the current numbers…"
							) : (
								<>
									Claude Code read this {ago(Date.now() - Date.parse(account.usageFetchedAt))}, on{" "}
									{new Date(account.usageFetchedAt).toLocaleString()}.
								</>
							)}
						</span>
					) : null}
				</section>
			</div>
		);
	};
}
