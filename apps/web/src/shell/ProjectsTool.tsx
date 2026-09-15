import type { Workspace } from "@thinkrail/contracts";
import { useLayoutEffect, useRef } from "react";
import { ProjectTree } from "../panels/ProjectTree";
import { useAppStore } from "../store";
import {
	collectCenterGroups,
	type LayoutCenterTab,
	layoutTabIcon,
	layoutTabName,
	paneForTab,
	selectTab,
	useCenterTabsInProjects,
} from "./layout";

const noIcon = () => null;

function WorkspaceTabsPreview({ workspace }: { workspace: Workspace }) {
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspace.id]);
	if (!document) return null;
	const groups = collectCenterGroups(document.center).filter((group) => group.tabs.length > 0);
	if (groups.length === 0) return null;
	const open = (groupId: string, tab: LayoutCenterTab) => {
		const state = useAppStore.getState();
		const attention = state.layoutAttentionByWorkspace[workspace.id];
		if (attention) {
			state.setLayoutAttention(
				workspace.id,
				selectTab(attention, { area: "center", groupId }, tab.id, true, true),
			);
		}
		state.activateWorkspace(workspace);
	};
	const renderTab = (groupId: string, tab: LayoutCenterTab, grouped = false) => (
		<button
			key={tab.id}
			type="button"
			data-testid="workspace-tab-preview"
			onClick={() => open(groupId, tab)}
			className={`flex h-28 w-full min-w-0 items-center gap-4 pl-8 text-left tr-text-ui text-text-muted ${grouped ? "group-hover/pane:text-text-default" : "rounded-[var(--radius-sm)] hover:bg-control-bg-hovered hover:text-text-default"}`}
		>
			{layoutTabIcon(tab, noIcon)}
			<span className="truncate">{layoutTabName(tab)}</span>
		</button>
	);
	return (
		<ul data-testid="workspace-tabs-preview" className="flex flex-col">
			{groups.flatMap((group) =>
				group.tabs.map((tab) => {
					const pane = paneForTab(group, tab.id);
					if (!pane) return <li key={tab.id}>{renderTab(group.id, tab)}</li>;
					const members = group.tabs.filter((member) => pane.tabIds.includes(member.id));
					if (members[0]?.id !== tab.id) return null;
					return (
						<li
							key={pane.id}
							data-testid="tab-pane-group"
							className="group/pane flex w-full flex-col divide-y divide-border-default rounded-[var(--radius-md)] border border-transparent border-l-2 border-l-primary transition-colors hover:bg-control-bg-hovered"
						>
							{members.map((member) => renderTab(group.id, member, true))}
						</li>
					);
				}),
			)}
		</ul>
	);
}

let projectsScrollTop = 0;

/** The workbench remounts per workspace; the Projects pane's scroll position outlives that. See shell/SPEC.md. */
function useProjectsScrollMemory() {
	const anchor = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const viewport = anchor.current?.parentElement;
		if (!viewport) return;
		viewport.scrollTop = projectsScrollTop;
		const remember = () => {
			projectsScrollTop = viewport.scrollTop;
		};
		viewport.addEventListener("scroll", remember, { passive: true });
		return () => viewport.removeEventListener("scroll", remember);
	}, []);
	return anchor;
}

/**
 * The Projects tool: the tree, plus — with vertical tabs at home in Projects — each workspace's centre
 * tabs under its row: the live strips for the active workspace, a preview for every other.
 */
export function ProjectsTool({ activeWorkspaceId }: { activeWorkspaceId: string | null }) {
	const inProjects = useAppStore(
		(state) =>
			state.localLayoutPreferences.verticalCenterTabs &&
			state.localLayoutPreferences.verticalTabsInProjects,
	);
	const activeStrips = useCenterTabsInProjects();
	const anchor = useProjectsScrollMemory();
	return (
		<div ref={anchor} className="contents">
			<ProjectTree
				{...(inProjects
					? {
							renderWorkspaceTabs: (workspace: Workspace) =>
								workspace.id === activeWorkspaceId && activeStrips ? (
									activeStrips
								) : (
									<WorkspaceTabsPreview workspace={workspace} />
								),
						}
					: {})}
			/>
		</div>
	);
}
