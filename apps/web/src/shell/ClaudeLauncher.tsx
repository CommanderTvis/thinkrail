import { Fragment } from "react";
import { ClaudeMark } from "@/components/ClaudeMark";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { IconTooltip } from "@/components/ui/tooltip";
import { CLAUDE_LAUNCH_MENU, claudeLaunchCommand } from "@/lib";
import { useAppStore } from "@/store";

/**
 * Starts Claude Code in a terminal of this group. Left click runs the configured command; right click
 * offers the flags worth a menu entry rather than a settings field, since they choose what *this* run is
 * (continue, resume, permission mode, model) instead of how the CLI is invoked. See shell/SPEC.md.
 */
export function ClaudeLauncher({ workspaceId, groupId }: { workspaceId: string; groupId: string }) {
	const command = useAppStore((state) => state.claudeCommand);

	const launch = (args?: string) => {
		const line = claudeLaunchCommand(command, args);
		if (!line) return;
		useAppStore.getState().addTerminal(workspaceId, line, groupId);
	};

	return (
		<ContextMenu>
			<IconTooltip label="Start Claude Code (right-click for options)" wrapTrigger>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						data-testid="new-claude"
						aria-label="Start Claude Code"
						onClick={() => launch()}
						className="flex w-32 shrink-0 items-center justify-center border-border-default border-l text-text-muted hover:bg-control-bg-hovered hover:text-agent-claude"
					>
						<ClaudeMark className="size-16" />
					</button>
				</ContextMenuTrigger>
			</IconTooltip>
			<ContextMenuContent data-testid="claude-launch-menu">
				{CLAUDE_LAUNCH_MENU.map((group, index) => (
					<Fragment key={group[0]?.id ?? index}>
						{index > 0 ? <ContextMenuSeparator /> : null}
						{group.map((preset) => (
							<ContextMenuItem
								key={preset.id}
								data-testid={`claude-launch-${preset.id}`}
								onSelect={() => launch(preset.args)}
							>
								{preset.label}
							</ContextMenuItem>
						))}
					</Fragment>
				))}
			</ContextMenuContent>
		</ContextMenu>
	);
}
