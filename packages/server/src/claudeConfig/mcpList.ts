import type { ClaudeCapability } from "@thinkrail/contracts";
import { runBounded } from "../subprocess";
import { claudeStatePath } from "./paths";
import { claudeBinary } from "./uninstall";

const TIMEOUT_MS = 60_000;

export type McpListStatus =
	| "connected"
	| "disabled"
	| "failed"
	| "needs-auth"
	| "pending"
	| "unknown";

export interface McpListEntry {
	name: string;
	target: string;
	status: McpListStatus;
	statusText: string;
}

const STATUS_GLYPHS: readonly [string, McpListStatus][] = [
	["✔", "connected"],
	["⊘", "disabled"],
	["✘", "failed"],
	["!", "needs-auth"],
	["⏸", "pending"],
];

/**
 * `claude mcp list` prints one server per line as `<name>: <target> - <glyph> <status>`; the name may
 * contain spaces ("claude.ai Uber Eats"), so it ends at the first `: ` and the status starts at the last
 * ` - `. Anything else on stdout (the health-check banner) is skipped. See SPEC.md.
 */
export function parseMcpList(output: string): McpListEntry[] {
	const entries: McpListEntry[] = [];
	for (const raw of output.split("\n")) {
		const line = raw.trim();
		const colon = line.indexOf(": ");
		const dash = line.lastIndexOf(" - ");
		if (colon <= 0 || dash <= colon) continue;
		const name = line.slice(0, colon).trim();
		const target = line.slice(colon + 2, dash).trim();
		const statusText = line.slice(dash + 3).trim();
		const status = STATUS_GLYPHS.find(([glyph]) => statusText.startsWith(glyph))?.[1] ?? "unknown";
		entries.push({ name, target, status, statusText });
	}
	return entries;
}

export async function listClaudeMcpServers(
	claudeCommand: string,
	cwd: string,
	env: Record<string, string | undefined>,
): Promise<McpListEntry[]> {
	const run = await runBounded([claudeBinary(claudeCommand), "mcp", "list"], {
		timeoutMs: TIMEOUT_MS,
		cwd,
		env,
	});
	if (run.launchFailed)
		throw new Error(`Could not run ${claudeBinary(claudeCommand)}: ${run.err.trim()}`);
	if (run.timedOut) throw new Error("claude mcp list did not finish within a minute.");
	if (!run.ok) throw new Error(run.err.trim() || run.out.trim() || "claude mcp list failed.");
	return parseMcpList(run.out);
}

/**
 * The servers Claude reaches that no file in the worktree declares: claude.ai connectors and plugin
 * servers. They wear the `user` scope with no path, which is what tells the pane there is nothing to
 * edit; a server `/mcp` disabled for this project says so through `disabledBy`, pointing at the
 * `disabledMcpServers` list in `~/.claude.json` that `/mcp` writes.
 */
export function mcpListCapabilities(
	entries: readonly McpListEntry[],
	declared: ReadonlySet<string>,
	root: string,
): ClaudeCapability[] {
	return entries
		.filter((entry) => !declared.has(entry.name))
		.map((entry) => ({
			kind: "mcp",
			name: entry.name,
			origin: { scope: "user", path: null },
			enabled: entry.status !== "disabled",
			detail: `${entry.target} · ${entry.statusText}`,
			...(entry.status === "disabled"
				? {
						disabledBy: {
							scope: "local" as const,
							path: claudeStatePath(),
							keyPath: ["projects", root, "disabledMcpServers"],
						},
					}
				: {}),
		}));
}
