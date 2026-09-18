import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { AccountRow, AccountUsageWindow, accountReadingLabel } from "@thinkrail/plugin-ui";
import { useEffect, useRef, useState } from "react";
import type { ClaudeAccount, claudeCodeContract } from "../contracts";

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
					{account.version ? <AccountRow label="Version" value={account.version} /> : null}
					{account.loggedIn ? (
						<>
							{account.email ? <AccountRow label="Email" value={account.email} /> : null}
							{account.subscription ? (
								<AccountRow label="Plan" value={account.subscription} />
							) : null}
							{account.organization ? (
								<AccountRow label="Organization" value={account.organization} />
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
						account.usage.map((window) => (
							<AccountUsageWindow
								key={window.id}
								id={window.id}
								label={window.label}
								percent={window.percent}
								resetsAt={window.resetsAt ? Date.parse(window.resetsAt) : null}
								severity={window.severity}
								testIdPrefix="claude"
							/>
						))
					)}
					{account.usageFetchedAt ? (
						<span data-testid="claude-usage-age" className="tr-text-metadata text-text-subtle">
							{busy
								? "Asking Claude Code for the current numbers…"
								: accountReadingLabel("Claude Code", Date.parse(account.usageFetchedAt))}
						</span>
					) : null}
				</section>
			</div>
		);
	};
}
