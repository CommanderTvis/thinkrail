import type { ClaudeWritableScope } from "@thinkrail/contracts";
import { CLAUDE_PLUGIN_SCOPE_WORDING } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { errorText, getTransport } from "@/transport";

export interface PluginMove {
	name: string;
	from: ClaudeWritableScope;
	to: ClaudeWritableScope;
}

/**
 * Approve the commands before they run, exactly like the uninstall dialog: a move is Claude's own
 * install at the target scope, then its uninstall at the old one — both shown verbatim. See panels/SPEC.md.
 */
export function ClaudePluginMoveDialog({
	workspaceId,
	target,
	onClose,
	onDone,
}: {
	workspaceId: string;
	target: PluginMove | null;
	onClose: () => void;
	onDone: () => void;
}) {
	const [commands, setCommands] = useState<string[][] | null>(null);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!target) return;
		let cancelled = false;
		getTransport()
			.request("claudeConfig.pluginMovePlan", { workspaceId, ...target })
			.then((plan) => {
				if (!cancelled) setCommands(plan.commands);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(errorText(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [target, workspaceId]);

	const run = async () => {
		if (!target) return;
		setRunning(true);
		setError(null);
		try {
			await getTransport().request("claudeConfig.pluginMove", { workspaceId, ...target });
			onDone();
			onClose();
		} catch (cause) {
			setError(errorText(cause));
		} finally {
			setRunning(false);
		}
	};

	return (
		<Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent data-testid="claude-move-dialog" className="w-fit min-w-[560px] max-w-[90vw]">
				<DialogHeader>
					<DialogTitle>
						Move {target?.name} to {target?.to}
					</DialogTitle>
					<DialogDescription>
						The plugin becomes installed {target ? CLAUDE_PLUGIN_SCOPE_WORDING[target.to] : ""}, and
						the {target?.from}-scope copy is removed. Two of Claude Code's own commands, in this
						order:
					</DialogDescription>
				</DialogHeader>

				<pre
					data-testid="claude-move-commands"
					className="w-max max-w-full overflow-x-auto rounded-[var(--radius-sm)] bg-container-elevated-bg p-8 tr-code-text text-text-default"
				>
					{commands ? commands.map((command) => `$ ${command.join(" ")}`).join("\n") : "Composing…"}
				</pre>

				{error ? (
					<p data-testid="claude-move-error" className="tr-text-metadata text-feedback-error">
						{error}
					</p>
				) : null}

				<div className="flex items-center justify-end gap-8">
					<Button variant="outline" onClick={onClose} disabled={running}>
						Cancel
					</Button>
					<Button data-testid="claude-move-run" onClick={run} disabled={running || !commands}>
						{running ? "Moving…" : "Run both"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
