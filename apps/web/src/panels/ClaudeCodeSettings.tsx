import { RiFolderOpenLine as FolderOpen } from "@remixicon/react";
import { useEffect, useState } from "react";
import { cn, shellQuotePath } from "@/lib";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

export function ClaudeCodeSettings() {
	const enabled = useAppStore((s) => s.claudeCodeEnabled);
	const command = useAppStore((s) => s.claudeCommand);
	const [draft, setDraft] = useState(command);

	useEffect(() => setDraft(command), [command]);

	const toggle = () => {
		getTransport()
			.request("settings.update", { config: { claudeCodeEnabled: !enabled } })
			.catch(() => toast.error("Couldn't change the Claude Code setting"));
	};

	const saveCommand = (next: string) => {
		setDraft(next);
		if (next.trim() === command) return;
		getTransport()
			.request("settings.update", { config: { claudeCommand: next } })
			.catch(() => toast.error("Couldn't change the Claude Code launch command"));
	};

	const browse = () => {
		getTransport()
			.request("dialog.selectFile", {})
			.then(({ path }) => {
				if (path) saveCommand(shellQuotePath(path));
			})
			.catch((cause: unknown) =>
				toast.error(errorText(cause), "Couldn't open the file picker on the host"),
			);
	};

	return (
		<section data-testid="settings-claude-code" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Claude Code</h3>
				<p className="text-text-muted tr-text-metadata">
					Turns on the Claude Code pane, terminal status and the plugin offer. It starts off and
					only you change it; the choice is saved on the host and follows you across devices.
				</p>
			</div>

			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<span className="tr-title-compact text-text-default">Claude Code integration</span>
				<button
					type="button"
					role="switch"
					aria-checked={enabled}
					aria-label="Claude Code integration"
					data-testid="claude-code-toggle"
					data-active={enabled}
					onClick={toggle}
					className={cn(
						"relative h-20 w-36 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
						enabled ? "bg-primary" : "bg-border-default",
					)}
				>
					<span
						className={cn(
							"absolute top-2 left-2 size-16 rounded-full bg-container-workspace-bg transition-transform",
							enabled && "translate-x-16",
						)}
					/>
				</button>
			</div>

			<div className="flex flex-col gap-4">
				<span className="tr-title-compact text-text-default">Launch command</span>
				<span className="text-text-muted tr-text-metadata">
					What the launcher types into a new terminal. A command line, so flags are welcome — pick
					an executable if <span className="tr-code-text">claude</span> is not on your PATH.
				</span>
				<div className="flex items-center gap-4">
					<input
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onBlur={(event) => saveCommand(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
						}}
						spellCheck={false}
						placeholder="claude"
						aria-label="Claude Code launch command"
						data-testid="claude-command-input"
						className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-subtle focus:border-primary"
					/>
					<button
						type="button"
						onClick={browse}
						data-testid="claude-command-browse"
						className="flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
					>
						<FolderOpen className="size-16" /> Browse…
					</button>
				</div>
			</div>

			<div className="flex flex-col gap-4 tr-text-metadata">
				<p className="text-text-muted">
					<span className="tr-text-emphasis text-text-default">While on:</span> the Claude Code pane
					resolves the configuration that applies to a workspace, terminals are watched for a
					running agent, and ThinkRail offers to install its Claude Code plugin. Configuration is
					only ever written after you approve the exact change.
				</p>
				<p className="text-text-muted">
					<span className="tr-text-emphasis text-text-default">While off:</span> no file under
					<span className="tr-code-text"> ~/.claude</span> is read, the process table is not polled,
					and the host refuses these requests even if a client asks.
				</p>
			</div>
		</section>
	);
}
