import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	ToggleSegment,
} from "@thinkrail/plugin-ui";
import { useEffect, useMemo, useState } from "react";
import type {
	ClaudeMarketplaceAction,
	ClaudeWritableScope,
	claudeCodeContract,
} from "../contracts";
import { CLAUDE_WRITABLE_SCOPES } from "../webValues";
import { errorText } from "./errorText";

const WORDING: Record<ClaudeMarketplaceAction["kind"], string> = {
	add: "Claude Code fetches the catalog and declares it in the chosen scope's settings.",
	remove: "Claude Code removes the declaration; plugins installed from it stay until uninstalled.",
	update: "Claude Code refreshes the catalog from its source.",
};

/**
 * Approve a `claude plugin marketplace` command before it runs — the same show-the-argv contract as the
 * plugin uninstall and move dialogs. Adding also composes the source and scope. See panels/SPEC.md.
 */
export function createClaudeMarketplaceDialog(ctx: PluginWebContext<typeof claudeCodeContract>) {
	return function ClaudeMarketplaceDialog({
		workspaceId,
		target,
		onClose,
		onDone,
	}: {
		workspaceId: string;
		target: ClaudeMarketplaceAction | null;
		onClose: () => void;
		onDone: () => void;
	}) {
		const [source, setSource] = useState("");
		const [scope, setScope] = useState<ClaudeWritableScope>("user");
		const [command, setCommand] = useState<string[] | null>(null);
		const [running, setRunning] = useState(false);
		const [error, setError] = useState<string | null>(null);

		const action: ClaudeMarketplaceAction | null = useMemo(
			() =>
				target === null
					? null
					: target.kind === "add"
						? { kind: "add", source: source.trim(), scope }
						: target,
			[target, source, scope],
		);
		const ready = action !== null && (action.kind !== "add" || action.source !== "");

		useEffect(() => {
			if (!ready || action === null) {
				setCommand(null);
				return;
			}
			let cancelled = false;
			ctx
				.request("marketplacePlan", { workspaceId, action })
				.then((plan) => {
					if (!cancelled) setCommand(plan.command);
				})
				.catch((cause: unknown) => {
					if (!cancelled) setError(errorText(cause));
				});
			return () => {
				cancelled = true;
			};
		}, [ready, workspaceId, action]);

		const run = async () => {
			if (!ready || action === null) return;
			setRunning(true);
			setError(null);
			try {
				await ctx.request("marketplaceRun", { workspaceId, action });
				onDone();
				onClose();
			} catch (cause) {
				setError(errorText(cause));
			} finally {
				setRunning(false);
			}
		};

		const title =
			target?.kind === "add"
				? "Add a marketplace"
				: target?.kind === "remove"
					? `Remove ${target.name}`
					: `Update ${target?.name ?? ""}`;

		return (
			<Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
				<DialogContent
					data-testid="claude-marketplace-dialog"
					className="w-fit min-w-[560px] max-w-[90vw]"
				>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{target ? WORDING[target.kind] : ""}</DialogDescription>
					</DialogHeader>

					{target?.kind === "add" ? (
						<div className="flex flex-col gap-8">
							<label className="flex flex-col gap-4">
								<span className="tr-text-metadata text-text-muted">
									URL, path, or GitHub owner/repo
								</span>
								<input
									value={source}
									onChange={(event) => setSource(event.target.value)}
									spellCheck={false}
									autoFocus
									data-testid="claude-marketplace-source"
									placeholder="anthropics/claude-plugins-official"
									className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-subtle focus:border-primary"
								/>
							</label>
							<div className="flex items-center gap-8">
								{CLAUDE_WRITABLE_SCOPES.map((candidate) => (
									<ToggleSegment
										key={candidate}
										testid={`claude-marketplace-scope-${candidate}`}
										label={candidate}
										active={scope === candidate}
										onClick={() => setScope(candidate)}
									/>
								))}
							</div>
						</div>
					) : null}

					<pre
						data-testid="claude-marketplace-command"
						className="w-max max-w-full overflow-x-auto rounded-[var(--radius-sm)] bg-container-elevated-bg p-8 tr-code-text text-text-default"
					>
						{command ? `$ ${command.join(" ")}` : "Composing…"}
					</pre>

					{error ? (
						<p
							data-testid="claude-marketplace-error"
							className="tr-text-metadata text-feedback-error"
						>
							{error}
						</p>
					) : null}

					<div className="flex items-center justify-end gap-8">
						<Button variant="outline" onClick={onClose} disabled={running}>
							Cancel
						</Button>
						<Button
							data-testid="claude-marketplace-run"
							onClick={run}
							disabled={running || !command}
						>
							{running ? "Running…" : "Run it"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		);
	};
}
