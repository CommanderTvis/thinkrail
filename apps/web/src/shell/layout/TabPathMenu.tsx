import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import type { ReactNode } from "react";
import { absoluteWorkspacePath, copyText, isAbsolutePath } from "../../lib";
import type { LayoutTab } from "./types";

function filePath(tab: LayoutTab): string | null {
	switch (tab.kind) {
		case "file":
		case "external-file":
		case "diff":
			return tab.path;
		case "document":
			return tab.docPath;
		default:
			return null;
	}
}

export function TabPathMenuItems({ tab, worktreePath }: { tab: LayoutTab; worktreePath: string }) {
	const path = filePath(tab);
	if (path === null) return null;
	return (
		<>
			<ContextMenuItem data-testid="tab-copy-path" onSelect={() => void copyText(path)}>
				Copy path
			</ContextMenuItem>
			<ContextMenuItem
				data-testid="tab-copy-absolute-path"
				disabled={!worktreePath && !isAbsolutePath(path)}
				onSelect={() => void copyText(absoluteWorkspacePath(worktreePath, path))}
			>
				Copy absolute path
			</ContextMenuItem>
		</>
	);
}

export function TabPathContextMenu({
	tab,
	worktreePath,
	children,
}: {
	tab: LayoutTab;
	worktreePath: string;
	children: ReactNode;
}) {
	if (filePath(tab) === null) return children;
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent data-testid="tab-path-actions">
				<TabPathMenuItems tab={tab} worktreePath={worktreePath} />
			</ContextMenuContent>
		</ContextMenu>
	);
}
