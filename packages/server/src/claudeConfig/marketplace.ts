import type { ClaudeMarketplaceAction } from "@thinkrail/contracts";
import { claudeBinary, runPluginCommand } from "./uninstall";

/** The exact argv for one of Claude's own `plugin marketplace` subcommands — shown before it runs. */
export function marketplaceCommand(
	claudeCommand: string,
	action: ClaudeMarketplaceAction,
): string[] {
	const base = [claudeBinary(claudeCommand), "plugin", "marketplace"];
	if (action.kind === "add") return [...base, "add", action.source, "--scope", action.scope];
	if (action.kind === "remove") return [...base, "remove", action.name, "--scope", action.scope];
	return [...base, "update", action.name];
}

export async function runMarketplaceAction(
	claudeCommand: string,
	action: ClaudeMarketplaceAction,
	cwd: string,
): Promise<{ output: string }> {
	const command = marketplaceCommand(claudeCommand, action);
	return { output: await runPluginCommand(command, cwd, `marketplace ${action.kind}`) };
}
