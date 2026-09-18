import { codexEnumValues } from "./configDocs";

export interface CodexLaunchOptions {
	permissionMode?: string | undefined;
	model?: string | undefined;
	systemPrompt?: string | undefined;
	initialPrompt?: string | undefined;
	resume?: { sessionId?: string | undefined } | undefined;
	mcp: boolean;
	windows: boolean;
	preset?: CodexLaunchPreset | undefined;
}

export interface CodexLaunchPreset {
	id: string;
	label: string;
	subcommand?: string;
	args?: string;
	model?: string;
}

export function shellQuote(word: string): string {
	return /^[\w./~+=:@%-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

function configArg(key: string, value: string): string {
	return `-c ${shellQuote(`${key}=${JSON.stringify(value)}`)}`;
}

export function codexLaunchLine(command: string, options: CodexLaunchOptions): string {
	const base = command.trim() || "codex";
	const parts = [base];
	if (options.resume)
		parts.push(
			"resume",
			options.resume.sessionId ? shellQuote(options.resume.sessionId) : "--last",
		);
	else if (options.preset?.subcommand) parts.push(options.preset.subcommand);
	if (options.mcp && !options.windows) {
		parts.push(`-c "mcp_servers.thinkrail.url=\\"$THINKRAIL_MCP_URL\\""`);
	}
	if (options.model) parts.push("--model", shellQuote(options.model));
	const permissions = CODEX_PERMISSION_MODES.find((mode) => mode.id === options.permissionMode);
	if (permissions?.args && !CODEX_PERMISSION_MODES.some((mode) => mode.id === options.preset?.id))
		parts.push(permissions.args);
	if (options.preset?.args) parts.push(options.preset.args);
	if (options.systemPrompt) parts.push(configArg("developer_instructions", options.systemPrompt));
	if (options.initialPrompt && !options.resume) parts.push(shellQuote(options.initialPrompt));
	return parts.join(" ");
}

export function codexLaunchMenu(
	enumValues: (key: string) => readonly string[] | undefined,
): readonly (readonly CodexLaunchPreset[])[] {
	return [
		[
			{ id: "resume-last", label: "Continue the last session", subcommand: "resume --last" },
			{ id: "resume", label: "Resume a session…", subcommand: "resume" },
			{ id: "fork", label: "Fork a session…", subcommand: "fork" },
		],
		(enumValues("sandbox_mode") ?? []).map((mode) => ({
			id: `sandbox-${mode}`,
			label: `Sandbox: ${mode}`,
			args: `-s ${mode}`,
		})),
		[
			{
				id: "full-auto",
				label: "Workspace write (approval on request)",
				args: "--sandbox workspace-write --ask-for-approval on-request",
			},
		],
		[{ id: "search", label: "With live web search", args: "--search" }],
	].filter((group) => group.length > 0);
}

export const CODEX_PERMISSION_MODES: readonly CodexLaunchPreset[] = [
	{ id: "default", label: "Use Codex configuration" },
	...codexLaunchMenu(codexEnumValues)
		.flat()
		.filter((preset) => preset.id.startsWith("sandbox-") || preset.id === "full-auto"),
];
