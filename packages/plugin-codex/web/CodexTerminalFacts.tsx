import type { PluginWebContext, TerminalAccessoryApi } from "@thinkrail/plugin-api/web";
import { attachPath, TerminalAttachButton } from "@thinkrail/plugin-ui";
import type { codexContract } from "../contracts";
import { createCodexSubscriptionNotice } from "./CodexSubscriptionNotice";
import { useCodexStore } from "./store";

export function createCodexTerminalFacts(ctx: PluginWebContext<typeof codexContract>) {
	const CodexSubscriptionNotice = createCodexSubscriptionNotice(ctx);
	return function CodexTerminalFacts({ terminal }: { terminal: TerminalAccessoryApi }) {
		const isCodex = ctx.useHost(
			(host) =>
				host.terminals[terminal.workspaceId]?.find(
					(candidate) => candidate.tabKey === terminal.tabKey,
				)?.agent?.kind === "codex",
		);
		const worktreePath = ctx.useHost(
			(host) =>
				Object.values(host.workspaces)
					.flat()
					.find((workspace) => workspace.id === terminal.workspaceId)?.worktreePath,
		);
		const cwd = useCodexStore((s) => s.byWorkspace[terminal.workspaceId]?.[terminal.tabKey]?.cwd);
		if (!isCodex) return null;

		return (
			<div
				data-testid="terminal-agent-facts"
				className="flex min-w-0 flex-1 flex-wrap items-center gap-4"
			>
				<TerminalAttachButton
					title="Put a file or folder's path in front of Codex"
					pickFile={() => ctx.pickFile()}
					onAttach={(path) => terminal.write(`${attachPath(path, worktreePath, cwd)} `)}
					onError={(cause) =>
						ctx.notify(
							"error",
							"Couldn't open the file picker",
							cause instanceof Error ? cause.message : String(cause),
						)
					}
				/>
				<CodexSubscriptionNotice key={terminal.tabKey} terminal={terminal} />
			</div>
		);
	};
}
