import type { AgentCatalogEntry } from "@thinkrail/acp";

export const DEFAULT_PORT = 24242;
export const DEFAULT_HOST = "localhost";

export interface CliOptions {
	port: number;
	host: string;
	open: boolean;
	noAnalytics: boolean;
	verbose: boolean;
	staticDir: string | undefined;
	projectDir: string | undefined;
	help: boolean;
	version: boolean;
}

export type ParseEnv = Record<string, string | undefined>;

const SUBCOMMANDS = ["acp-pi", "agent", "update", "uninstall"] as const;

export type Subcommand = (typeof SUBCOMMANDS)[number];

export function parseSubcommand(argv: readonly string[]): Subcommand | undefined {
	return SUBCOMMANDS.find((name) => name === argv[0]);
}

export const USAGE = `Usage: thinkrail [options] [project-dir]
       thinkrail agent list | add <id> [--name <n>] -- <command> [args...] | remove <id>
       thinkrail update [--channel stable|nightly] [--version X.Y.Z]
       thinkrail uninstall [--remove-data|--keep-data] [-y]

Boots the ThinkRail engine host and opens the browser to the app.
The \`agent\` subcommand points ThinkRail at an ACP agent already installed on this
machine; the bundled pi agent needs no entry and is used when nothing else is selected.
\`update\` re-downloads + installs the latest build for your channel; \`uninstall\` removes
ThinkRail from this machine (your ~/.thinkrail app state is kept unless you ask for it to
go). All three take \`--help\`.

This binary is also the bundled agent: \`thinkrail acp-pi\` runs ThinkRail's pi agent on
stdio, speaking ACP. The host spawns it for you — there is no reason to run it by hand.

Options:
  --port <n>     Listen port (default ${DEFAULT_PORT}; falls back to a free port if taken).
  --host <h>     Bind host (default ${DEFAULT_HOST}).
  --no-open      Don't open the browser (e.g. headless / remote host).
  --no-analytics Don't send anonymous usage analytics this run (the durable switch
                 lives in the app: Settings → Privacy).
  --verbose      Debug-level logging (terminal + the rotated log files under
                 ~/.thinkrail/logs).
  -v, --version  Print the version and exit.
  -h, --help     Show this help.

Arguments:
  project-dir    A git repo to open as a project on launch (optional).

Env:
  THINKRAIL_PORT / THINKRAIL_HOST   Defaults for --port / --host.
  THINKRAIL_STATIC_DIR                 Override the built web app served by the host.
  THINKRAIL_NO_ANALYTICS               Same as --no-analytics (any non-empty value; read by the host).
  THINKRAIL_LOG_LEVEL                  Log level: debug|info|warn|error (default info; read by the host).`;

export const AGENT_USAGE = `Usage: thinkrail agent list
       thinkrail agent add <id> [--name <name>] -- <command> [args...]
       thinkrail agent remove <id>

Points ThinkRail at an ACP agent already installed on this machine. Entries are written to
~/.thinkrail/agents and appear in the app's agent picker, where a project can be pointed at
one; the bundled pi agent needs no entry and is used when nothing else is selected.

Everything after \`--\` is the launch command, spawned as-is with the host's login-shell PATH.

Examples:
  thinkrail agent add junie --name "JetBrains Junie" -- bunx @jetbrains/junie --acp=true
  thinkrail agent remove junie`;

export type AgentCommand =
	| { kind: "help" }
	| { kind: "list" }
	| { kind: "add"; entry: AgentCatalogEntry }
	| { kind: "remove"; agentId: string };

function readFlagValue(arg: string, next: string | undefined): { value: string; consumed: number } {
	const eq = arg.indexOf("=");
	if (eq !== -1) return { value: arg.slice(eq + 1), consumed: 1 };
	if (next === undefined) throw new Error(`Missing value for ${arg}`);
	return { value: next, consumed: 2 };
}

export function parseAgentArgs(argv: readonly string[]): AgentCommand {
	const [verb, ...rest] = argv;
	if (verb === undefined || verb === "-h" || verb === "--help") return { kind: "help" };
	if (verb === "list") {
		if (rest.length > 0) throw new Error(`Unexpected argument: ${rest[0]}`);
		return { kind: "list" };
	}
	if (verb === "remove") {
		const [agentId, ...extra] = rest;
		if (agentId === undefined) throw new Error("Missing the agent id.");
		if (extra.length > 0) throw new Error(`Unexpected argument: ${extra[0]}`);
		return { kind: "remove", agentId };
	}
	if (verb === "add") return { kind: "add", entry: parseAgentEntry(rest) };
	throw new Error(`Unknown agent command: ${verb}`);
}

function parseAgentEntry(argv: readonly string[]): AgentCatalogEntry {
	const separator = argv.indexOf("--");
	if (separator === -1) throw new Error("Missing `--` before the agent's launch command.");
	const [command, ...args] = argv.slice(separator + 1);
	if (command === undefined) throw new Error("Missing the agent's launch command after `--`.");

	const head = argv.slice(0, separator);
	let id: string | undefined;
	let name: string | undefined;
	for (let i = 0; i < head.length; i += 1) {
		const arg = head[i] as string;
		if (arg === "--name" || arg.startsWith("--name=")) {
			const { value, consumed } = readFlagValue(arg, head[i + 1]);
			name = value;
			i += consumed - 1;
		} else if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		} else if (id === undefined) {
			id = arg;
		} else {
			throw new Error(`Unexpected argument: ${arg}`);
		}
	}
	if (id === undefined) throw new Error("Missing the agent id.");

	return { id, name: name ?? id, origin: "external", launch: { command, args } };
}

export function parseArgs(argv: readonly string[], env: ParseEnv = {}): CliOptions {
	let port: number | undefined;
	let host: string | undefined;
	let open = true;
	let noAnalytics = false;
	let verbose = false;
	let help = false;
	let version = false;
	let projectDir: string | undefined;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] as string;
		if (arg === "--no-open") {
			open = false;
		} else if (arg === "--no-analytics") {
			noAnalytics = true;
		} else if (arg === "--verbose") {
			verbose = true;
		} else if (arg === "-h" || arg === "--help") {
			help = true;
		} else if (arg === "-v" || arg === "--version") {
			version = true;
		} else if (arg === "--port" || arg.startsWith("--port=")) {
			const { value, consumed } = readFlagValue(arg, argv[i + 1]);
			const parsed = Number(value);
			if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
				throw new Error(`Invalid --port: ${value}`);
			}
			port = parsed;
			i += consumed - 1;
		} else if (arg === "--host" || arg.startsWith("--host=")) {
			const { value, consumed } = readFlagValue(arg, argv[i + 1]);
			host = value;
			i += consumed - 1;
		} else if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		} else if (projectDir === undefined) {
			projectDir = arg;
		} else {
			throw new Error(`Unexpected argument: ${arg}`);
		}
	}

	const envPort = env.THINKRAIL_PORT !== undefined ? Number(env.THINKRAIL_PORT) : undefined;
	const resolvedPort =
		port ?? (envPort !== undefined && Number.isInteger(envPort) ? envPort : DEFAULT_PORT);

	return {
		port: resolvedPort,
		host: host ?? env.THINKRAIL_HOST ?? DEFAULT_HOST,
		open,
		noAnalytics,
		verbose,
		staticDir: env.THINKRAIL_STATIC_DIR,
		projectDir,
		help,
		version,
	};
}
