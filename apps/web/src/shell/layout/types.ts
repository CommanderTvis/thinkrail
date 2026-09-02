import type { GitDiffScope, LayoutPreset } from "@thinkrail/contracts";

export type LayoutBottomAlignment = LayoutPreset["bottom"]["alignment"];
export type LayoutToolId = LayoutPreset["left"]["groups"][number]["tools"][number];

export interface LayoutFileTab {
	kind: "file";
	id: string;
	name: string;
	path: string;
}

/** A file outside the worktree (Claude's user/managed-scope configuration), addressed absolutely. */
export interface LayoutExternalFileTab {
	kind: "external-file";
	id: string;
	name: string;
	path: string;
}

export interface LayoutDiffTab {
	kind: "diff";
	id: string;
	name: string;
	path: string;
	scope: GitDiffScope;
}

export interface LayoutChatTab {
	kind: "chat";
	id: string;
	name: string;
	sessionId: string;
}

export interface LayoutDocumentTab {
	kind: "document";
	id: string;
	name: string;
	documentKind: "todo-plan";
	sourceId: string;
	docPath: string;
}

/** One per workspace, so the tab needs no identity beyond its kind. */
export interface LayoutBlueprintTab {
	kind: "blueprint";
	id: string;
	name: string;
}

/** The live view an agent in a terminal draws with the MCP visualize tool — one per terminal. */
export interface LayoutVisualizationTab {
	kind: "visualization";
	id: string;
	name: string;
	terminalTabKey: string;
}

export interface LayoutTerminalTab {
	kind: "terminal";
	id: string;
	name: string;
	tabKey: string;
}

export interface LayoutToolTab {
	kind: "tool";
	id: string;
	name: string;
	tool: LayoutToolId;
}

export type LayoutCenterTab =
	| LayoutFileTab
	| LayoutExternalFileTab
	| LayoutDiffTab
	| LayoutChatTab
	| LayoutDocumentTab
	| LayoutBlueprintTab
	| LayoutVisualizationTab
	| LayoutTerminalTab;
export type LayoutAuxiliaryTab = LayoutToolTab | LayoutTerminalTab;
export type LayoutSideTab = LayoutAuxiliaryTab;
export type LayoutTab = LayoutCenterTab | LayoutAuxiliaryTab;

/**
 * Tabs of one group shown together as resizable panes instead of one at a time.
 *
 * Deliberately metadata on the group rather than a node in the center tree: with vertical tabs off, a
 * grouped entry shows one ordinary tab per member, so the tab list has to stay flat. A `LayoutCenterSplit`
 * means "both at once, always"; this means "these are one entry in the strip".
 */
export interface LayoutTabPane {
	id: string;
	/** At least two tabs of the owning group; a tab belongs to at most one pane. */
	tabIds: string[];
	direction: "horizontal" | "vertical";
	/** One weight per member, in the same order, each in (0, 1). */
	weights: number[];
}

export const LAYOUT_PANE_LIMITS = { minMembers: 2, maxMembers: 4 } as const;

export const VERTICAL_TABS_WIDTH = { min: 120, max: 480, default: 200 } as const;

export interface LayoutCenterGroup {
	kind: "group";
	id: string;
	tabs: LayoutCenterTab[];
	previewTabId?: string;
	panes?: LayoutTabPane[];
}

export interface LayoutCenterSplit {
	kind: "split";
	id: string;
	direction: "horizontal" | "vertical";
	weights: [number, number];
	children: [LayoutCenterNode, LayoutCenterNode];
}

export type LayoutCenterNode = LayoutCenterGroup | LayoutCenterSplit;

export interface LayoutSideGroup {
	id: string;
	weight: number;
	folded: boolean;
	tabs: LayoutAuxiliaryTab[];
}

export interface LayoutSideRegion {
	visible: boolean;
	width: number;
	groups: LayoutSideGroup[];
}

export interface LayoutBottomGroup {
	id: string;
	weight: number;
	folded: boolean;
	tabs: LayoutAuxiliaryTab[];
}

export interface LayoutBottomRegion {
	visible: boolean;
	height: number;
	alignment: LayoutBottomAlignment;
	groups: LayoutBottomGroup[];
}

export type LayoutAuxiliaryRegion = "left" | "right" | "bottom";

export interface LayoutToolRestoreTarget {
	region: LayoutAuxiliaryRegion;
	groupId?: string;
	index: number;
}

export interface WorkspaceLayoutDocument {
	version: 2;
	center: LayoutCenterNode;
	left: LayoutSideRegion;
	right: LayoutSideRegion;
	bottom: LayoutBottomRegion;
	toolRestoreTargets: Partial<Record<LayoutToolId, LayoutToolRestoreTarget>>;
}
