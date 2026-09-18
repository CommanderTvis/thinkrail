import { RiOpenaiLine } from "@remixicon/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	IconTooltip,
} from "@thinkrail/plugin-ui";
import { Fragment } from "react";
import { codexEnumValues } from "../configDocs";
import { type CodexLaunchPreset, codexLaunchMenu } from "../launch";

export function CodexGlyph({ className }: { className?: string | undefined }) {
	return <RiOpenaiLine className={className} />;
}

const MENU = codexLaunchMenu(codexEnumValues);

export function createCodexLauncher(
	start: (workspaceId: string, groupId: string, preset?: CodexLaunchPreset) => void,
) {
	return function CodexLauncher({
		workspaceId,
		groupId,
	}: {
		workspaceId: string;
		groupId: string;
	}) {
		return (
			<ContextMenu>
				<IconTooltip label="Start Codex (right-click for options)" wrapTrigger>
					<ContextMenuTrigger asChild>
						<button
							type="button"
							data-testid="new-codex"
							aria-label="Start Codex"
							onClick={() => start(workspaceId, groupId)}
							className="flex w-32 shrink-0 items-center justify-center border-border-default border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							<CodexGlyph className="size-16" />
						</button>
					</ContextMenuTrigger>
				</IconTooltip>
				<ContextMenuContent data-testid="codex-launch-menu">
					{MENU.map((group, index) => (
						<Fragment key={group[0]?.id ?? index}>
							{index > 0 ? <ContextMenuSeparator /> : null}
							{group.map((preset) => (
								<ContextMenuItem
									key={preset.id}
									data-testid={`codex-launch-${preset.id}`}
									onSelect={() => start(workspaceId, groupId, preset)}
								>
									{preset.label}
								</ContextMenuItem>
							))}
						</Fragment>
					))}
				</ContextMenuContent>
			</ContextMenu>
		);
	};
}
