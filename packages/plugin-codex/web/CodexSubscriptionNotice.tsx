import { RiArrowUpSLine } from "@remixicon/react";
import type { PluginWebContext, TerminalAccessoryApi } from "@thinkrail/plugin-api/web";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@thinkrail/plugin-ui";
import { useState } from "react";
import type { codexContract } from "../contracts";

export function createCodexSubscriptionNotice(ctx: PluginWebContext<typeof codexContract>) {
	const dismissed = new Set<string>();
	return function CodexSubscriptionNotice({ terminal }: { terminal: TerminalAccessoryApi }) {
		const { hideSubscriptionNotice = false } = ctx.useSettings();
		const key = `${terminal.workspaceId}:${terminal.tabKey}`;
		const [open, setOpen] = useState(() => !dismissed.has(key));
		const [saving, setSaving] = useState(false);
		const changeOpen = (next: boolean) => {
			if (!next) dismissed.add(key);
			setOpen(next);
		};
		const neverShowAgain = async () => {
			setSaving(true);
			try {
				await ctx.patchSettings({ hideSubscriptionNotice: true });
				changeOpen(false);
			} catch {
				ctx.notify("error", "Couldn't save your notification preference");
			} finally {
				setSaving(false);
			}
		};
		if (hideSubscriptionNotice) return null;

		return (
			<Popover open={open} onOpenChange={changeOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						data-testid="codex-subscription-notice-trigger"
						className="ml-auto flex items-center gap-4 rounded-[var(--radius-sm)] bg-container-elevated-bg px-4 tr-text-label-pill text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						ChatGPT in Pi <RiArrowUpSLine className="size-12" aria-hidden="true" />
					</button>
				</PopoverTrigger>
				<PopoverContent
					align="end"
					side="top"
					data-testid="codex-subscription-notice"
					aria-label="Use your ChatGPT subscription in Pi"
					onOpenAutoFocus={(event) => event.preventDefault()}
					onCloseAutoFocus={(event) => event.preventDefault()}
					className="flex w-320 max-w-[calc(100vw-24px)] flex-col gap-8 p-12"
				>
					<h3 className="tr-title-compact">Use your ChatGPT subscription in Pi</h3>
					<p className="tr-text-metadata text-text-muted">
						Your ChatGPT subscription also works with ThinkRail's Pi GUI. Connect OpenAI Codex in
						Settings → Providers, then open a Pi chat and choose an OpenAI Codex model.
					</p>
					<div className="flex flex-wrap justify-end gap-8">
						<Button variant="ghost" size="sm" onClick={() => changeOpen(false)}>
							Dismiss
						</Button>
						<Button variant="outline" size="sm" disabled={saving} onClick={neverShowAgain}>
							Never show again
						</Button>
					</div>
				</PopoverContent>
			</Popover>
		);
	};
}
