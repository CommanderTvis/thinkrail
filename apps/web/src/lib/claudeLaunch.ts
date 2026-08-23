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
	],
	CLAUDE_MODELS.map((model) => ({
		id: `model-${model.id}`,
		label: model.label,
		args: `--model ${model.id}`,
	})),
];

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
