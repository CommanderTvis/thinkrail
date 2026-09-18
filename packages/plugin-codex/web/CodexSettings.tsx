import { RiCheckLine as Check, RiArrowDownSLine as ChevronDown } from "@remixicon/react";
import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/plugin-ui";
import { useEffect, useState } from "react";
import type { codexContract } from "../contracts";
import { CODEX_PERMISSION_MODES } from "../launch";

export function createCodexSettings(ctx: PluginWebContext<typeof codexContract>) {
	return function CodexSettings() {
		const { command = "codex", mcp = true, permissionMode = "default" } = ctx.useSettings();
		const [draft, setDraft] = useState(command);
		useEffect(() => setDraft(command), [command]);

		const update = (patch: Parameters<typeof ctx.patchSettings>[0]) => {
			void ctx
				.patchSettings(patch)
				.catch(() => ctx.notify("error", "Couldn't change the Codex setting"));
		};
		const saveCommand = (next: string) => {
			const normalized = next.trim() || "codex";
			setDraft(normalized);
			if (normalized !== command) update({ command: normalized });
		};

		return (
			<section data-testid="settings-codex" className="flex flex-col gap-16">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Codex</h3>
					<p className="text-text-muted tr-text-metadata">
						The Codex pane, launcher and terminal status — turn the plugin itself on or off from
						Settings › Plugins.
					</p>
				</div>

				<div className="flex flex-col gap-4">
					<span className="tr-title-compact text-text-default">Launch command</span>
					<input
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onBlur={(event) => saveCommand(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
						}}
						spellCheck={false}
						placeholder="codex"
						aria-label="Codex launch command"
						data-testid="codex-command-input"
						className="min-w-0 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-subtle focus:border-primary"
					/>
				</div>

				<div className="flex flex-col gap-4">
					<span className="tr-title-compact text-text-default">Default permissions mode</span>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								aria-label="Codex default permissions mode"
								data-testid="codex-permission-mode"
								className="w-full justify-between"
							>
								<span className="truncate">
									{CODEX_PERMISSION_MODES.find((mode) => mode.id === permissionMode)?.label}
								</span>
								<ChevronDown className="size-16" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							className="w-[var(--radix-dropdown-menu-trigger-width)]"
						>
							<DropdownMenuRadioGroup
								value={permissionMode}
								onValueChange={(value) =>
									update({ permissionMode: value as typeof permissionMode })
								}
							>
								{CODEX_PERMISSION_MODES.map((mode) => (
									<DropdownMenuRadioItem
										key={mode.id}
										value={mode.id}
										data-testid={`codex-permission-mode-${mode.id}`}
									>
										{mode.id === permissionMode ? (
											<Check className="size-14 text-primary" />
										) : (
											<span className="size-14 shrink-0" />
										)}
										<span>{mode.label}</span>
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<p className="text-text-muted tr-text-metadata">
						Applies to new sessions. Right-click the launcher to choose a different mode for one
						launch.
					</p>
				</div>

				<button
					type="button"
					data-testid="codex-mcp-toggle"
					aria-pressed={mcp}
					onClick={() => update({ mcp: !mcp })}
					className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8 text-left"
				>
					<span className="flex flex-col gap-2">
						<span className="tr-title-compact text-text-default">
							Give sessions ThinkRail's tools
						</span>
						<span className="text-text-muted tr-text-metadata">
							Adds ThinkRail's MCP server to every Codex session the launcher starts.
						</span>
					</span>
					{mcp ? <Check className="size-16 shrink-0 text-primary" /> : null}
				</button>
			</section>
		);
	};
}
