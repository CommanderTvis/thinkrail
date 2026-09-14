import { RiFolderOpenLine as FolderOpen } from "@remixicon/react";
import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { useEffect, useState } from "react";
import type { claudeCodeContract } from "../contracts";
import { shellQuotePath } from "./claudeLaunch";

type Ctx = PluginWebContext<typeof claudeCodeContract>;

export function createClaudeCodeSettings(ctx: Ctx) {
	return function ClaudeCodeSettings() {
		const { command = "claude", disableAgentView = true } = ctx.useSettings();
		const [draft, setDraft] = useState(command);

		const setDisableAgentView = (on: boolean) => {
			void ctx
				.patchSettings({ disableAgentView: on })
				.catch(() => ctx.notify("error", "Couldn't change the agent-view setting"));
		};

		useEffect(() => setDraft(command), [command]);

		const saveCommand = (next: string) => {
			// Never persists blank: a value nobody can launch is worse than the one this replaces.
			const normalized = next.trim() || "claude";
			setDraft(normalized);
			if (normalized === command) return;
			void ctx
				.patchSettings({ command: normalized })
				.catch(() => ctx.notify("error", "Couldn't change the Claude Code launch command"));
		};

		const browse = () => {
			void ctx
				.pickFile()
				.then((path) => {
					if (path) saveCommand(shellQuotePath(path));
				})
				.catch(() => ctx.notify("error", "Couldn't open the file picker on the host"));
		};

		return (
			<section data-testid="settings-claude-code" className="flex flex-col gap-16">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Claude Code</h3>
					<p className="text-text-muted tr-text-metadata">
						The Claude Code pane, terminal status and the plugin offer — turn the plugin itself on
						or off from Settings › Plugins.
					</p>
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

				<label className="flex w-full items-start gap-8 tr-text-ui text-text-default">
					<input
						type="checkbox"
						data-testid="claude-disable-agent-view"
						checked={disableAgentView}
						onChange={(event) => setDisableAgentView(event.target.checked)}
						className="mt-2 size-16 shrink-0 accent-primary"
					/>
					<span className="min-w-0 flex-1">
						Start Claude Code without its own agent view
						<span className="block tr-text-metadata text-text-muted">
							Parallel sessions are what ThinkRail's workspaces and terminals are for, so a session
							started from here does not also open the CLI's own view of them. Applies to sessions
							ThinkRail starts; one you type yourself is your own.
						</span>
					</span>
				</label>

				<div className="flex flex-col gap-4 tr-text-metadata">
					<p className="text-text-muted">
						<span className="tr-text-emphasis text-text-default">While on:</span> the Claude Code
						pane resolves the configuration that applies to a workspace, terminals are watched for a
						running agent, and ThinkRail offers to install its Claude Code plugin. Configuration is
						only ever written after you approve the exact change.
					</p>
					<p className="text-text-muted">
						<span className="tr-text-emphasis text-text-default">While off:</span> no file under
						<span className="tr-code-text"> ~/.claude</span> is read, the process table is not
						polled, and the host refuses these requests even if a client asks.
					</p>
				</div>
			</section>
		);
	};
}
