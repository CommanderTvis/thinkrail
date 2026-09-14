import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/plugin-ui";
import { useEffect, useState } from "react";
import type { ClaudeWritableScope, claudeCodeContract } from "../contracts";
import { errorText } from "./errorText";

export interface PluginUninstall {
	name: string;
	scope: ClaudeWritableScope;
}

/**
 * Approve a command before it runs, the way the edit dialog approves a diff before it is written: the
 * host composes the argv and this shows that exact line. See panels/SPEC.md.
 */
export function createClaudePluginUninstallDialog(
	ctx: PluginWebContext<typeof claudeCodeContract>,
) {
	return function ClaudePluginUninstallDialog({
		workspaceId,
		target,
		onClose,
		onDone,
	}: {
		workspaceId: string;
		target: PluginUninstall | null;
		onClose: () => void;
		onDone: () => void;
	}) {
		const [command, setCommand] = useState<string[] | null>(null);
		const [running, setRunning] = useState(false);
		const [error, setError] = useState<string | null>(null);

		useEffect(() => {
			if (!target) return;
			let cancelled = false;
			ctx
				.request("pluginUninstallPlan", { workspaceId, name: target.name, scope: target.scope })
				.then((plan) => {
					if (!cancelled) setCommand(plan.command);
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
				await ctx.request("pluginUninstall", {
					workspaceId,
					name: target.name,
					scope: target.scope,
				});
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
				<DialogContent
					data-testid="claude-uninstall-dialog"
					className="w-fit min-w-[560px] max-w-[90vw]"
				>
					<DialogHeader>
						<DialogTitle>Uninstall {target?.name}</DialogTitle>
						<DialogDescription>
							Claude Code removes the plugin from your {target?.scope} settings, its install record
							and the files it downloaded. Reinstalling it means adding it from its marketplace
							again.
						</DialogDescription>
					</DialogHeader>

					<pre
						data-testid="claude-uninstall-command"
						className="w-max max-w-full overflow-x-auto rounded-[var(--radius-sm)] bg-container-elevated-bg p-8 tr-code-text text-text-default"
					>
						{command ? `$ ${command.join(" ")}` : "Composing the command…"}
					</pre>

					{error ? (
						<p
							data-testid="claude-uninstall-error"
							className="tr-text-metadata text-feedback-error"
						>
							{error}
						</p>
					) : null}

					<div className="flex justify-end gap-8">
						<Button variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button
							data-testid="claude-uninstall-run"
							disabled={command === null || running}
							onClick={() => void run()}
						>
							{running ? "Uninstalling…" : "Run it"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		);
	};
}
