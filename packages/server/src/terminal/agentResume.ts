import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RESUME_FLAGS = new Set(["--resume", "-r"]);
const CONTINUE_FLAGS = new Set(["--continue", "-c"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAgentSessionId(value: string): boolean {
	return UUID_RE.test(value);
}

/**
 * Rebuild the invocation that started an agent so it resumes a session instead of starting one.
 *
 * The recorded command is whatever the user actually typed, so it may already carry its own
 * `--resume <id>` from a previous restore, or a `--continue`. Both are dropped rather than appended to:
 * `claude --resume a --resume b` is not a command anyone meant to run, and a stale id is worse than none.
 * Everything else the user chose (`--chrome`, a model, a permission mode) is preserved in place.
 */
export function resumeCommand(command: string, sessionId: string): string | null {
	const words = command.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0 || !isAgentSessionId(sessionId)) return null;

	const kept: string[] = [];
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index] as string;
		if (CONTINUE_FLAGS.has(word)) continue;
		if (RESUME_FLAGS.has(word)) {
			const next = words[index + 1];
			// `--resume` with nothing after it is the interactive picker, not an id to drop.
			if (next !== undefined && !next.startsWith("-")) index += 1;
			continue;
		}
		kept.push(word);
	}
	if (kept.length === 0) return null;
	return `${kept.join(" ")} --resume ${sessionId}`;
}

/**
 * Claude stores a conversation as `~/.claude/projects/<cwd with / and . as ->/<session id>.jsonl`, and
 * writes it only once the session has something to save. A session interrupted before that — started and
 * killed without a prompt — leaves an id that resolves to nothing, and offering it produces "No
 * conversation found with session ID". So the offer is made only when the conversation is actually on
 * disk. See SPEC.md.
 */
export function agentSessionExists(cwd: string, sessionId: string): boolean {
	if (!isAgentSessionId(sessionId)) return false;
	const projects = join(homedir(), ".claude", "projects");
	const file = `${sessionId}.jsonl`;
	if (cwd !== "" && existsSync(join(projects, cwd.replace(/[/.]/g, "-"), file))) return true;
	// `--resume <id>` itself searches every project on the machine, not just this one, so a session picked
	// from the interactive list can belong to a directory this workspace has never seen. Checking only the
	// worktree would refuse to offer back exactly the session the user chose. See SPEC.md.
	try {
		return readdirSync(projects).some((project) => existsSync(join(projects, project, file)));
	} catch {
		return false;
	}
}
