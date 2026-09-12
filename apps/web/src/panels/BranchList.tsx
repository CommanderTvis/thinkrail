import {
	RiArrowDownSLine as ChevronDown,
	RiGitBranchLine as GitBranch,
	RiDeleteBinLine as Trash,
} from "@remixicon/react";
import type { BranchDetail } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconTooltip } from "@/components/ui/tooltip";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmPopover } from "./ConfirmPopover";

function Row({
	detail,
	onDeleted,
	projectId,
}: {
	detail: BranchDetail;
	projectId: string;
	onDeleted: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const held = detail.workspaceId !== undefined;
	const foreign = !held && detail.worktreePath !== undefined;
	const reason = held
		? `${detail.workspaceName ?? "A workspace"} is living on this branch — remove the workspace first.`
		: detail.isCurrent
			? "This branch is checked out here."
			: null;

	const remove = () => {
		setConfirming(false);
		getTransport()
			.request("git.deleteBranch", { projectId, branch: detail.branch })
			.then(onDeleted)
			.catch((error) => toast.error(errorText(error), "Couldn't delete the branch"));
	};

	return (
		<li
			data-testid="branch-row"
			data-branch={detail.branch}
			data-held={held || undefined}
			className="flex items-start gap-8 px-8 py-4 hover:bg-control-bg-hovered"
		>
			<GitBranch className="mt-2 size-14 shrink-0 text-text-subtle" />
			<span className="flex min-w-0 flex-1 flex-col">
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
			</span>
			<ConfirmPopover
				open={confirming}
				onOpenChange={setConfirming}
				title={`Delete ${detail.branch}?`}
				description={
					foreign
						? `The worktree at ${detail.worktreePath} is removed with it. One holding uncommitted work is kept instead, and nothing is deleted.`
						: "The branch is removed from this repository. Commits only it points at become unreachable."
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

export function BranchList({ projectId, label }: { projectId: string; label: string }) {
	const [open, setOpen] = useState(false);
	const [branches, setBranches] = useState<BranchDetail[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const workspaces = useAppStore((s) => s.workspaces[projectId]);

	const load = useCallback(() => {
		setError(null);
		getTransport()
			.request("git.branchDetails", { projectId })
			.then((next) => setBranches(next.branches))
			.catch((cause) => setError(errorText(cause)));
	}, [projectId]);

	useEffect(() => {
		if (open) load();
	}, [open, load, workspaces]);

	return (
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
				<p className="border-border-default border-b px-8 py-4 tr-text-eyebrow text-text-muted">
					Branches
				</p>
				{error ? (
					<p data-testid="branch-list-error" className="px-8 py-4 tr-text-ui text-feedback-error">
						{error}
					</p>
				) : !branches ? (
					<p className="px-8 py-4 tr-text-ui text-text-muted">Reading branches…</p>
				) : (
					<ul data-testid="branch-list" className="max-h-320 overflow-auto py-2">
						{branches.map((detail) => (
							<Row key={detail.branch} detail={detail} projectId={projectId} onDeleted={load} />
						))}
					</ul>
				)}
			</PopoverContent>
		</Popover>
	);
}
