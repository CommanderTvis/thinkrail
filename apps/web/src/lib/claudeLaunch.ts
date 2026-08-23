export interface ClaudeLaunchPreset {
	id: string;
	label: string;
	args: string;
}

/**
 * The launcher's context menu, in groups the UI renders separated. Each entry is the tail of a `claude`
 * command line, taken from the published CLI reference — see lib/SPEC.md for what belongs here.
 */
/** The model aliases the `claude` CLI accepts, one list for the launcher and the running session. */
export const CLAUDE_MODELS: readonly { id: string; label: string }[] = [
	{ id: "opus", label: "Opus" },
	{ id: "fable", label: "Fable" },
	{ id: "sonnet", label: "Sonnet" },
	{ id: "haiku", label: "Haiku" },
];

export const CLAUDE_LAUNCH_MENU: readonly (readonly ClaudeLaunchPreset[])[] = [
	[
		{ id: "continue", label: "Continue the last conversation", args: "--continue" },
		{ id: "resume", label: "Resume a session…", args: "--resume" },
		{ id: "resume-fork", label: "Resume as a new session", args: "--resume --fork-session" },
		{ id: "teleport", label: "Teleport a session here…", args: "--teleport" },
	],
	CLAUDE_MODELS.map((model) => ({
		id: `model-${model.id}`,
		label: model.label,
		args: `--model ${model.id}`,
	})),
];

/** Claude Code's own background-agent view, which ThinkRail's own session management replaces. */
export const CLAUDE_AGENT_VIEW_ENV = "CLAUDE_CODE_DISABLE_AGENT_VIEW";

export interface ClaudeLaunchShell {
	platform?: string | undefined;
	windowsShell?: string | undefined;
}

/**
 * One variable, set for this command only, in the syntax of the shell that will read it — see
 * lib/SPEC.md. A POSIX prefix typed into `cmd` is a command not found, not a variable.
 */
export function withLaunchEnv(line: string, shell: ClaudeLaunchShell = {}): string {
	if (!line) return line;
	const windows = (shell.platform ?? "").toLowerCase().startsWith("win");
	if (!windows) return `${CLAUDE_AGENT_VIEW_ENV}=true ${line}`;
	return shell.windowsShell === "cmd"
		? `set "${CLAUDE_AGENT_VIEW_ENV}=true" && ${line}`
		: `$env:${CLAUDE_AGENT_VIEW_ENV}='true'; ${line}`;
}

export function claudeLaunchCommand(command: string, args = ""): string {
	const base = command.trim();
	const tail = args.trim();
	if (!base) return "";
	return tail ? `${base} ${tail}` : base;
}

/**
 * Turns a picked path into something a shell runs as one word. The setting is a command *line*, so a path
 * with a space in it has to arrive already quoted or it reads as a command plus an argument.
 */
export function shellQuotePath(path: string): string {
	return /^[\w./~+=:@%-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
}
