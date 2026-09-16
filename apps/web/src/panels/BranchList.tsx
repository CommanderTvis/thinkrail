import {
	RiArrowDownSLine as ChevronDown,
	RiArrowLeftDownLine as Fetch,
	RiGitBranchLine as GitBranch,
	RiDeleteBinLine as Trash,
} from "@remixicon/react";
import type {
	BranchDeleteResult,
	BranchDetail,
	RemoteBranchGroup,
	Workspace,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconTooltip } from "@/components/ui/tooltip";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConfirmPopover } from "./ConfirmPopover";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { RemoteGroupHeading } from "./RemoteGroupHeading";
import { useRemoteGroupCollapse } from "./remoteGroupCollapse";

type DirtyWorktreeRecovery = Extract<BranchDeleteResult, { recovery: unknown }>;

function isDirtyWorktreeRecovery(result: BranchDeleteResult): result is DirtyWorktreeRecovery {
	return "recovery" in result;
}

function Row({
	detail,
	onDeleted,
	onOpenWorkspace,
	projectId,
}: {
	detail: BranchDetail;
	projectId: string;
	onDeleted: () => void;
	onOpenWorkspace: (workspaceId: string) => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [recovery, setRecovery] = useState<DirtyWorktreeRecovery | null>(null);
	const [forcePath, setForcePath] = useState<string | null>(null);
	const held = detail.workspaceId !== undefined;
	const foreign = !held && detail.worktreePath !== undefined;
	const reason = held
		? `${detail.workspaceName ?? "A workspace"} is living on this branch — remove the workspace first.`
		: detail.isCurrent
			? "This branch is checked out here."
			: null;

	const remove = (force = false) => {
		setConfirming(false);
		getTransport()
			.request(
				"git.deleteBranch",
				force
					? { projectId, branch: detail.branch, force: true }
					: { projectId, branch: detail.branch },
			)
			.then((result) => {
				if (isDirtyWorktreeRecovery(result)) {
					setRecovery(result);
					return;
				}
				onDeleted();
			})
			.catch((error) => toast.error(errorText(error), "Couldn't delete the branch"));
	};

	const nameContent = (
		<>
			<span className="flex min-w-0 items-center gap-4">
				<span className="truncate tr-text-ui text-text-default">{detail.branch}</span>
				{detail.isCurrent ? (
					<span className="shrink-0 tr-text-label-pill text-text-subtle uppercase">here</span>
				) : null}
				{detail.isDefault ? (
					<span className="shrink-0 tr-text-label-pill text-text-subtle uppercase">default</span>
				) : null}
			</span>
			{detail.worktreePath ? (
				<IconTooltip label={detail.worktreePath} delayDuration={0}>
					<span data-testid="branch-worktree" className="truncate tr-code-text text-text-subtle">
						{detail.worktreePath}
					</span>
				</IconTooltip>
			) : null}
		</>
	);

	return (
		<li
			data-testid="branch-row"
			data-branch={detail.branch}
			data-held={held || undefined}
			className="flex items-start gap-8 px-8 py-4 hover:bg-control-bg-hovered"
		>
			<GitBranch className="mt-2 size-14 shrink-0 text-text-subtle" />
			{held ? (
				<button
					type="button"
					data-testid="branch-open-workspace"
					aria-label={`Open workspace on ${detail.branch}`}
					onClick={() => onOpenWorkspace(detail.workspaceId as string)}
					className="flex min-w-0 flex-1 flex-col items-start text-left"
				>
					{nameContent}
				</button>
			) : (
				<span className="flex min-w-0 flex-1 flex-col">{nameContent}</span>
			)}
			<ConfirmDialog
				open={recovery !== null}
				onOpenChange={(open) => {
					if (!open) setRecovery(null);
				}}
				title={`Couldn't delete ${detail.branch}`}
				description={<span className="break-all">{recovery?.recovery.message}</span>}
				confirmLabel="Force remove worktree…"
				destructive
				confirmTestId="branch-force-recovery"
				onConfirm={() => setForcePath(recovery?.recovery.worktreePath ?? null)}
			/>
			<ConfirmDialog
				open={forcePath !== null}
				onOpenChange={(open) => {
					if (!open) setForcePath(null);
				}}
				title="Force remove worktree?"
				description={
					<>
						The worktree at <span className="break-all">{forcePath ?? "this path"}</span> will be
						permanently removed. Its uncommitted and untracked files will be discarded, then{" "}
						{detail.branch}
						will be deleted.
					</>
				}
				confirmLabel="Force remove worktree"
				destructive
				confirmTestId="branch-force-confirm"
				onConfirm={() => remove(true)}
			/>
			<ConfirmPopover
				open={confirming}
				onOpenChange={setConfirming}
				title={`Delete ${detail.branch}?`}
				description={
					foreign ? (
						<>
							The worktree at <span className="break-all">{detail.worktreePath}</span> is removed
							with it. One holding uncommitted work is kept instead, and nothing is deleted.
						</>
					) : (
						"The branch is removed from this repository. Commits only it points at become unreachable."
					)
				}
				confirmLabel="Delete branch"
				destructive
				confirmTestId="branch-delete-confirm"
				onConfirm={remove}
			>
				<PopoverTrigger asChild>
					<span>
						<IconTooltip label={reason ?? `Delete ${detail.branch}`}>
							<button
								type="button"
								data-testid="branch-delete"
								aria-label={`Delete ${detail.branch}`}
								disabled={reason !== null}
								className="flex size-20 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-feedback-error disabled:cursor-not-allowed disabled:text-control-disabled-text"
							>
								<Trash className="size-14" />
							</button>
						</IconTooltip>
					</span>
				</PopoverTrigger>
			</ConfirmPopover>
		</li>
	);
}

function RemoteRow({
	branchRef,
	branch,
	onSelect,
}: {
	branchRef: string;
	branch: string;
	onSelect: (ref: string) => void;
}) {
	return (
		<li data-testid="branch-remote-row" data-branch={branchRef}>
			<button
				type="button"
				data-testid="branch-remote-open"
				aria-label={`Start a workspace from ${branchRef}`}
				onClick={() => onSelect(branchRef)}
				className="flex w-full items-center gap-8 px-8 py-4 text-left hover:bg-control-bg-hovered"
			>
				<GitBranch className="size-14 shrink-0 text-text-subtle" />
				<span className="truncate tr-text-ui text-text-default">{branch}</span>
			</button>
		</li>
	);
}

function RemoteGroups({
	groups,
	onSelect,
}: {
	groups: RemoteBranchGroup[];
	onSelect: (ref: string) => void;
}) {
	const { isCollapsed, toggle } = useRemoteGroupCollapse();
	if (groups.length === 0) return null;
	return (
		<li>
			<p className="px-8 py-4 tr-text-eyebrow text-text-muted">Remote</p>
			<ul>
				{groups.map((group) => {
					const label = group.remote ?? "Other";
					const collapsed = isCollapsed(group.remote);
					return (
						<li
							key={group.remote === null ? "remote:null" : `remote:${group.remote}`}
							className="pl-8"
						>
							<div className="px-8 py-4">
								<RemoteGroupHeading
									label={label}
									collapsed={collapsed}
									onToggle={() => toggle(group.remote)}
								/>
							</div>
							{collapsed ? null : (
								<ul>
									{group.branches.map(({ ref, branch }) => (
										<RemoteRow key={ref} branchRef={ref} branch={branch} onSelect={onSelect} />
									))}
								</ul>
							)}
						</li>
					);
				})}
			</ul>
		</li>
	);
}

export function BranchList({ projectId, label }: { projectId: string; label: string }) {
	const [open, setOpen] = useState(false);
	const [branches, setBranches] = useState<BranchDetail[] | null>(null);
	const [remoteGroups, setRemoteGroups] = useState<RemoteBranchGroup[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [newWorkspaceBaseRef, setNewWorkspaceBaseRef] = useState<string | null>(null);
	const workspaces = useAppStore((s) => s.workspaces[projectId]);

	const load = useCallback(() => {
		setError(null);
		getTransport()
			.request("git.branchDetails", { projectId })
			.then((next) => {
				setBranches(next.branches);
				setRemoteGroups(next.remoteGroups ?? []);
			})
			.catch((cause) => setError(errorText(cause)));
	}, [projectId]);

	const [fetching, setFetching] = useState(false);
	const fetch = () => {
		setFetching(true);
		getTransport()
			.request("git.fetchRemotes", { projectId })
			.then(load)
			.catch((cause) => toast.error(errorText(cause), "Couldn't fetch"))
			.finally(() => setFetching(false));
	};

	useEffect(() => {
		if (open) load();
	}, [open, load, workspaces]);

	const openWorkspace = async (workspaceId: string) => {
		setOpen(false);
		const known = workspaces?.find((w) => w.id === workspaceId);
		if (known) {
			useAppStore.getState().activateWorkspace(known);
			return;
		}
		try {
			const rows = await getTransport().request("workspace.list", { projectId });
			const found = rows.find((w) => w.id === workspaceId);
			if (!found) return;
			useAppStore.getState().setWorkspaces(projectId, rows);
			useAppStore.getState().activateWorkspace(found);
		} catch (err) {
			toast.error(errorText(err), "Couldn't open the workspace");
		}
	};

	const openNewWorkspaceFrom = (ref: string) => {
		setOpen(false);
		setNewWorkspaceBaseRef(ref);
	};

	const onWorkspaceCreated = async (workspace: Workspace) => {
		const store = useAppStore.getState();
		store.setWorkspaces(
			workspace.projectId,
			await getTransport().request("workspace.list", { projectId: workspace.projectId }),
		);
		store.activateWorkspace(workspace);
	};

	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						data-testid="scope-branch"
						data-open={open}
						aria-label={`Branch ${label} — show this project's branches`}
						className="flex h-24 min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-4 text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected data-[open=true]:text-text-default"
					>
						<GitBranch className="size-14 shrink-0" />
						<span className="min-w-0 truncate">{label}</span>
						<ChevronDown className="size-16 shrink-0" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-320 p-0">
					<div className="flex items-center gap-8 border-border-default border-b px-8 py-4">
						<p className="min-w-0 flex-1 tr-text-eyebrow text-text-muted">Branches</p>
						<IconTooltip label={fetching ? "Fetching…" : "Fetch"}>
							<button
								type="button"
								data-testid="branch-fetch"
								aria-label="Fetch"
								disabled={fetching}
								onClick={fetch}
								className="flex size-20 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:cursor-progress disabled:text-control-disabled-text"
							>
								<Fetch className="size-14" />
							</button>
						</IconTooltip>
					</div>
					{error ? (
						<p data-testid="branch-list-error" className="px-8 py-4 tr-text-ui text-feedback-error">
							{error}
						</p>
					) : !branches ? (
						<p className="px-8 py-4 tr-text-ui text-text-muted">Reading branches…</p>
					) : (
						<ul data-testid="branch-list" className="max-h-320 overflow-auto py-2">
							{branches.length > 0 ? (
								<li>
									<p className="px-8 py-4 tr-text-eyebrow text-text-muted">Local</p>
									<ul>
										{branches.map((detail) => (
											<Row
												key={detail.branch}
												detail={detail}
												projectId={projectId}
												onDeleted={load}
												onOpenWorkspace={(workspaceId) => void openWorkspace(workspaceId)}
											/>
										))}
									</ul>
								</li>
							) : null}
							<RemoteGroups groups={remoteGroups} onSelect={openNewWorkspaceFrom} />
						</ul>
					)}
				</PopoverContent>
			</Popover>
			{newWorkspaceBaseRef !== null ? (
				<NewWorkspaceDialog
					open
					projectId={projectId}
					initialBaseRef={newWorkspaceBaseRef}
					onOpenChange={(nextOpen) => {
						if (!nextOpen) setNewWorkspaceBaseRef(null);
					}}
					onCreated={(workspace) => void onWorkspaceCreated(workspace)}
				/>
			) : null}
		</>
	);
}
