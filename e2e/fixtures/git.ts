import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function git(cwd: string, ...args: string[]): void {
	execFileSync("git", ["-C", cwd, ...args]);
}

export function gitQuiet(cwd: string, ...args: string[]): void {
	execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

/** A commit written with an explicit date, so `--date-order` puts it where the test wants it. */
export function gitDatedCommit(cwd: string, date: string, branch: string, message: string): void {
	const at = { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
	const read = (...args: string[]) =>
		execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
	const sha = execFileSync(
		"git",
		["-C", cwd, "commit-tree", read("rev-parse", "HEAD^{tree}"), "-p", read("rev-parse", "HEAD")],
		{ encoding: "utf8", env: at, input: message },
	).trim();
	execFileSync("git", ["-C", cwd, "branch", branch, sha], { stdio: "ignore" });
}

export function gitText(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

export function gitAs(cwd: string, ...args: string[]): string {
	return execFileSync(
		"git",
		["-C", cwd, "-c", "user.email=e2e@thinkrail.test", "-c", "user.name=e2e", ...args],
		{ encoding: "utf8" },
	).trim();
}

export function commitFile(
	worktree: string,
	path: string,
	content: string,
	subject: string,
): string {
	writeFileSync(join(worktree, path), content);
	gitAs(worktree, "add", "--", path);
	gitAs(worktree, "commit", "--no-verify", "-m", subject);
	return gitAs(worktree, "rev-parse", "HEAD");
}
