import type { ClaudeWritableScope } from "@thinkrail/contracts";
import { runBounded } from "../subprocess";

const TIMEOUT_MS = 60_000;

/**
 * The launcher's command line is a whole interactive invocation; a subcommand run takes the program from
 * it and nothing else, so a user's own flags cannot ride along. See SPEC.md.
 */
export function claudeBinary(claudeCommand: string): string {
	const [program] = claudeCommand.trim().split(/\s+/);
	return program || "claude";
}

/** The exact argv, so what the reader approves in the dialog is what the host runs. */
export function pluginUninstallCommand(
	claudeCommand: string,
	name: string,
	scope: ClaudeWritableScope,
): string[] {
	return [claudeBinary(claudeCommand), "plugin", "uninstall", name, "--scope", scope, "--yes"];
}

function pluginInstallCommand(
	claudeCommand: string,
	name: string,
	scope: ClaudeWritableScope,
): string[] {
	return [claudeBinary(claudeCommand), "plugin", "install", name, "--scope", scope, "--yes"];
}

/** A move is two of Claude's own commands: enabled at the target scope first, then gone from the old. */
export function pluginMoveCommands(
	claudeCommand: string,
	name: string,
	from: ClaudeWritableScope,
	to: ClaudeWritableScope,
): string[][] {
	return [
		pluginInstallCommand(claudeCommand, name, to),
		pluginUninstallCommand(claudeCommand, name, from),
	];
}

export async function runPluginCommand(
	command: string[],
	cwd: string,
	what: string,
): Promise<string> {
	const run = await runBounded(command, { timeoutMs: TIMEOUT_MS, cwd });
	if (run.launchFailed) throw new Error(`Could not run ${command[0]}: ${run.err.trim()}`);
	if (run.timedOut) throw new Error(`${command[0]} did not finish within a minute.`);
	if (!run.ok) throw new Error(run.err.trim() || run.out.trim() || `The ${what} failed.`);
	return run.out.trim() || run.err.trim();
}

export async function uninstallClaudePlugin(
	claudeCommand: string,
	name: string,
	scope: ClaudeWritableScope,
	cwd: string,
): Promise<{ output: string }> {
	const command = pluginUninstallCommand(claudeCommand, name, scope);
	return { output: await runPluginCommand(command, cwd, "uninstall") };
}

export async function moveClaudePlugin(
	claudeCommand: string,
	name: string,
	from: ClaudeWritableScope,
	to: ClaudeWritableScope,
	cwd: string,
): Promise<{ output: string }> {
	const [install, uninstall] = pluginMoveCommands(claudeCommand, name, from, to);
	if (!install || !uninstall) throw new Error("The move composed no commands.");
	const installed = await runPluginCommand(install, cwd, "install");
	let removed: string;
	try {
		removed = await runPluginCommand(uninstall, cwd, "uninstall");
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		throw new Error(
			`Installed at ${to}, but removing the ${from} copy failed — the plugin is now in both scopes. ${reason}`,
		);
	}
	return { output: [installed, removed].filter(Boolean).join("\n") };
}
