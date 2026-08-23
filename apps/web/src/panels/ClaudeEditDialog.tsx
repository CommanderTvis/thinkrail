import { RiAlertLine as AlertTriangle } from "@remixicon/react";
import type {
	ClaudeDiffLine,
	ClaudeEdit,
	ClaudeEditPlan,
	ClaudeWritableScope,
} from "@thinkrail/contracts";
import { CLAUDE_SCOPE_WORDING, claudeEditScopes } from "@thinkrail/contracts";
import { useCallback, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { abbreviateHomePath } from "../lib";
import { toast } from "../store";
import { errorText, getTransport } from "../transport";

/** Position is part of the identity: a diff repeats lines by nature, so text alone is not unique. */
function diffRows(plan: ClaudeEditPlan): { id: string; line: ClaudeDiffLine }[] {
	return plan.diff.map((line, index) => ({ id: `${index}:${line.kind}:${line.text}`, line }));
}

const SCOPE_LABEL: Record<ClaudeWritableScope, string> = {
	user: "Your settings",
	project: "Project settings",
	local: "Project settings, private",
};

/**
 * Approve a configuration change as a diff before it is written.
 *
 * Two things the tool this replaces never does: name the file the change lands in, in words rather than a
 * path, and show what the edit removes. A generated edit that silently drops a key is the failure this
 * whole step exists to catch — see claudeConfig/SPEC.md.
 */
export function ClaudeEditDialog({
	workspaceId,
	edit,
	title,
	onClose,
	onApplied,
}: {
	workspaceId: string;
	edit: ClaudeEdit | null;
	title: string;
	onClose: () => void;
	onApplied: () => void;
}) {
	// Nothing is preselected: guessing the scope is what makes a change land somewhere unexpected. The
	// caller remounts this per edit (see its `key`), so every edit starts from here rather than inheriting
	// the previous one's scope and diff.
	const [scope, setScope] = useState<ClaudeWritableScope | null>(null);
	const [plan, setPlan] = useState<ClaudeEditPlan | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// A change that only one file can hold still asks: the click is the choice.
	const scopes = edit ? claudeEditScopes(edit) : [];

	const choose = useCallback(
		(next: ClaudeWritableScope) => {
			if (!edit) return;
			setScope(next);
			setPlan(null);
			setError(null);
			void getTransport()
				.request("claudeConfig.planEdit", { workspaceId, scope: next, edit })
				.then(setPlan)
				.catch((cause: unknown) => setError(errorText(cause)));
		},
		[edit, workspaceId],
	);

	const apply = () => {
		if (!edit || !scope || !plan) return;
		setBusy(true);
		void getTransport()
			.request("claudeConfig.applyEdit", { workspaceId, scope, edit, baseHash: plan.baseHash })
			.then(() => {
				toast.success("Configuration updated");
				onApplied();
				onClose();
			})
			.catch((cause: unknown) => setError(errorText(cause)))
			.finally(() => setBusy(false));
	};

	return (
		<Dialog open={edit !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent className="flex max-h-[80vh] w-full max-w-[44rem] flex-col gap-sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-xs">
					<p className="tr-text-metadata text-text-muted">Where should this change go?</p>
					{scopes.map((candidate) => (
						<button
							key={candidate}
							type="button"
							data-testid={`claude-edit-scope-${candidate}`}
							aria-pressed={scope === candidate}
							onClick={() => choose(candidate)}
							className={`flex flex-col items-start gap-0.5 rounded-[var(--radius-sm)] border px-md py-sm text-left tr-text-ui ${
								scope === candidate
									? "border-primary-muted bg-primary-subtle text-text-default"
									: "border-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
							}`}
						>
							<span>{SCOPE_LABEL[candidate]}</span>
							<span className="tr-text-metadata text-text-subtle">
								Affects {CLAUDE_SCOPE_WORDING[candidate]}
							</span>
						</button>
					))}
				</div>

				{error ? (
					<p data-testid="claude-edit-error" className="tr-text-ui text-feedback-error">
						{error}
					</p>
				) : null}

				{plan ? (
					<div className="flex min-h-0 flex-1 flex-col gap-xs">
						<p className="tr-text-ui text-text-default">{plan.summary}</p>
						<p className="tr-code-text text-text-muted">
							{abbreviateHomePath(plan.path)}
							{plan.exists ? "" : " (will be created)"}
						</p>
						{plan.warnings.map((warning) => (
							<p
								key={warning}
								data-testid="claude-edit-warning"
								className="flex items-start gap-xs tr-text-metadata text-feedback-warning"
							>
								<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
								<span className="min-w-0 flex-1">{warning}</span>
							</p>
						))}
						{plan.changes ? (
							<div
								data-testid="claude-edit-diff"
								className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-sm)] border border-border-default bg-container-content-bg"
							>
								{diffRows(plan).map(({ id, line }) => (
									<div
										key={id}
										data-kind={line.kind}
										className={`whitespace-pre-wrap break-all px-sm tr-code-text ${
											line.kind === "add"
												? "bg-feedback-success-subtle text-feedback-success"
												: line.kind === "remove"
													? "bg-feedback-error-subtle text-feedback-error"
													: line.kind === "gap"
														? "border-border-muted border-y bg-container-elevated-bg text-center text-text-subtle"
														: "text-text-muted"
										}`}
									>
										{line.kind === "gap"
											? `⋯ ${line.text} ⋯`
											: `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "} ${line.text}`}
									</div>
								))}
							</div>
						) : (
							<p className="tr-text-ui text-text-muted">
								That file already says this — nothing to change.
							</p>
						)}
					</div>
				) : null}

				<div className="flex shrink-0 items-center justify-end gap-sm">
					<button
						type="button"
						onClick={onClose}
						className="rounded-[var(--radius-sm)] border border-border-default px-md py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered"
					>
						Cancel
					</button>
					<button
						type="button"
						data-testid="claude-edit-apply"
						disabled={!plan?.changes || busy}
						onClick={apply}
						className="rounded-[var(--radius-sm)] bg-control-primary-bg px-md py-xs tr-text-ui text-control-primary-text hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
					>
						Apply this change
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
