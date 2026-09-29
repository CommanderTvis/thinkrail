import { RiCloseLine as X } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	type ImperativePanelGroupHandle,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@thinkrail/ui/resizable";
import { Fragment, memo, useDeferredValue, useMemo, useRef } from "react";
import { PiGlyph } from "../../components/PiGlyph";
import { type LayoutAttention, readLayoutSelection, tupleKey } from "../../lib";
import {
	canPlaceLayoutTab,
	collectCenterGroups,
	isLayoutUnavailable,
	LAYOUT_LIMITS,
	type LayoutGroupLocation,
	paneForTab,
	removeLayoutGroup,
	resizeCenterSplit,
	setPaneWeights,
} from "./model";
import {
	type LayoutCenterGroup,
	type LayoutCenterNode,
	type LayoutCenterSplit,
	type LayoutTabPane,
	VERTICAL_TABS_WIDTH,
} from "./types";
import type { SharedGroupProps, WorkbenchProps } from "./workbenchShared";
import {
	CenterSplitTarget,
	GroupTabBody,
	groupDomId,
	groupPanelId,
	tabDomId,
	useCommittedSizes,
	useElementSize,
	useEnforcedLayout,
} from "./workbenchShared";
import { TabStrip } from "./workbenchTabs";

function PaneBody({
	group,
	pane,
	members,
	projectionEpoch,
	shared,
}: {
	group: LayoutCenterGroup;
	pane: LayoutTabPane;
	members: LayoutCenterGroup["tabs"];
	projectionEpoch: number;
	shared: SharedGroupProps;
}) {
	const weights = useMemo(() => pane.weights.map((weight) => weight * 100), [pane.weights]);
	const groupRef = useRef<ImperativePanelGroupHandle>(null);
	useEnforcedLayout(groupRef, weights, null);
	const resize = useCommittedSizes(
		weights,
		tupleKey(shared.workspaceId, String(projectionEpoch)),
		groupRef,
		(sizes) => {
			const next = sizes.map((size) => size / 100);
			if (!next.every((weight) => weight > 0 && weight < 1)) return;
			const result = setPaneWeights(shared.document, group.id, pane.id, next);
			if (!isLayoutUnavailable(result)) shared.onApply(result);
		},
		shared.onGestureCanceled,
	);
	return (
		<ResizablePanelGroup
			key={tupleKey("pane", pane.id, String(members.length))}
			ref={groupRef}
			direction={pane.direction}
			onLayout={resize.onLayout}
			className="absolute inset-0"
		>
			{members.map((tab, index) => (
				<Fragment key={tab.id}>
					{index > 0 ? (
						<ResizableHandle
							direction={pane.direction}
							onDragging={resize.onDragging}
							onKeyDownCapture={resize.onKeyboard}
							onKeyUpCapture={resize.onKeyboardEnd}
						/>
					) : null}
					<ResizablePanel
						id={tupleKey("pane-panel", pane.id, tab.id)}
						order={index + 1}
						defaultSize={weights[index] ?? 100 / members.length}
						minSize={10}
					>
						<div
							data-testid="pane-member"
							data-tab-id={tab.id}
							className="relative h-full min-h-0 min-w-0 overflow-hidden"
						>
							<GroupTabBody
								tab={tab}
								renderTabBody={shared.renderTabBody}
								renderToolBody={shared.renderToolBody}
							/>
						</div>
					</ResizablePanel>
				</Fragment>
			))}
		</ResizablePanelGroup>
	);
}

export function CenterGroupStrips({
	attention,
	shared,
	onNewChat,
	renderCenterActions,
}: {
	attention: LayoutAttention;
	shared: SharedGroupProps;
	onNewChat: WorkbenchProps["onNewChat"];
	renderCenterActions: WorkbenchProps["renderCenterActions"];
}) {
	return collectCenterGroups(shared.document.center).map((group) => (
		<CenterGroupStrip
			key={tupleKey("projects-strip", group.id)}
			group={group}
			selectedId={readLayoutSelection(attention, group.id)}
			shared={shared}
			onNewChat={onNewChat}
			renderCenterActions={renderCenterActions}
			orientation="vertical"
			nested
		/>
	));
}

function CenterGroupStrip({
	group,
	selectedId,
	shared,
	onNewChat,
	renderCenterActions,
	orientation,
	splitGeometry,
	nested,
}: {
	group: LayoutCenterGroup;
	selectedId: string | undefined;
	shared: SharedGroupProps;
	onNewChat: WorkbenchProps["onNewChat"];
	renderCenterActions: WorkbenchProps["renderCenterActions"];
	orientation: "horizontal" | "vertical";
	splitGeometry?: { horizontal: boolean; vertical: boolean };
	nested?: boolean;
}) {
	const t = useT();
	const location: LayoutGroupLocation = { area: "center", groupId: group.id };
	const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
	const groupRemoval = removeLayoutGroup(t, shared.document, location);
	return (
		<TabStrip
			document={shared.document}
			readAttention={shared.readAttention}
			selectionEpochRef={shared.selectionEpochRef}
			location={location}
			tabs={group.tabs}
			selectedId={selected?.id}
			previewId={group.previewTabId}
			maxSideGroups={shared.maxSideGroups}
			maxBottomGroups={shared.maxBottomGroups}
			draggingTab={shared.draggingTab}
			{...(splitGeometry ? { splitGeometry } : {})}
			orientation={orientation}
			defaultPaneDirection={shared.defaultPaneDirection}
			nested={nested}
			onSelect={(tabId, keep) =>
				shared.onSelectTab(location, tabId, {
					center: true,
					...(keep !== undefined ? { keep } : {}),
				})
			}
			onClose={shared.onClose}
			onApply={shared.onApply}
			onFocusAdjacentGroup={shared.onFocusAdjacentGroup}
			onHideSide={shared.onHideSide}
			onRevealTool={shared.onRevealTool}
			catalog={shared.catalog}
			worktreePath={shared.worktreePath}
			onRenameChat={shared.onRenameChat}
			{...(shared.chatFirstPrompts ? { chatFirstPrompts: shared.chatFirstPrompts } : {})}
			canFocusAdjacentGroup={shared.canFocusAdjacentGroup}
			renderTabAdornment={shared.renderTabAdornment}
			renderTabIcon={shared.renderTabIcon}
			trailing={
				<>
					{renderCenterActions(group.id)}
					{group.tabs.length === 0 ? (
						<IconButton
							variant="ghost"
							size="m"
							icon={X}
							label={t("workbench.group.remove")}
							tooltip={
								isLayoutUnavailable(groupRemoval)
									? groupRemoval.reason
									: t("workbench.group.remove")
							}
							data-testid="remove-layout-group"
							wrapTrigger
							disabled={isLayoutUnavailable(groupRemoval)}
							onClick={() => {
								if (!isLayoutUnavailable(groupRemoval)) shared.onApply(groupRemoval);
							}}
							className="shrink-0 self-center"
						/>
					) : null}
					<IconButton
						variant="ghost"
						size="m"
						icon={PiGlyph}
						label={t("workbench.center.newChat")}
						data-testid="new-chat"
						onClick={() => onNewChat(group.id)}
						className="shrink-0 self-center"
					/>
				</>
			}
		/>
	);
}

export const CenterGroupView = memo(function CenterGroupView({
	group,
	selectedId,
	projectionEpoch,
	onNewChat,
	renderEmptyCenter,
	renderCenterActions,
	...shared
}: SharedGroupProps & {
	group: LayoutCenterGroup;
	selectedId: string | undefined;
	projectionEpoch: number;
	onNewChat: WorkbenchProps["onNewChat"];
	renderEmptyCenter: WorkbenchProps["renderEmptyCenter"];
	renderCenterActions: WorkbenchProps["renderCenterActions"];
}) {
	const t = useT();
	const location: LayoutGroupLocation = { area: "center", groupId: group.id };
	const [sizeRef, size] = useElementSize();
	const splitGeometry = {
		horizontal: size.width >= LAYOUT_LIMITS.minCenterWidth * 2,
		vertical: size.height >= LAYOUT_LIMITS.minCenterHeight * 2,
	};
	const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
	// The strip answers the click; the document follows when it is ready — see layout/SPEC.md.
	const bodyTabId = useDeferredValue(selected?.id);
	const bodyTab = group.tabs.find((tab) => tab.id === bodyTabId) ?? selected;
	const column = shared.verticalCenterTabs && !shared.verticalTabsInProjects;
	const inProjects = shared.verticalCenterTabs && shared.verticalTabsInProjects;
	const toStripPercent = (px: number) => (size.width > 0 ? (px / size.width) * 100 : 20);
	const verticalMinPercent = Math.min(50, toStripPercent(VERTICAL_TABS_WIDTH.min));
	const verticalMaxPercent = Math.max(verticalMinPercent, toStripPercent(VERTICAL_TABS_WIDTH.max));
	const onVerticalWidthChange = shared.onVerticalCenterTabsWidthChange;
	const onVerticalLayout = (sizes: number[]) => {
		if (!onVerticalWidthChange || size.width <= 0) return;
		onVerticalWidthChange(Math.round(((sizes[0] ?? 0) / 100) * size.width));
	};
	// Creation is a vertical-strip gesture, but a pane that exists renders in either orientation.
	const activePane = selected ? paneForTab(group, selected.id) : undefined;
	const paneTabs = activePane
		? activePane.tabIds.flatMap((id) => group.tabs.find((tab) => tab.id === id) ?? [])
		: [];
	const strip = (
		<CenterGroupStrip
			group={group}
			selectedId={selectedId}
			shared={shared}
			onNewChat={onNewChat}
			renderCenterActions={renderCenterActions}
			orientation={column ? "vertical" : "horizontal"}
			splitGeometry={splitGeometry}
		/>
	);
	const panel = (
		<div
			id={groupPanelId(location)}
			data-testid="editor-pane"
			role="tabpanel"
			aria-labelledby={selected ? tabDomId(location, selected.id) : undefined}
			className="relative min-h-0 flex-1 overflow-hidden"
		>
			{activePane && paneTabs.length > 1 ? (
				<PaneBody
					group={group}
					pane={activePane}
					members={paneTabs}
					projectionEpoch={projectionEpoch}
					shared={shared}
				/>
			) : bodyTab ? (
				<GroupTabBody
					key={bodyTab.id}
					tab={bodyTab}
					renderTabBody={shared.renderTabBody}
					renderToolBody={shared.renderToolBody}
				/>
			) : (
				renderEmptyCenter(group.id)
			)}
		</div>
	);
	return (
		<section
			ref={sizeRef}
			id={groupDomId(location)}
			data-testid="center-group"
			data-group-id={group.id}
			tabIndex={-1}
			aria-label={
				group.tabs.length === 0 ? t("workbench.center.emptyGroup") : t("workbench.center.group")
			}
			className="relative flex h-full min-h-0 min-w-0 flex-col bg-container-content-bg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
			onFocusCapture={() => {
				if (selected) shared.onFocusGroup(location, selected.id);
			}}
		>
			{column ? (
				<ResizablePanelGroup
					key={tupleKey("vertical-tabs", group.id)}
					direction="horizontal"
					onLayout={onVerticalLayout}
					className="min-h-0 min-w-0 flex-1"
				>
					<ResizablePanel
						id={tupleKey("vertical-tabs-panel", group.id, "strip")}
						order={1}
						defaultSize={toStripPercent(shared.verticalCenterTabsWidth)}
						minSize={verticalMinPercent}
						maxSize={verticalMaxPercent}
					>
						{strip}
					</ResizablePanel>
					<ResizableHandle direction="horizontal" data-testid="vertical-tabs-resize" />
					<ResizablePanel
						id={tupleKey("vertical-tabs-panel", group.id, "editor")}
						order={2}
						minSize={20}
					>
						<div className="flex h-full min-h-0 min-w-0 flex-col">{panel}</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			) : (
				<>
					{inProjects ? null : strip}
					{panel}
				</>
			)}
			{shared.draggingTab &&
			canPlaceLayoutTab(shared.draggingTab, "center") &&
			collectCenterGroups(shared.document.center).length < LAYOUT_LIMITS.maxCenterGroups ? (
				<div className="pointer-events-none absolute inset-0 z-30">
					{splitGeometry.horizontal ? (
						<>
							<CenterSplitTarget
								groupId={group.id}
								direction="left"
								label={t("workbench.center.splitLeft")}
								edgeClassName="inset-y-1/4 left-4 w-1/5"
								halfClassName="inset-y-0 left-0 w-1/2"
							/>
							<CenterSplitTarget
								groupId={group.id}
								direction="right"
								label={t("workbench.center.splitRight")}
								edgeClassName="inset-y-1/4 right-4 w-1/5"
								halfClassName="inset-y-0 right-0 w-1/2"
							/>
						</>
					) : null}
					{splitGeometry.vertical ? (
						<>
							<CenterSplitTarget
								groupId={group.id}
								direction="up"
								label={t("workbench.center.splitUp")}
								edgeClassName="inset-x-1/4 top-32 h-1/5"
								halfClassName="inset-x-0 top-0 h-1/2"
							/>
							<CenterSplitTarget
								groupId={group.id}
								direction="down"
								label={t("workbench.center.splitDown")}
								edgeClassName="inset-x-1/4 bottom-4 h-1/5"
								halfClassName="inset-x-0 bottom-0 h-1/2"
							/>
						</>
					) : null}
				</div>
			) : null}
		</section>
	);
});
CenterGroupView.displayName = "CenterGroupView";

export type CenterNodeProps = SharedGroupProps & {
	node: LayoutCenterNode;
	attention: LayoutAttention;
	projectionEpoch: number;
	onCommit: WorkbenchProps["onCommit"];
	onNewChat: WorkbenchProps["onNewChat"];
	renderEmptyCenter: WorkbenchProps["renderEmptyCenter"];
	renderCenterActions: WorkbenchProps["renderCenterActions"];
};

export const CenterNodeView = memo(function CenterNodeView({
	node,
	attention,
	projectionEpoch,
	onCommit,
	onNewChat,
	...shared
}: CenterNodeProps) {
	return node.kind === "group" ? (
		<CenterGroupView
			key={tupleKey("center-node", node.id)}
			group={node}
			selectedId={readLayoutSelection(attention, node.id)}
			projectionEpoch={projectionEpoch}
			onNewChat={onNewChat}
			{...shared}
		/>
	) : (
		<CenterSplitView
			key={tupleKey("center-node", node.id)}
			node={node}
			attention={attention}
			projectionEpoch={projectionEpoch}
			onCommit={onCommit}
			onNewChat={onNewChat}
			{...shared}
		/>
	);
});
CenterNodeView.displayName = "CenterNodeView";

export const CenterSplitView = memo(function CenterSplitView({
	node,
	attention,
	projectionEpoch,
	onCommit,
	onNewChat,
	...shared
}: Omit<CenterNodeProps, "node"> & { node: LayoutCenterSplit }) {
	const [sizeRef, size] = useElementSize();
	const weights = useMemo(() => node.weights.map((weight) => weight * 100), [node.weights]);
	const groupRef = useRef<ImperativePanelGroupHandle>(null);
	useEnforcedLayout(groupRef, weights, null);
	const resize = useCommittedSizes(
		weights,
		tupleKey(shared.workspaceId, String(projectionEpoch)),
		groupRef,
		(sizes) => {
			const next = resizeCenterSplit(shared.document, node.id, [sizes[0] ?? 50, sizes[1] ?? 50]);
			if (next !== shared.document) onCommit(next);
		},
		shared.onGestureCanceled,
	);
	const dimension = node.direction === "horizontal" ? size.width : size.height;
	const minimumPixels =
		node.direction === "horizontal" ? LAYOUT_LIMITS.minCenterWidth : LAYOUT_LIMITS.minCenterHeight;
	const minimumPercent = dimension >= minimumPixels * 2 ? (minimumPixels / dimension) * 100 : 4;
	return (
		<div ref={sizeRef} className="h-full min-h-0 min-w-0 overflow-hidden">
			<ResizablePanelGroup
				ref={groupRef}
				direction={node.direction}
				onLayout={resize.onLayout}
				className="min-h-0 min-w-0"
			>
				<ResizablePanel
					id={tupleKey("center-split-panel", node.id, "0")}
					order={1}
					defaultSize={weights[0]}
					minSize={minimumPercent}
				>
					<CenterNodeView
						node={node.children[0]}
						attention={attention}
						projectionEpoch={projectionEpoch}
						onCommit={onCommit}
						onNewChat={onNewChat}
						{...shared}
					/>
				</ResizablePanel>
				<ResizableHandle
					direction={node.direction}
					data-testid="center-split-resize"
					disabled={dimension < minimumPixels * 2}
					onDragging={resize.onDragging}
					onKeyDownCapture={resize.onKeyboard}
					onKeyUpCapture={resize.onKeyboardEnd}
				/>
				<ResizablePanel
					id={tupleKey("center-split-panel", node.id, "1")}
					order={2}
					defaultSize={weights[1]}
					minSize={minimumPercent}
				>
					<CenterNodeView
						node={node.children[1]}
						attention={attention}
						projectionEpoch={projectionEpoch}
						onCommit={onCommit}
						onNewChat={onNewChat}
						{...shared}
					/>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
});
CenterSplitView.displayName = "CenterSplitView";
