import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { AccountRow, AccountUsageWindow, accountReadingLabel } from "@thinkrail/plugin-ui";
import { useEffect, useState } from "react";
import type { CodexAccount, codexContract } from "../contracts";

function duration(minutes: number): string {
	if (minutes % 1440 === 0) return `${minutes / 1440} day`;
	if (minutes % 60 === 0) return `${minutes / 60} hr`;
	return `${minutes} min`;
}

export function createCodexAccountSurface(ctx: PluginWebContext<typeof codexContract>) {
	return function CodexAccountSurface() {
		const [account, setAccount] = useState<CodexAccount | null>(null);
		const [error, setError] = useState<string | null>(null);
		useEffect(() => {
			let live = true;
			ctx.request("account", {}).then(
				(next) => {
					if (live) setAccount(next);
				},
				(err: unknown) => {
					if (live) setError(err instanceof Error ? err.message : String(err));
				},
			);
			return () => {
				live = false;
			};
		}, []);

		if (error) {
			return (
				<p data-testid="codex-account-error" className="p-8 tr-text-ui text-feedback-error">
					{error}
				</p>
			);
		}
		if (!account) return <p className="p-8 tr-text-ui text-text-muted">Reading account…</p>;
		return (
			<div data-testid="codex-account" className="flex flex-col gap-16 p-8">
				<section className="flex flex-col gap-4">
					<h3 className="tr-text-eyebrow text-text-muted">Account</h3>
					{account.version ? <AccountRow label="Version" value={account.version} /> : null}
					{account.loggedIn ? (
						<>
							{account.email ? <AccountRow label="Email" value={account.email} /> : null}
							<AccountRow
								label={account.plan ? "Plan" : "Authentication"}
								value={account.plan ?? account.authMethod ?? "Unknown"}
							/>
						</>
					) : (
						<p data-testid="codex-account-signed-out" className="tr-text-ui text-text-muted">
							{account.requiresOpenaiAuth
								? "Not signed in. Run codex login in a terminal."
								: "This provider does not require an OpenAI account."}
						</p>
					)}
				</section>
				<section className="flex flex-col gap-8">
					<h3 className="tr-text-eyebrow text-text-muted">Usage</h3>
					{account.usageError ? (
						<p data-testid="codex-usage-error" className="tr-text-ui text-feedback-error">
							{account.usageError}
						</p>
					) : account.usage.length === 0 ? (
						<p data-testid="codex-usage-empty" className="tr-text-ui text-text-muted">
							{account.authMethod === "chatgpt"
								? "No usage limits returned by Codex."
								: "Remaining usage limits are available for ChatGPT accounts."}
						</p>
					) : (
						account.usage.map((window) => (
							<AccountUsageWindow
								key={window.id}
								id={window.id}
								label={
									window.windowDurationMins !== null
										? `${window.label} (${duration(window.windowDurationMins)})`
										: window.label
								}
								percent={window.usedPercent}
								resetsAt={window.resetsAt !== null ? window.resetsAt * 1000 : null}
								testIdPrefix="codex"
							/>
						))
					)}
					{account.usageFetchedAt ? (
						<span className="tr-text-metadata text-text-subtle">
							{accountReadingLabel("Codex", Date.parse(account.usageFetchedAt))}
						</span>
					) : null}
				</section>
			</div>
		);
	};
}
