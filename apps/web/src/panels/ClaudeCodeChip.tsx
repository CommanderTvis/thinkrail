import { RiSparkling2Line as Sparkles, RiCloseLine as X } from "@remixicon/react";
import type { ThinkrailPluginStatus } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { toast } from "../store";
import { errorText, getTransport } from "../transport";

// Dismissal is per page lifetime, not persisted: the offer is a nudge, and a host restart is a reasonable moment to surface it again.
let dismissed = false;

export function ClaudeCodeChip({ visible }: { visible: boolean }) {
	const [status, setStatus] = useState<ThinkrailPluginStatus | null>(null);
	const [hidden, setHidden] = useState(dismissed);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!visible || hidden) return;
		let current = true;
		void getTransport()
			.request("claudeConfig.pluginStatus", {})
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
			className="absolute inset-x-2 bottom-2 z-20 flex items-start gap-sm rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg px-sm py-xs shadow-lg"
		>
			<Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="tr-text-ui text-text-default">
					{updating
						? `Update ThinkRail's Claude Code plugin to v${status.availableVersion}?`
						: "Show Claude Code's status in the tab?"}
				</span>
				<span className="tr-text-metadata text-text-muted">
					{updating
						? `Installed v${status.installedVersion}. Updating rewrites one entry in your Claude settings.`
						: "Adds live running / needs-you / done status and desktop notifications. Edits your user-level Claude settings, and keeps that one entry current from then on."}
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
					void getTransport()
						.request("claudeConfig.installPlugin", {})
						.then((result) => {
							setStatus(result);
							if (result.state === "enabled") {
								dismissed = true;
								setHidden(true);
								toast.success(
									"Restart Claude Code in this terminal to pick it up.",
									updating ? "Plugin updated" : "Plugin enabled",
								);
							} else {
								toast.error("Your Claude settings were not changed.", "Couldn't enable the plugin");
							}
						})
						.catch((cause: unknown) => toast.error(errorText(cause), "Couldn't enable the plugin"))
						.finally(() => setBusy(false));
				}}
				className="shrink-0 rounded-[var(--radius-sm)] bg-primary px-sm py-0.5 tr-text-ui text-text-on-primary hover:opacity-90 disabled:opacity-60"
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
				className="shrink-0 rounded-[var(--radius-sm)] p-0.5 text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				<X className="size-3.5" />
			</button>
		</div>
	);
}
