import { useDraggable, useDroppable } from "@dnd-kit/core";
import { RiSearchLine as Search, RiCloseLine as X } from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@thinkrail/ui/command";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { Fragment, memo, type ReactNode, useEffect, useRef, useState } from "react";
import {
	abbreviateHomePath,
	chatLabel,
	DOUBLE_CLICK_SETTLE_MS,
	type LayoutAttention,
	tupleKey,
} from "../../lib";
import {
	type AuxiliaryRailControlProps,
	RAIL_ENTRY_BUTTON_CLASS,
	RAIL_ICON,
	railEntryButtonProps,
	railEntryFrameClass,
	railTooltipSide,
} from "./AuxiliaryRail";
import {
	BUILTIN_LAYOUT_TOOL_CATALOG,
	type CenterSplitDirection,
	canCreateAuxiliaryGroup,
	canJoinAuxiliaryGroup,
	collectAllGroups,
	collectCenterGroups,
	createAuxiliaryGroup,
	describeLayoutGroup,
	findCenterGroup,
	groupTabs,
	isLayoutUnavailable,
	LAYOUT_LIMITS,
	type LayoutGroupLocation,
	type LayoutMutationResult,
	type LayoutOperationResult,
	type LayoutToolCatalog,
	layoutTabName,
	moveTabToGroup,
	paneForTab,
	removeLayoutGroup,
	reorderPaneMember,
	separatePanesReason,
	setPaneDirection,
	splitCenterGroup,
	toolTab,
	ungroupTab,
	unplacedTools,
} from "./model";
import { TabPathContextMenu, TabPathMenuItems } from "./TabPathMenu";
import { tabIcon } from "./tabIcon";
import type {
	LayoutAuxiliaryRegion,
	LayoutTab,
	LayoutTabPane,
	LayoutToolId,
	WorkspaceLayoutDocument,
} from "./types";
import type { DragData, DropTarget, WorkbenchProps } from "./workbenchShared";
import {
	canInsertDraggedTab,
	DropZone,
	findLayoutGroupTabs,
	groupPanelId,
	navigationClockSnapshot,
	tabDomId,
	tabSearchKeywords,
	useHorizontalOverflow,
} from "./workbenchShared";

export interface TabStripProps {
	document: WorkspaceLayoutDocument;
	readAttention: () => LayoutAttention;
	selectionEpochRef: React.MutableRefObject<number>;
	location: LayoutGroupLocation;
	tabs: LayoutTab[];
	selectedId?: string | undefined;
	previewId?: string | undefined;
	maxSideGroups: number;
	maxBottomGroups: number;
	draggingTab: LayoutTab | null;
	onSelect: (tabId: string, keep?: boolean) => void;
	onClose: (tab: LayoutTab) => void;
	onApply: (result: LayoutMutationResult) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (region: LayoutAuxiliaryRegion) => void;
	onRevealTool: (tool: LayoutToolId) => void;
	catalog?: LayoutToolCatalog;
	worktreePath?: string;
	onRenameChat: WorkbenchProps["onRenameChat"];
	chatFirstPrompts?: WorkbenchProps["chatFirstPrompts"];
	canFocusAdjacentGroup: boolean;
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	renderTabIcon: WorkbenchProps["renderTabIcon"];
	splitGeometry?: { horizontal: boolean; vertical: boolean };
	trailing?: ReactNode;
	orientation?: "horizontal" | "vertical";
	/** A vertical strip sized by its rows, hung under a workspace in Projects. */
	nested?: boolean | undefined;
	defaultPaneDirection?: "horizontal" | "vertical";
}

const GROUP_TABS_LABELS = {
	center: "workbench.tabs.centerGroupTabs",
	left: "workbench.tabs.leftGroupTabs",
	right: "workbench.tabs.rightGroupTabs",
	bottom: "workbench.tabs.bottomGroupTabs",
} as const satisfies Record<LayoutGroupLocation["area"], MessageKey>;

const MOVE_TO_PANE_LABELS = {
	center: "workbench.tab.moveToCenterPane",
	left: "workbench.tab.moveToLeftPane",
	right: "workbench.tab.moveToRightPane",
	bottom: "workbench.tab.moveToBottomPane",
} as const satisfies Record<LayoutGroupLocation["area"], MessageKey>;

const NEW_REGION_GROUP_LABELS = {
	left: { start: "workbench.tab.newLeftGroupTop", end: "workbench.tab.newLeftGroupBottom" },
	right: { start: "workbench.tab.newRightGroupTop", end: "workbench.tab.newRightGroupBottom" },
	bottom: { start: "workbench.tab.newBottomGroupLeft", end: "workbench.tab.newBottomGroupRight" },
} as const satisfies Record<LayoutAuxiliaryRegion, Record<"start" | "end", MessageKey>>;

const SPLIT_LABELS = {
	left: "workbench.center.splitLeft",
	right: "workbench.center.splitRight",
	up: "workbench.center.splitUp",
	down: "workbench.center.splitDown",
} as const satisfies Record<CenterSplitDirection, MessageKey>;

/**
 * Vertical rows have room for a folder, but showing one on every row is noise. A basename shared by two
 * open tabs is exactly when the name alone stops identifying the file, so that is when the folder appears.
 */
function ambiguousTabSubtitles(tabs: readonly LayoutTab[]): Map<string, string> {
	const byName = new Map<string, LayoutTab[]>();
	for (const tab of tabs) {
		const sharing = byName.get(tab.name);
		if (sharing) sharing.push(tab);
		else byName.set(tab.name, [tab]);
	}
	const subtitles = new Map<string, string>();
	for (const sharing of byName.values()) {
		if (sharing.length < 2) continue;
		for (const tab of sharing) {
			const path = "path" in tab ? tab.path : undefined;
			if (!path) continue;
			const folder = path.slice(0, path.lastIndexOf("/"));
			if (folder) subtitles.set(tab.id, abbreviateHomePath(folder));
		}
	}
	return subtitles;
}

export const TabStrip = memo(function TabStrip({
	document,
	readAttention,
	selectionEpochRef,
	location,
	tabs,
	selectedId,
	previewId,
	maxSideGroups,
	maxBottomGroups,
	draggingTab,
	onSelect,
	onClose,
	onApply,
	onFocusAdjacentGroup,
	onHideSide,
	onRevealTool,
	catalog = BUILTIN_LAYOUT_TOOL_CATALOG,
	worktreePath = "",
	onRenameChat,
	chatFirstPrompts,
	canFocusAdjacentGroup,
	renderTabAdornment,
	renderTabIcon,
	splitGeometry,
	trailing,
	orientation = "horizontal",
	nested = false,
	defaultPaneDirection = "horizontal",
}: TabStripProps) {
	const t = useT();
	const vertical = orientation === "vertical";
	const scroller = useRef<HTMLDivElement>(null);
	const scrollOverflow = useHorizontalOverflow(scroller);
	const tabRefs = useRef(new Map<string, HTMLElement>());
	const overflowFocusTarget = useRef<string | null>(null);
	const [overflowOpen, setOverflowOpen] = useState(false);
	const overflowing = scrollOverflow.before || scrollOverflow.after;
	const selectTab = (tabId: string, keep?: boolean) => {
		selectionEpochRef.current += 1;
		onSelect(tabId, keep);
	};
	const applyResult = (result: LayoutMutationResult) => {
		selectionEpochRef.current += 1;
		onApply(result);
	};
	const closeTab = (tab: LayoutTab) => {
		selectionEpochRef.current += 1;
		onClose(tab);
	};
	const acceptsAppend =
		draggingTab !== null && canInsertDraggedTab(document, draggingTab, location, tabs.length);
	const panelId = groupPanelId(location);
	const { setNodeRef: setGroupDropRef, isOver: groupDropOver } = useDroppable({
		id: tupleKey("dnd-group", location.area, location.groupId),
		data: { target: { kind: "group", location } satisfies DropTarget },
		disabled: !acceptsAppend,
	});

	useEffect(() => {
		if (selectedId)
			tabRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [selectedId]);

	useEffect(() => {
		if (!overflowing) setOverflowOpen(false);
	}, [overflowing]);

	const selectAt = (index: number) => {
		const tab = tabs[index];
		if (!tab) return;
		selectTab(tab.id);
		const epoch = selectionEpochRef.current;
		requestAnimationFrame(() => {
			if (selectionEpochRef.current === epoch) tabRefs.current.get(tab.id)?.focus();
		});
	};

	const ownGroup =
		location.area === "center" ? findCenterGroup(document.center, location.groupId) : undefined;
	const subtitles = vertical ? ambiguousTabSubtitles(tabs) : null;
	const entries: (
		| { pane: undefined; tab: LayoutTab; index: number }
		| { pane: LayoutTabPane; members: { tab: LayoutTab; index: number }[] }
	)[] = [];
	tabs.forEach((tab, index) => {
		const pane = vertical && ownGroup ? paneForTab(ownGroup, tab.id) : undefined;
		const last = entries.at(-1);
		if (pane && last && "members" in last && last.pane.id === pane.id)
			last.members.push({ tab, index });
		else if (pane) entries.push({ pane, members: [{ tab, index }] });
		else entries.push({ pane: undefined, tab, index });
	});
	const renderTab = (tab: LayoutTab, index: number) => (
		<WorkbenchTab
			key={tab.id}
			tab={tab}
			index={index}
			reorderIndexes={{
				previous: index > 0 ? index - 1 : undefined,
				next: index < tabs.length - 1 ? index + 1 : undefined,
			}}
			location={location}
			readAttention={readAttention}
			selectionEpochRef={selectionEpochRef}
			active={tab.id === selectedId}
			preview={tab.id === previewId}
			document={document}
			maxSideGroups={maxSideGroups}
			maxBottomGroups={maxBottomGroups}
			register={(node) => {
				if (node) tabRefs.current.set(tab.id, node);
				else tabRefs.current.delete(tab.id);
			}}
			onSelect={selectTab}
			onClose={() => closeTab(tab)}
			onApply={applyResult}
			onFocusAdjacentGroup={onFocusAdjacentGroup}
			onHideSide={onHideSide}
			onRevealTool={onRevealTool}
			catalog={catalog}
			worktreePath={worktreePath}
			onRenameChat={onRenameChat}
			{...(chatFirstPrompts ? { chatFirstPrompts } : {})}
			canFocusAdjacentGroup={canFocusAdjacentGroup}
			renderTabAdornment={renderTabAdornment}
			renderTabIcon={renderTabIcon}
			draggingTab={draggingTab}
			panelId={panelId}
			vertical={vertical}
			defaultPaneDirection={defaultPaneDirection}
			subtitle={subtitles?.get(tab.id)}
			{...(splitGeometry ? { splitGeometry } : {})}
			onKeyDown={(event) => {
				if (event.altKey && event.shiftKey && event.key === "ArrowLeft") {
					event.preventDefault();
					if (index > 0) {
						const moved = moveTabToGroup(document, tab, location, index - 1);
						if (!isLayoutUnavailable(moved)) applyResult(moved);
					}
				} else if (event.altKey && event.shiftKey && event.key === "ArrowRight") {
					event.preventDefault();
					if (index < tabs.length - 1) {
						const moved = moveTabToGroup(document, tab, location, index + 1);
						if (!isLayoutUnavailable(moved)) applyResult(moved);
					}
				} else if (event.key === (vertical ? "ArrowUp" : "ArrowLeft")) {
					event.preventDefault();
					selectAt(index === 0 ? tabs.length - 1 : index - 1);
				} else if (event.key === (vertical ? "ArrowDown" : "ArrowRight")) {
					event.preventDefault();
					selectAt(index === tabs.length - 1 ? 0 : index + 1);
				} else if (event.key === "Home") {
					event.preventDefault();
					selectAt(0);
				} else if (event.key === "End") {
					event.preventDefault();
					selectAt(tabs.length - 1);
				} else if (event.key === "Delete") {
					event.preventDefault();
					closeTab(tab);
				}
			}}
		/>
	);
	const testId =
		location.area === "center"
			? "center-tab-strip"
			: location.area === "bottom"
				? "bottom-tab-strip"
				: "workbench-tab-strip";
	return (
		<div
			ref={setGroupDropRef}
			data-testid={testId}
			data-area={location.area}
			data-group-id={location.groupId}
			data-drop-active={groupDropOver || undefined}
			data-drop-hint={(acceptsAppend && !groupDropOver) || undefined}
			className={cn(
				"relative flex items-stretch bg-container-workspace-bg data-[drop-hint]:ring-1 data-[drop-hint]:ring-inset data-[drop-hint]:ring-primary-soft data-[drop-active]:bg-primary-subtle data-[drop-active]:ring-2 data-[drop-active]:ring-inset data-[drop-active]:ring-primary",
				vertical
					? nested
						? "w-full flex-col"
						: "h-full min-h-0 w-full flex-col border-border-default border-r"
					: "h-panel-header-row shrink-0 border-border-default border-b",
			)}
		>
			<div
				className={cn(
					"relative overflow-hidden",
					vertical ? (nested ? "flex flex-col" : "flex min-h-0 flex-1 flex-col") : "min-w-0 flex-1",
				)}
			>
				<div
					ref={scroller}
					role="tablist"
					aria-label={t(GROUP_TABS_LABELS[location.area])}
					aria-orientation={vertical ? "vertical" : undefined}
					className={
						vertical
							? nested
								? "flex flex-col items-stretch"
								: "flex min-h-0 flex-1 flex-col items-stretch overflow-x-hidden overflow-y-auto [scrollbar-width:thin]"
							: "flex h-full w-full min-w-0 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
					}
					onWheel={(event) => {
						if (vertical) return;
						if (!scroller.current || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
						scroller.current.scrollLeft += event.deltaY;
					}}
				>
					{entries.map((entry) =>
						"members" in entry ? (
							<div
								key={entry.pane.id}
								data-testid="tab-pane-group"
								data-active={entry.members.some(({ tab }) => tab.id === selectedId) || undefined}
								className="group/pane flex w-full shrink-0 flex-col divide-y divide-border-muted border-border-muted border-b border-l-2 border-l-primary transition-colors hover:bg-control-bg-hovered data-[active=true]:bg-control-bg-selected"
							>
								{entry.members.map(({ tab, index }) => renderTab(tab, index))}
							</div>
						) : (
							renderTab(entry.tab, entry.index)
						),
					)}
					{acceptsAppend ? (
						<DropZone
							id={tupleKey(
								"dnd-insert",
								location.area,
								location.groupId,
								String(tabs.length),
								"end",
							)}
							target={{ kind: "insert", location, index: tabs.length }}
							label={t("workbench.tabs.insertAtEnd")}
							className={
								vertical
									? nested
										? "relative h-8 w-full shrink-0"
										: "relative min-h-20 w-full flex-1"
									: "relative h-full w-20 shrink-0"
							}
						/>
					) : null}
				</div>
				{!vertical && scrollOverflow.before ? (
					<div
						aria-hidden="true"
						data-testid="tab-overflow-before"
						className="pointer-events-none absolute inset-y-0 left-0 z-20 w-16 bg-[linear-gradient(to_right,var(--color-container-workspace-bg),transparent)]"
					/>
				) : null}
				{!vertical && scrollOverflow.after ? (
					<div
						aria-hidden="true"
						data-testid="tab-overflow-after"
						className="pointer-events-none absolute inset-y-0 right-0 z-20 w-16 bg-[linear-gradient(to_left,var(--color-container-workspace-bg),transparent)]"
					/>
				) : null}
			</div>
			<div
				className={
					vertical
						? cn(
								"flex h-panel-header-row shrink-0 items-stretch",
								!nested && "border-border-default border-t",
							)
						: "contents"
				}
			>
				{trailing}
				{overflowing ? (
					<Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
						<PopoverTrigger asChild>
							<IconButton
								variant="ghost"
								size="m"
								icon={Search}
								label={t("workbench.tabs.search")}
								wrapTrigger
								className="shrink-0 self-center"
							/>
						</PopoverTrigger>
						<PopoverContent
							align="end"
							className="w-288 p-0"
							onCloseAutoFocus={(event) => {
								const targetId = overflowFocusTarget.current;
								if (!targetId) return;
								overflowFocusTarget.current = null;
								event.preventDefault();
								tabRefs.current.get(targetId)?.focus();
							}}
						>
							<Command>
								<CommandInput placeholder={t("workbench.tabs.findPlaceholder")} />
								<CommandList>
									<CommandEmpty>{t("workbench.tabs.noMatches")}</CommandEmpty>
									{tabs.map((tab) => (
										<TabPathContextMenu key={tab.id} tab={tab} worktreePath={worktreePath}>
											<CommandItem
												value={tab.id}
												keywords={tabSearchKeywords(t, tab, chatFirstPrompts)}
												onSelect={() => {
													overflowFocusTarget.current = tab.id;
													selectTab(tab.id);
													setOverflowOpen(false);
												}}
											>
												{renderTabIcon?.(tab, tab.id === selectedId) ?? tabIcon(tab)}
												<span className="truncate">{layoutTabName(t, tab, chatFirstPrompts)}</span>
											</CommandItem>
										</TabPathContextMenu>
									))}
								</CommandList>
							</Command>
						</PopoverContent>
					</Popover>
				) : null}
			</div>
		</div>
	);
});
TabStrip.displayName = "TabStrip";

export interface WorkbenchTabProps {
	tab: LayoutTab;
	index: number;
	reorderIndexes?: { previous: number | undefined; next: number | undefined };
	rail?: AuxiliaryRailControlProps & {
		entryKey: string;
		vertical: boolean;
		beforeIndex: number;
		afterIndex: number;
		onActivate: () => void;
	};
	location: LayoutGroupLocation;
	readAttention: () => LayoutAttention;
	selectionEpochRef: React.MutableRefObject<number>;
	active: boolean;
	preview: boolean;
	document: WorkspaceLayoutDocument;
	maxSideGroups: number;
	maxBottomGroups: number;
	register: (node: HTMLElement | null) => void;
	onSelect: (tabId: string, keep?: boolean) => void;
	onClose: () => void;
	onApply: (result: LayoutMutationResult) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (region: LayoutAuxiliaryRegion) => void;
	onRevealTool: (tool: LayoutToolId) => void;
	catalog?: LayoutToolCatalog;
	worktreePath?: string;
	onRenameChat: WorkbenchProps["onRenameChat"];
	chatFirstPrompts?: WorkbenchProps["chatFirstPrompts"];
	canFocusAdjacentGroup: boolean;
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	renderTabIcon: WorkbenchProps["renderTabIcon"];
	draggingTab: LayoutTab | null;
	panelId: string;
	vertical?: boolean;
	defaultPaneDirection?: "horizontal" | "vertical";
	subtitle?: string | undefined;
	splitGeometry?: { horizontal: boolean; vertical: boolean };
	onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export const WorkbenchTab = memo(function WorkbenchTab({
	tab,
	index,
	reorderIndexes,
	rail,
	location,
	readAttention,
	selectionEpochRef,
	active,
	preview,
	document,
	maxSideGroups,
	maxBottomGroups,
	register,
	onSelect,
	onClose,
	onApply,
	onFocusAdjacentGroup,
	onHideSide,
	onRevealTool,
	catalog = BUILTIN_LAYOUT_TOOL_CATALOG,
	worktreePath = "",
	onRenameChat,
	chatFirstPrompts,
	canFocusAdjacentGroup,
	renderTabAdornment,
	renderTabIcon,
	draggingTab,
	panelId,
	vertical = false,
	defaultPaneDirection = "horizontal",
	subtitle,
	splitGeometry,
	onKeyDown,
}: WorkbenchTabProps) {
	const t = useT();
	const {
		setNodeRef: setDragRef,
		isDragging,
		listeners: dragListeners,
	} = useDraggable({ id: tupleKey("dnd-tab", tab.id), data: { tab } satisfies DragData });
	const pendingPreviewKeep = useRef<ReturnType<typeof setTimeout> | null>(null);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const editStartNameRef = useRef("");
	const cancelNextBlurRef = useRef(false);
	const enterRenameRef = useRef(false);
	const restoreTabFocusRef = useRef(false);
	const [editingName, setEditingName] = useState(false);
	useEffect(
		() => () => {
			if (pendingPreviewKeep.current) clearTimeout(pendingPreviewKeep.current);
		},
		[],
	);
	useEffect(() => {
		if (!editingName) return;
		const frame = requestAnimationFrame(() => {
			nameInputRef.current?.focus();
			nameInputRef.current?.select();
		});
		return () => cancelAnimationFrame(frame);
	}, [editingName]);
	const focusControl = () => {
		const epoch = selectionEpochRef.current;
		requestAnimationFrame(() => {
			if (selectionEpochRef.current === epoch)
				globalThis.document.getElementById(tabDomId(location, tab.id))?.focus();
		});
	};
	const closeNameEditor = () => {
		setEditingName(false);
		if (!restoreTabFocusRef.current) return;
		restoreTabFocusRef.current = false;
		focusControl();
	};
	const commitRename = () => {
		if (cancelNextBlurRef.current) {
			cancelNextBlurRef.current = false;
			closeNameEditor();
			return;
		}
		const titleInput = nameInputRef.current?.value ?? "";
		closeNameEditor();
		if (tab.kind !== "chat") return;
		onRenameChat?.(tab.sessionId, titleInput, editStartNameRef.current);
	};
	const onNameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		event.stopPropagation();
		if (event.key === "Enter") {
			event.preventDefault();
			restoreTabFocusRef.current = true;
			nameInputRef.current?.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			restoreTabFocusRef.current = true;
			cancelNextBlurRef.current = true;
			nameInputRef.current?.blur();
		}
	};
	const selectFromClick = () => {
		if (pendingPreviewKeep.current) clearTimeout(pendingPreviewKeep.current);
		pendingPreviewKeep.current = null;
		if (!preview || !active) {
			onSelect(tab.id);
			return;
		}
		const gestureEpoch = ++selectionEpochRef.current;
		const navigationClocks = navigationClockSnapshot(readAttention());
		pendingPreviewKeep.current = setTimeout(() => {
			pendingPreviewKeep.current = null;
			if (
				selectionEpochRef.current !== gestureEpoch ||
				navigationClockSnapshot(readAttention()) !== navigationClocks
			) {
				return;
			}
			onSelect(tab.id, true);
		}, DOUBLE_CLICK_SETTLE_MS);
	};
	const selectFromDoubleClick = () => {
		if (pendingPreviewKeep.current) clearTimeout(pendingPreviewKeep.current);
		pendingPreviewKeep.current = null;
		onSelect(tab.id, true);
	};
	const beforeIndex = rail?.beforeIndex ?? index;
	const afterIndex = rail?.afterIndex ?? index + 1;
	const previousIndex = reorderIndexes
		? reorderIndexes.previous
		: index > 0
			? index - 1
			: undefined;
	const nextIndex = reorderIndexes
		? reorderIndexes.next
		: index < (findLayoutGroupTabs(document, location)?.length ?? 0) - 1
			? index + 1
			: undefined;
	const acceptsBefore =
		draggingTab !== null && canInsertDraggedTab(document, draggingTab, location, beforeIndex);
	const acceptsAfter =
		draggingTab !== null && canInsertDraggedTab(document, draggingTab, location, afterIndex);
	const { setNodeRef: setBeforeRef, isOver: beforeOver } = useDroppable({
		id: tupleKey(rail ? "dnd-rail-insert" : "dnd-insert", location.area, tab.id, "before"),
		data: { target: { kind: "insert", location, index: beforeIndex } satisfies DropTarget },
		disabled: !acceptsBefore,
	});
	const { setNodeRef: setAfterRef, isOver: afterOver } = useDroppable({
		id: tupleKey(rail ? "dnd-rail-insert" : "dnd-insert", location.area, tab.id, "after"),
		data: { target: { kind: "insert", location, index: afterIndex } satisfies DropTarget },
		disabled: !acceptsAfter,
	});
	const ownGroup =
		location.area === "center" ? findCenterGroup(document.center, location.groupId) : undefined;
	const ownPane = ownGroup ? paneForTab(ownGroup, tab.id) : undefined;
	const inPane = ownPane !== undefined;
	const acceptsPane =
		vertical &&
		location.area === "center" &&
		draggingTab !== null &&
		draggingTab.id !== tab.id &&
		!ownPane?.tabIds.includes(draggingTab.id) &&
		(findLayoutGroupTabs(document, location) ?? []).some(
			(candidate) => candidate.id === draggingTab.id,
		);
	const paneWith = useDroppable({
		id: tupleKey("dnd-pane", location.groupId, tab.id, "with"),
		data: {
			target: {
				kind: "pane",
				location,
				tabId: tab.id,
				direction: defaultPaneDirection,
			} satisfies DropTarget,
		},
		disabled: !acceptsPane || inPane,
	});
	const paneJoin = useDroppable({
		id: tupleKey("dnd-pane", location.groupId, tab.id, "join"),
		data: {
			target: {
				kind: "pane",
				location,
				tabId: tab.id,
				direction: ownPane?.direction ?? "horizontal",
			} satisfies DropTarget,
		},
		disabled: !acceptsPane || !inPane,
	});
	const paneNeighbours =
		vertical && ownGroup
			? [ownGroup.tabs[index - 1], ownGroup.tabs[index + 1]].flatMap((candidate) =>
					candidate && candidate.id !== tab.id
						? [
								{
									tab: candidate,
									direction: paneForTab(ownGroup, candidate.id)?.direction ?? defaultPaneDirection,
								},
							]
						: [],
				)
			: [];
	const paneIndex = ownPane ? ownPane.tabIds.indexOf(tab.id) : -1;
	const applyPane = (result: LayoutOperationResult) => {
		if (!isLayoutUnavailable(result)) onApply(result);
	};
	const groups = collectAllGroups(document);
	const missingTools = unplacedTools(document, catalog);
	const splitReason = (direction: CenterSplitDirection): string | null => {
		if (location.area !== "center") return t("workbench.tab.splitCenterOnly");
		if (tab.kind === "tool") return t("workbench.layout.toolsStayInSide");
		if (collectCenterGroups(document.center).length >= LAYOUT_LIMITS.maxCenterGroups) {
			return t("workbench.layout.centerGroupLimit", { limit: LAYOUT_LIMITS.maxCenterGroups });
		}
		const horizontal = direction === "left" || direction === "right";
		if (splitGeometry && !(horizontal ? splitGeometry.horizontal : splitGeometry.vertical)) {
			return horizontal
				? t("workbench.tab.splitNeedsWidth", { size: LAYOUT_LIMITS.minCenterWidth * 2 })
				: t("workbench.tab.splitNeedsHeight", { size: LAYOUT_LIMITS.minCenterHeight * 2 });
		}
		return null;
	};
	const moveTargets = groups.filter(
		(group) =>
			group.location.groupId !== location.groupId &&
			(tab.kind === "terminal" || group.location.area === "center"
				? tab.kind !== "tool"
				: tab.kind === "tool"),
	);
	const currentAuxiliary = location.area === "center" ? null : location.area;
	const currentAuxiliaryGroupIndex = currentAuxiliary
		? document[currentAuxiliary].groups.findIndex((group) => group.id === location.groupId)
		: -1;
	const currentAuxiliaryLimit = currentAuxiliary === "bottom" ? maxBottomGroups : maxSideGroups;
	const name = layoutTabName(t, tab, chatFirstPrompts, catalog);
	const chatTitle =
		tab.kind === "chat" ? chatLabel(t, tab.name, chatFirstPrompts?.[tab.sessionId]) : undefined;
	const groupRemoval = removeLayoutGroup(t, document, location);

	const move = (target: LayoutGroupLocation, targetIndex?: number) => {
		const result = moveTabToGroup(document, tab, target, targetIndex);
		if (!isLayoutUnavailable(result)) onApply(result);
	};
	const reorder = (nextIndex: number) => move(location, nextIndex);
	const focusTab = (keep?: boolean) => {
		onSelect(tab.id, keep);
		focusControl();
	};

	const tabButton = (
		<button
			ref={register}
			type="button"
			id={tabDomId(location, tab.id)}
			{...(rail
				? { "aria-label": name, "aria-pressed": active, ...railEntryButtonProps(active) }
				: { role: "tab", "aria-selected": active })}
			aria-keyshortcuts={
				rail
					? rail.vertical
						? "Enter Space Delete Home End ArrowUp ArrowDown Alt+Shift+ArrowUp Alt+Shift+ArrowDown Control+F6 Control+Shift+F6"
						: "Enter Space Delete Home End ArrowLeft ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Control+F6 Control+Shift+F6"
					: "Delete Home End ArrowLeft ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Control+F6 Control+Shift+F6"
			}
			aria-controls={panelId}
			data-testid={rail && tab.kind === "tool" ? `tool-rail-${tab.tool}` : undefined}
			data-rail-entry={rail?.entryKey}
			data-layout-tab-id={tab.id}
			tabIndex={rail ? rail.tabIndex : active ? 0 : -1}
			{...dragListeners}
			onFocus={rail?.onFocus}
			title={tab.kind === "chat" && !rail ? (chatTitle?.tooltip ?? name) : undefined}
			onMouseDown={(event) => {
				if (event.button === 1) event.preventDefault();
			}}
			onAuxClick={(event) => {
				if (event.button !== 1) return;
				event.preventDefault();
				onClose();
			}}
			onClick={rail ? rail.onActivate : selectFromClick}
			onDoubleClick={rail ? undefined : selectFromDoubleClick}
			onKeyDown={onKeyDown}
			className={
				rail
					? RAIL_ENTRY_BUTTON_CLASS
					: cn(
							"relative flex min-w-0 flex-1 items-center gap-4 self-stretch pl-8 text-left outline-none",
							vertical && "py-8",
							tab.kind === "tool" && "pr-8",
						)
			}
		>
			{renderTabIcon?.(tab, active) ??
				(rail ? tabIcon(tab, active, RAIL_ICON) : tabIcon(tab, active))}
			{rail ? null : subtitle ? (
				<span className="flex min-w-0 flex-1 flex-col">
					<span className={`truncate ${preview ? "italic" : ""}`}>{name}</span>
					<span className="truncate tr-text-metadata text-text-subtle">{subtitle}</span>
				</span>
			) : (
				<span className={`truncate ${preview ? "italic" : ""}`}>{name}</span>
			)}
			{rail ? (
				<span
					className={cn(
						"pointer-events-none absolute -right-4 flex",
						rail.vertical ? "-top-4" : "top-0",
					)}
				>
					{renderTabAdornment(tab)}
				</span>
			) : (
				renderTabAdornment(tab)
			)}
		</button>
	);
	const tabTestId =
		tab.kind === "terminal"
			? "terminal-tab"
			: tab.kind === "tool"
				? `tab-${tab.tool}`
				: "editor-tab";
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					ref={setDragRef}
					role="presentation"
					data-testid={tabTestId}
					data-active={active}
					data-preview={preview}
					data-kind={tab.kind === "document" ? "plan" : tab.kind}
					data-session-id={tab.kind === "chat" ? tab.sessionId : undefined}
					data-title-source={chatTitle?.source}
					data-dragging={(isDragging && draggingTab?.id === tab.id) || undefined}
					data-paned={inPane || undefined}
					className={cn(
						"group data-[dragging]:opacity-40",
						rail
							? railEntryFrameClass(location.area)
							: vertical
								? "relative flex w-full shrink-0 items-center border-border-muted border-b text-text-muted after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:z-10 after:w-[2px] after:content-[''] has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-inset has-[[role=tab]:focus-visible]:ring-primary data-[active=true]:bg-control-bg-selected data-[active=true]:text-text-default data-[active=true]:after:bg-primary"
								: "relative flex min-w-96 max-w-192 shrink-0 items-center border-border-default border-r text-text-muted after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-[2px] after:rounded-full after:content-[''] has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-inset has-[[role=tab]:focus-visible]:ring-primary data-[active=true]:bg-control-bg-selected data-[active=true]:text-text-default data-[active=true]:after:bg-primary",
					)}
				>
					<div
						ref={setBeforeRef}
						aria-hidden="true"
						data-drop-label={acceptsBefore ? t("workbench.tab.insertBefore", { name }) : undefined}
						data-drop-active={beforeOver || undefined}
						className={cn(
							"pointer-events-none absolute z-10 border-primary",
							rail?.vertical || vertical
								? "inset-x-0 top-0 h-1/4 data-[drop-active]:border-t-2"
								: "inset-y-0 left-0 w-1/2 data-[drop-active]:border-l-2",
						)}
					/>
					<div
						ref={setAfterRef}
						aria-hidden="true"
						data-drop-label={acceptsAfter ? t("workbench.tab.insertAfter", { name }) : undefined}
						data-drop-active={afterOver || undefined}
						className={cn(
							"pointer-events-none absolute z-10 border-primary",
							rail?.vertical || vertical
								? "inset-x-0 bottom-0 h-1/4 data-[drop-active]:border-b-2"
								: "inset-y-0 right-0 w-1/2 data-[drop-active]:border-r-2",
						)}
					/>
					{acceptsPane ? (
						<div
							ref={inPane ? paneJoin.setNodeRef : paneWith.setNodeRef}
							aria-hidden="true"
							data-drop-label={t(
								(inPane ? ownPane?.direction : defaultPaneDirection) === "vertical"
									? "workbench.tab.showUnder"
									: "workbench.tab.showBeside",
								{ name },
							)}
							data-drop-active={(inPane ? paneJoin.isOver : paneWith.isOver) || undefined}
							className="pointer-events-none absolute inset-x-0 inset-y-1/4 z-20 border-primary data-[drop-active]:border-2 data-[drop-active]:bg-primary-subtle"
						/>
					) : null}
					{editingName && tab.kind === "chat" ? (
						<div ref={register} className="flex min-w-0 flex-1 items-center gap-4 py-4 pl-8">
							{renderTabIcon?.(tab, active) ?? tabIcon(tab, active)}
							<input
								ref={nameInputRef}
								data-testid="chat-tab-name-input"
								type="text"
								spellCheck={false}
								aria-label={t("workbench.tab.chatName")}
								defaultValue={tab.name}
								onKeyDown={onNameKeyDown}
								onBlur={commitRename}
								className="min-w-0 flex-1 border-0 bg-transparent p-0 tr-text-ui text-text-default outline-none"
							/>
						</div>
					) : rail ? (
						<IconTooltip label={name} side={railTooltipSide(location.area)}>
							{tabButton}
						</IconTooltip>
					) : tab.kind === "chat" ? (
						tabButton
					) : (
						<IconTooltip
							label={preview ? t("workbench.tab.previewTitle") : name}
							side="bottom"
							align="start"
							passThrough
						>
							{tabButton}
						</IconTooltip>
					)}
					{tab.kind !== "tool" ? (
						<IconButton
							variant="ghost"
							size="s"
							icon={X}
							label={t("workbench.tab.closeNamed", { name })}
							tabIndex={-1}
							data-testid={tab.kind === "terminal" ? "terminal-tab-close" : "editor-tab-close"}
							onClick={onClose}
							className="mr-4 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
						/>
					) : null}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent
				onCloseAutoFocus={(event) => {
					if (!enterRenameRef.current) return;
					enterRenameRef.current = false;
					event.preventDefault();
				}}
			>
				<ContextMenuItem onSelect={() => focusTab()}>{t("workbench.tab.focus")}</ContextMenuItem>
				{tab.kind === "chat" && onRenameChat ? (
					<ContextMenuItem
						onSelect={() => {
							editStartNameRef.current = tab.name;
							cancelNextBlurRef.current = false;
							restoreTabFocusRef.current = false;
							enterRenameRef.current = true;
							setEditingName(true);
						}}
					>
						{t("workbench.tab.renameChat")}
					</ContextMenuItem>
				) : null}
				<ContextMenuItem
					disabled={!canFocusAdjacentGroup}
					onSelect={() => onFocusAdjacentGroup(-1, location.groupId)}
				>
					{canFocusAdjacentGroup
						? t("workbench.tab.focusPreviousGroup")
						: t("workbench.tab.focusPreviousGroupUnavailable")}
				</ContextMenuItem>
				<ContextMenuItem
					disabled={!canFocusAdjacentGroup}
					onSelect={() => onFocusAdjacentGroup(1, location.groupId)}
				>
					{canFocusAdjacentGroup
						? t("workbench.tab.focusNextGroup")
						: t("workbench.tab.focusNextGroupUnavailable")}
				</ContextMenuItem>
				{location.area === "center" ? (
					<ContextMenuItem disabled={!preview} onSelect={() => focusTab(true)}>
						{preview ? t("workbench.tab.keepPreview") : t("workbench.tab.keepPreviewUnavailable")}
					</ContextMenuItem>
				) : null}
				{ownPane ? (
					<>
						<ContextMenuItem
							disabled={paneIndex <= 0}
							onSelect={() => applyPane(reorderPaneMember(document, location.groupId, tab.id, -1))}
						>
							{t(
								ownPane.direction === "vertical"
									? "workbench.tab.moveUpInGroup"
									: "workbench.tab.moveLeftInGroup",
							)}
						</ContextMenuItem>
						<ContextMenuItem
							disabled={paneIndex >= ownPane.tabIds.length - 1}
							onSelect={() => applyPane(reorderPaneMember(document, location.groupId, tab.id, 1))}
						>
							{t(
								ownPane.direction === "vertical"
									? "workbench.tab.moveDownInGroup"
									: "workbench.tab.moveRightInGroup",
							)}
						</ContextMenuItem>
					</>
				) : (
					<>
						<ContextMenuItem
							disabled={previousIndex === undefined}
							onSelect={() => {
								if (previousIndex !== undefined) reorder(previousIndex);
							}}
						>
							{previousIndex === undefined
								? t(
										rail?.vertical || vertical
											? "workbench.tab.moveUpFirst"
											: "workbench.tab.moveLeftFirst",
									)
								: t(rail?.vertical || vertical ? "workbench.tab.moveUp" : "workbench.tab.moveLeft")}
						</ContextMenuItem>
						<ContextMenuItem
							disabled={nextIndex === undefined}
							onSelect={() => {
								if (nextIndex !== undefined) reorder(nextIndex);
							}}
						>
							{nextIndex === undefined
								? t(
										rail?.vertical || vertical
											? "workbench.tab.moveDownLast"
											: "workbench.tab.moveRightLast",
									)
								: t(
										rail?.vertical || vertical
											? "workbench.tab.moveDown"
											: "workbench.tab.moveRight",
									)}
						</ContextMenuItem>
					</>
				)}
				{location.area === "center" && (vertical || inPane) ? (
					<>
						<ContextMenuSeparator />
						{paneNeighbours.map((neighbour) => (
							<ContextMenuItem
								key={neighbour.tab.id}
								onSelect={() =>
									applyPane(
										groupTabs(
											document,
											location.groupId,
											tab.id,
											neighbour.tab.id,
											neighbour.direction,
										),
									)
								}
							>
								{t(
									neighbour.direction === "vertical"
										? "workbench.tab.showUnder"
										: "workbench.tab.showBeside",
									{ name: layoutTabName(t, neighbour.tab, chatFirstPrompts) },
								)}
							</ContextMenuItem>
						))}
						{ownPane ? (
							<ContextMenuItem
								onSelect={() =>
									applyPane(
										setPaneDirection(
											document,
											location.groupId,
											ownPane.id,
											ownPane.direction === "horizontal" ? "vertical" : "horizontal",
										),
									)
								}
							>
								{t(
									ownPane.direction === "horizontal"
										? "workbench.tab.stackGroup"
										: "workbench.tab.columnGroup",
								)}
							</ContextMenuItem>
						) : null}
						{inPane ? (
							<ContextMenuItem
								onSelect={() => applyPane(ungroupTab(document, location.groupId, tab.id))}
							>
								{t("workbench.tab.showOwn")}
							</ContextMenuItem>
						) : null}
					</>
				) : null}
				{location.area === "center" && !vertical ? (
					<>
						<ContextMenuSeparator />
						{(["left", "right", "up", "down"] as const).map((direction) => {
							const unavailable = splitReason(direction);
							return (
								<ContextMenuItem
									key={direction}
									disabled={unavailable !== null}
									title={unavailable ?? undefined}
									onSelect={() => {
										if (location.area !== "center" || tab.kind === "tool") return;
										const result = splitCenterGroup(document, location.groupId, direction, tab);
										if (!isLayoutUnavailable(result)) onApply(result);
									}}
								>
									{unavailable
										? t("workbench.menu.unavailable", {
												label: t(SPLIT_LABELS[direction]),
												reason: unavailable,
											})
										: t(SPLIT_LABELS[direction])}
								</ContextMenuItem>
							);
						})}
					</>
				) : null}
				{moveTargets.length > 0 ? <ContextMenuSeparator /> : null}
				{moveTargets.map((group) => {
					const separate = group.location.area !== "center" && !canJoinAuxiliaryGroup(group, tab);
					const label = t(MOVE_TO_PANE_LABELS[group.location.area], {
						group: describeLayoutGroup(t, group.tabs, chatFirstPrompts, undefined, catalog),
					});
					return (
						<ContextMenuItem
							key={tupleKey("move-target", group.location.area, group.location.groupId)}
							disabled={separate}
							title={separate ? separatePanesReason(t) : undefined}
							onSelect={() => move(group.location)}
						>
							{separate
								? t("workbench.menu.unavailable", { label, reason: separatePanesReason(t) })
								: label}
						</ContextMenuItem>
					);
				})}
				{currentAuxiliary &&
				currentAuxiliaryGroupIndex >= 0 &&
				(tab.kind === "terminal" || tab.kind === "tool") ? (
					<>
						<ContextMenuSeparator />
						{(["before", "after"] as const).map((position) => {
							const insertAt = currentAuxiliaryGroupIndex + (position === "after" ? 1 : 0);
							const countAvailable = canCreateAuxiliaryGroup(
								document,
								currentAuxiliary,
								tab,
								currentAuxiliaryLimit,
							);
							const available = canCreateAuxiliaryGroup(
								document,
								currentAuxiliary,
								tab,
								currentAuxiliaryLimit,
								insertAt,
							);
							const unavailable = countAvailable
								? t("workbench.tab.alreadyAtPosition")
								: t("workbench.tab.limitedTo", { limit: currentAuxiliaryLimit });
							const positionLabel =
								currentAuxiliary === "bottom"
									? position === "before"
										? t("workbench.tab.newGroupLeft")
										: t("workbench.tab.newGroupRight")
									: position === "before"
										? t("workbench.tab.newGroupAbove")
										: t("workbench.tab.newGroupBelow");
							return (
								<ContextMenuItem
									key={position}
									disabled={!available}
									title={available ? undefined : unavailable}
									onSelect={() => {
										const result = createAuxiliaryGroup(
											document,
											currentAuxiliary,
											tab,
											insertAt,
											currentAuxiliaryLimit,
										);
										if (!isLayoutUnavailable(result)) onApply(result);
									}}
								>
									{available
										? positionLabel
										: t("workbench.menu.unavailable", {
												label: positionLabel,
												reason: unavailable,
											})}
								</ContextMenuItem>
							);
						})}
					</>
				) : null}
				{tab.kind === "terminal" || tab.kind === "tool" ? (
					<>
						<ContextMenuSeparator />
						{(["left", "right", "bottom"] as const).map((region) => {
							const limit = region === "bottom" ? maxBottomGroups : maxSideGroups;
							const countAvailable = canCreateAuxiliaryGroup(document, region, tab, limit);
							const startAvailable = canCreateAuxiliaryGroup(document, region, tab, limit, 0);
							const endIndex = document[region].groups.length;
							const endAvailable = canCreateAuxiliaryGroup(document, region, tab, limit, endIndex);
							const unavailableSuffix = (available: boolean, edge: "start" | "end") =>
								available
									? null
									: countAvailable
										? t(
												edge === "start"
													? "workbench.tab.alreadyAtStart"
													: "workbench.tab.alreadyAtEnd",
											)
										: t("workbench.tab.limitedTo", { limit });
							const startLabel = t(NEW_REGION_GROUP_LABELS[region].start);
							const endLabel = t(NEW_REGION_GROUP_LABELS[region].end);
							const startUnavailable = unavailableSuffix(startAvailable, "start");
							const endUnavailable = unavailableSuffix(endAvailable, "end");
							return (
								<Fragment key={region}>
									<ContextMenuItem
										disabled={!startAvailable}
										title={startUnavailable ?? undefined}
										onSelect={() => {
											const result = createAuxiliaryGroup(document, region, tab, 0, limit);
											if (!isLayoutUnavailable(result)) onApply(result);
										}}
									>
										{startUnavailable
											? t("workbench.menu.unavailable", {
													label: startLabel,
													reason: startUnavailable,
												})
											: startLabel}
									</ContextMenuItem>
									<ContextMenuItem
										disabled={!endAvailable}
										title={endUnavailable ?? undefined}
										onSelect={() => {
											const result = createAuxiliaryGroup(document, region, tab, endIndex, limit);
											if (!isLayoutUnavailable(result)) onApply(result);
										}}
									>
										{endUnavailable
											? t("workbench.menu.unavailable", { label: endLabel, reason: endUnavailable })
											: endLabel}
									</ContextMenuItem>
								</Fragment>
							);
						})}
					</>
				) : null}
				{location.area !== "center" && missingTools.length > 0 ? (
					<>
						<ContextMenuSeparator />
						{missingTools.map((tool) => (
							<ContextMenuItem key={tool} onSelect={() => onRevealTool(tool)}>
								{t("workbench.tab.showTool", {
									name: layoutTabName(t, toolTab(tool, catalog), undefined, catalog),
								})}
							</ContextMenuItem>
						))}
					</>
				) : null}
				<TabPathMenuItems tab={tab} worktreePath={worktreePath} />
				<ContextMenuSeparator />
				{location.area !== "center" ? (
					<ContextMenuItem onSelect={() => onHideSide(location.area)}>
						{location.area === "bottom"
							? t("workbench.bottom.hide")
							: t(
									location.area === "left"
										? "workbench.tab.hideLeftSide"
										: "workbench.tab.hideRightSide",
								)}
					</ContextMenuItem>
				) : null}
				<ContextMenuItem
					disabled={isLayoutUnavailable(groupRemoval)}
					title={isLayoutUnavailable(groupRemoval) ? groupRemoval.reason : undefined}
					onSelect={() => {
						if (!isLayoutUnavailable(groupRemoval)) onApply(groupRemoval);
					}}
				>
					{isLayoutUnavailable(groupRemoval)
						? t("workbench.menu.unavailable", {
								label: t("workbench.group.remove"),
								reason: groupRemoval.reason,
							})
						: t("workbench.group.remove")}
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={onClose}
					className="text-feedback-error focus:text-feedback-error"
				>
					{rail ? t("workbench.tab.removeToolFromGroup") : t("common.close")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
});
WorkbenchTab.displayName = "WorkbenchTab";
