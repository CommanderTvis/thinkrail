import {
	RiArrowLeftDownLine as Fetch,
	RiGitBranchLine as GitBranch,
	RiDeleteBinLine as Trash,
} from "@remixicon/react";
import type { BranchDeleteResult, BranchDetail, RemoteBranchGroup } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { PopoverTrigger } from "@thinkrail/ui/popover";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useCallback, useEffect, useState } from "react";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConfirmPopover } from "./ConfirmPopover";
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
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	const [recovery, setRecovery] = useState<DirtyWorktreeRecovery | null>(null);
	const [forcePath, setForcePath] = useState<string | null>(null);
	const held = detail.workspaceId !== undefined;
	const foreign = !held && detail.worktreePath !== undefined;
	const reason = held
		? detail.workspaceName
			? t("panels.branchList.heldBy", { workspace: detail.workspaceName })
			: t("panels.branchList.heldByUnnamed")
		: detail.isCurrent
			? t("panels.branchList.checkedOutHere")
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
					<span className="shrink-0 tr-text-label-pill text-text-subtle uppercase">
						{t("panels.branchList.here")}
					</span>
				) : null}
				{detail.isDefault ? (
					<span className="shrink-0 tr-text-label-pill text-text-subtle uppercase">
						{t("panels.branchPicker.defaultBadge")}
					</span>
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
					aria-label={t("panels.branchList.openWorkspace", { branch: detail.branch })}
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
				title={t("panels.branchList.deleteFailed", { branch: detail.branch })}
				description={<span className="break-all">{recovery?.recovery.message}</span>}
				confirmLabel={t("panels.branchList.forceRemoveEllipsis")}
				destructive
				confirmTestId="branch-force-recovery"
				onConfirm={() => setForcePath(recovery?.recovery.worktreePath ?? null)}
			/>
			<ConfirmDialog
				open={forcePath !== null}
				onOpenChange={(open) => {
					if (!open) setForcePath(null);
				}}
				title={t("panels.branchList.forceRemoveTitle")}
				description={
					<T
						i18nKey="panels.branchList.forceRemoveDescription"
						values={{
							path: forcePath ?? t("panels.branchList.thisPath"),
							branch: detail.branch,
						}}
						components={[<span key="path" className="break-all" />]}
					/>
				}
				confirmLabel={t("panels.branchList.forceRemove")}
				destructive
				confirmTestId="branch-force-confirm"
				onConfirm={() => remove(true)}
			/>
			<ConfirmPopover
				open={confirming}
				onOpenChange={setConfirming}
				title={t("panels.branchList.deleteTitle", { branch: detail.branch })}
				description={
					foreign ? (
						<T
							i18nKey="panels.branchList.deleteForeignDescription"
							values={{ path: detail.worktreePath ?? "" }}
							components={[<span key="path" className="break-all" />]}
						/>
					) : (
						t("panels.branchList.deleteDescription")
					)
				}
				confirmLabel={t("panels.branchList.deleteBranch")}
				destructive
				confirmTestId="branch-delete-confirm"
				onConfirm={remove}
			>
				<PopoverTrigger asChild>
					<span>
						<IconButton
							variant="ghost"
							size="s"
							tone="danger"
							icon={Trash}
							label={t("panels.branchList.delete", { branch: detail.branch })}
							tooltip={reason ?? t("panels.branchList.delete", { branch: detail.branch })}
							wrapTrigger
							data-testid="branch-delete"
							disabled={reason !== null}
						/>
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
	const t = useT();
	return (
		<li data-testid="branch-remote-row" data-branch={branchRef}>
			<button
				type="button"
				data-testid="branch-remote-open"
				aria-label={t("panels.branchList.startFrom", { ref: branchRef })}
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
	const t = useT();
	const { isCollapsed, toggle } = useRemoteGroupCollapse();
	if (groups.length === 0) return null;
	return (
		<li>
			<p className="px-8 py-4 tr-text-eyebrow text-text-muted">{t("panels.branchPicker.remote")}</p>
			<ul>
				{groups.map((group) => {
					const label = group.remote ?? t("panels.branchPicker.otherRemote");
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

export function BranchList({
	projectId,
	open,
	onClose,
	onStartFrom,
}: {
	projectId: string;
	open: boolean;
	onClose: () => void;
	onStartFrom: (ref: string) => void;
}) {
	const t = useT();
	const [branches, setBranches] = useState<BranchDetail[] | null>(null);
	const [remoteGroups, setRemoteGroups] = useState<RemoteBranchGroup[]>([]);
	const [error, setError] = useState<string | null>(null);
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
		onClose();
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

	const startFrom = (ref: string) => {
		onClose();
		onStartFrom(ref);
	};

	return (
		<div className="mt-4 border-border-default border-t">
			<div className="flex items-center gap-8 border-border-default border-b px-8 py-4">
				<p className="min-w-0 flex-1 tr-text-eyebrow text-text-muted">
					{t("panels.branchList.title")}
				</p>
				<IconButton
					variant="ghost"
					size="s"
					icon={Fetch}
					label={t("panels.branchList.fetch")}
					tooltip={fetching ? t("panels.branchList.fetching") : t("panels.branchList.fetch")}
					data-testid="branch-fetch"
					disabled={fetching}
					onClick={fetch}
				/>
			</div>
			{error ? (
				<p data-testid="branch-list-error" className="px-8 py-4 tr-text-ui text-feedback-error">
					{error}
				</p>
			) : !branches ? (
				<p className="px-8 py-4 tr-text-ui text-text-muted">{t("panels.branchList.reading")}</p>
			) : (
				<ul data-testid="branch-list" className="max-h-320 overflow-auto py-2">
					{branches.length > 0 ? (
						<li>
							<p className="px-8 py-4 tr-text-eyebrow text-text-muted">
								{t("panels.branchPicker.local")}
							</p>
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
					<RemoteGroups groups={remoteGroups} onSelect={startFrom} />
				</ul>
			)}
		</div>
	);
}
