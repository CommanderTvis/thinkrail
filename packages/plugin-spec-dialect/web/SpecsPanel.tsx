import {
	RiBookOpenLine as BookOpen,
	RiBox3Line as Box,
	RiStackLine as Boxes,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileTextLine as FileText,
	RiListCheck3 as ListChecks,
	RiNetworkLine as Network,
	RiRefreshLine as RefreshCw,
	RiBookOpenFill,
	RiBox3Fill,
	RiFileTextFill,
	RiNetworkFill,
	RiStackFill,
} from "@remixicon/react";
import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import { Button } from "@thinkrail/plugin-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { specDialectContract } from "../contracts";
import { loadWorkspaceSpecs } from "./specSync";
import {
	buildSpecTree,
	type SpecTreeNode,
	specDisplayTitle,
	specRoleLabel,
	specRoleTag,
} from "./specTree";
import { useSpecStore } from "./store";

type Ctx = PluginWebContext<typeof specDialectContract>;

const SKELETON_ROW_KEYS = ["a", "b", "c", "d", "e", "f"];

export function createSpecsPanel(ctx: Ctx) {
	function specRoleIcon(type: string, filled: boolean) {
		switch (type) {
			case "goal-and-requirements":
				return filled ? RiBookOpenFill : BookOpen;
			case "architecture-design":
				return filled ? RiNetworkFill : Network;
			case "module-design":
				return filled ? RiBox3Fill : Box;
			case "submodule-design":
				return filled ? RiStackFill : Boxes;
			case "task-spec":
				return ListChecks;
			default:
				return filled ? RiFileTextFill : FileText;
		}
	}

	function SpecNodeRow({
		tree,
		workspaceId,
		activeFilePath,
		depth,
	}: {
		tree: SpecTreeNode;
		workspaceId: string;
		activeFilePath: string | null;
		depth: number;
	}) {
		const { node, children } = tree;
		const [expanded, setExpanded] = useState(true);
		const isActive = activeFilePath === node.path;
		const isMainSpec = depth === 0 && node.type === "goal-and-requirements";
		const role = specRoleLabel(node.type);
		const trailingRole = isMainSpec ? "Main spec" : specRoleTag(node.type);
		const DocumentIcon = specRoleIcon(node.type, isActive || isMainSpec);
		const Chevron = expanded ? ChevronDown : ChevronRight;

		return (
			<li>
				<div
					className={`group flex h-28 min-w-0 items-stretch rounded-[var(--radius-sm)] px-4 transition-colors ${
						isActive
							? "bg-primary-subtle ring-1 ring-primary-muted ring-inset has-[:focus-visible]:ring-0"
							: "hover:bg-control-bg-hovered"
					}`}
				>
					{children.length > 0 ? (
						<button
							type="button"
							data-testid="spec-toggle"
							aria-label={expanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
							aria-expanded={expanded}
							onClick={() => setExpanded((value) => !value)}
							className="flex w-20 shrink-0 items-center justify-center self-stretch rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
						>
							<Chevron className="size-16" />
						</button>
					) : (
						<span className="w-20 shrink-0" />
					)}
					<button
						type="button"
						data-testid="spec-node"
						data-spec-id={node.id}
						data-spec-type={node.type}
						data-spec-role={trailingRole}
						data-main-spec={isMainSpec ? "true" : undefined}
						data-active={isActive}
						data-depth={depth}
						aria-current={isActive ? "page" : undefined}
						aria-label={`Open ${node.title}. ${isMainSpec ? "Main spec" : role}`}
						title={`${node.title}\n${node.id} · ${node.type}`}
						onClick={() => void ctx.editors.open(workspaceId, node.path, { preview: true })}
						onDoubleClick={() => void ctx.editors.open(workspaceId, node.path)}
						className="flex h-28 min-w-0 flex-1 items-center gap-4 rounded-[var(--radius-sm)] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
					>
						<DocumentIcon
							className={`size-14 shrink-0 transition-colors ${
								isMainSpec || isActive
									? "text-primary"
									: "text-text-muted group-hover:text-text-muted"
							}`}
						/>
						<span
							className={`min-w-0 flex-1 truncate tr-text-ui transition-colors ${
								isActive ? "text-text-default" : "text-text-muted group-hover:text-text-default"
							}`}
						>
							{specDisplayTitle(node.title)}
						</span>
						<span
							data-testid="spec-role"
							className={`hidden shrink-0 text-right tr-text-eyebrow group-hover:block group-focus-within:block ${
								isMainSpec || isActive ? "text-primary" : "text-text-subtle"
							}`}
						>
							{trailingRole}
						</span>
					</button>
				</div>
				{children.length > 0 && expanded && (
					<ul className="flex flex-col pl-12">
						{children.map((child) => (
							<SpecNodeRow
								key={child.node.id}
								tree={child}
								workspaceId={workspaceId}
								activeFilePath={activeFilePath}
								depth={depth + 1}
							/>
						))}
					</ul>
				)}
			</li>
		);
	}

	return function SpecsPanel({ workspaceId }: { workspaceId: string }) {
		const nodes = useSpecStore((s) => s.specsByWorkspace[workspaceId]) ?? null;
		const failed = useSpecStore((s) => s.failedByWorkspace[workspaceId]) ?? false;
		const activeEditor = ctx.useHost((host) => host.activeEditor);
		const selectRequest = useSpecStore((s) => s.selectRequest);
		const reload = useCallback(() => void loadWorkspaceSpecs(ctx, workspaceId), [workspaceId]);

		useEffect(() => {
			if (selectRequest?.workspaceId !== workspaceId) return;
			void ctx.editors.open(workspaceId, selectRequest.path, { preview: true });
			useSpecStore.getState().clearSelectRequest();
		}, [selectRequest, workspaceId]);

		const roots = useMemo(() => (nodes ? buildSpecTree(nodes) : null), [nodes]);

		const content =
			nodes === null || roots === null ? (
				failed ? null : (
					<div className="flex flex-col gap-8 px-4 py-4">
						{SKELETON_ROW_KEYS.map((key) => (
							<div
								key={key}
								className="h-16 animate-pulse rounded-[var(--radius-sm)] bg-control-bg-hovered"
							/>
						))}
					</div>
				)
			) : nodes.length === 0 ? (
				failed ? null : (
					<p className="px-4 py-4 tr-text-metadata text-text-muted">No specs</p>
				)
			) : (
				<ul className="flex flex-col motion-safe:animate-reveal">
					{roots.map((root) => (
						<SpecNodeRow
							key={root.node.id}
							tree={root}
							workspaceId={workspaceId}
							activeFilePath={
								activeEditor?.workspaceId === workspaceId && activeEditor.kind === "file"
									? activeEditor.path
									: null
							}
							depth={0}
						/>
					))}
				</ul>
			);
		return (
			<div className="flex min-h-0 flex-col">
				{failed ? (
					<div
						role="alert"
						data-testid="specs-error"
						className="flex items-center gap-8 rounded-[var(--radius-sm)] border border-feedback-error-muted bg-feedback-error-subtle px-8 py-4 tr-text-metadata text-text-default"
					>
						<span className="min-w-0 flex-1">
							{nodes === null ? "Couldn't load specs." : "Couldn't update specs."}
						</span>
						<Button variant="ghost" size="sm" data-testid="specs-retry" onClick={reload}>
							<RefreshCw className="size-14" />
							Retry
						</Button>
					</div>
				) : null}
				{content}
			</div>
		);
	};
}
