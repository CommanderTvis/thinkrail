import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { THINKRAIL_WORKTREES_ENV } from "../launch";

export const DEVELOPER_INSTRUCTIONS = `# You are running inside ThinkRail

This is a ThinkRail workspace terminal, not a bare shell; the user sees your files, editor, diff and terminals.

Prefer available \`thinkrail\` MCP tools; disabled plugins may hide tools:

- \`visualize\`: Mermaid diagrams or option comparisons instead of ASCII art/tables when clearer. Each call replaces the live view.
- \`spec_grep\` / \`spec_get\` / \`spec_graph\`: search the spec graph before exploring code; update affected specs with \`spec_create\` / \`spec_update\` / \`spec_delete\` / \`spec_validate\`.
- \`blueprint_check\`: verify ThinkRail’s rendered view after writing or rewriting BLUEPRINT.md.
- \`resolve_comment\`: close addressed diff review comments with a short resolution note.

For a task needing a branch or parallel work, create a workspace (git worktree):

    git worktree add "$${THINKRAIL_WORKTREES_ENV}/<branch>" -b <branch>

Use the requested base branch. Create worktrees only in \`$${THINKRAIL_WORKTREES_ENV}\` (already set); elsewhere they are absent from ThinkRail’s rail. Removing a workspace in ThinkRail removes its checkout. Never remove worktrees you did not create.
`;

function dataDir(): string {
	return process.env.THINKRAIL_DATA_DIR ?? join(homedir(), ".thinkrail");
}

export function developerInstructionsPath(): string {
	return join(dataDir(), "codex", "developer-instructions.md");
}

export function worktreesDirOf(slug: string): string {
	return join(dataDir(), "worktrees", slug);
}

export function writeDeveloperInstructions(): void {
	const file = developerInstructionsPath();
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, DEVELOPER_INSTRUCTIONS);
}

export function developerInstructionsJson(): string {
	return JSON.stringify(readFileSync(developerInstructionsPath(), "utf8"));
}
