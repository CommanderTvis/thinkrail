import { RiSparkling2Line as Sparkles, RiCloseLine as X } from "@remixicon/react";
import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { useEffect, useState } from "react";
import type { claudeCodeContract, ThinkrailPluginStatus } from "../contracts";
import { errorText } from "./errorText";

// Dismissal is per page lifetime, not persisted: the offer is a nudge, and a host restart is a reasonable moment to surface it again.
let dismissed = false;

export function createClaudeCodeChip(ctx: PluginWebContext<typeof claudeCodeContract>) {
	return function ClaudeCodeChip({ visible }: { visible: boolean }) {
		const [status, setStatus] = useState<ThinkrailPluginStatus | null>(null);
		const [hidden, setHidden] = useState(dismissed);
		const [busy, setBusy] = useState(false);

		useEffect(() => {
			if (!visible || hidden) return;
			let current = true;
			void ctx
				.request("pluginStatus", {})
				.then((result) => {
					if (current) setStatus(result);
				})
				.catch(() => {});
			return () => {
				current = false;
			};
		}, [visible, hidden]);

		if (!visible || hidden || status === null) return null;
		// "unknown" means the config could not be read — offering an install we cannot reason about would be a guess, so the chip stays away.
		if (status.state === "enabled" || status.state === "unknown") return null;

		const updating = status.state === "outdated";

		return (
			<div
				data-testid="claude-plugin-chip"
				data-state={status.state}
				className="flex basis-full min-w-0 max-w-full items-start gap-8 rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg px-8 py-4"
			>
				<Sparkles className="mt-2 size-14 shrink-0 text-primary" />
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<span className="tr-text-ui text-text-default">
						{updating
							? `Update ThinkRail's Claude Code plugin to v${status.availableVersion}?`
							: "Show Claude Code's status in the tab?"}
					</span>
					<span className="tr-text-metadata text-text-muted">
						{updating
							? `Installed v${status.installedVersion}. Updating rewrites one entry in your Claude settings and runs Claude's own plugin update.`
							: "Adds live running / needs-you / done status and desktop notifications. Edits your user-level Claude settings, installs the plugin through Claude's own CLI, and keeps both current from then on."}
					</span>
					{status.pendingChange ? (
						<span title={status.pendingChange} className="truncate tr-code-text text-text-subtle">
							{status.pendingChange}
						</span>
					) : null}
				</div>
				<button
					type="button"
					data-testid="claude-plugin-install"
					disabled={busy}
					onClick={() => {
						setBusy(true);
						void ctx
							.request("installPlugin", {})
							.then((result) => {
								setStatus(result);
								if (result.state === "enabled") {
									dismissed = true;
									setHidden(true);
									ctx.notify(
										"info",
										updating ? "Plugin updated" : "Plugin enabled",
										"Restart Claude Code in this terminal to pick it up.",
									);
								} else {
									ctx.notify(
										"error",
										"Couldn't enable the plugin",
										"Your Claude settings were not changed.",
									);
								}
							})
							.catch((cause: unknown) =>
								ctx.notify("error", "Couldn't enable the plugin", errorText(cause)),
							)
							.finally(() => setBusy(false));
					}}
					className="shrink-0 rounded-[var(--radius-sm)] bg-primary px-8 py-2 tr-text-ui text-text-on-primary hover:opacity-90 disabled:opacity-60"
				>
					{updating ? "Update" : "Enable"}
				</button>
				<button
					type="button"
					data-testid="claude-plugin-dismiss"
					aria-label="Dismiss"
					onClick={() => {
						dismissed = true;
						setHidden(true);
					}}
					className="shrink-0 rounded-[var(--radius-sm)] p-2 text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<X className="size-14" />
				</button>
			</div>
		);
	};
}
