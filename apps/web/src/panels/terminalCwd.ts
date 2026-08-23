import { abbreviateHomePath } from "@/lib";

/**
 * Where the agent was started, whole: a session cannot leave the directory it began in, and a fragment of
 * it relative to the worktree ("applications/axel-springer") reads as a path to nowhere. The agent's own
 * header says `~/job-search`, and so does this. See panels/SPEC.md.
 */
const CWD_LABEL_MAX = 40;

export function cwdLabel(cwd: string | undefined): string | null {
	if (!cwd) return null;
	const abbreviated = abbreviateHomePath(cwd);
	if (abbreviated.length <= CWD_LABEL_MAX) return abbreviated;
	// The ends of a path are what identify it: where it starts, and the directory it actually is. The
	// middle is what a truncation should eat — trimming the tail leaves `/var/folders/ph/7mrpl…`.
	const segments = abbreviated.split("/");
	const head = segments[0] === "" ? "" : segments[0];
	const tail = segments.slice(-2).join("/");
	return `${head}/…/${tail}`;
}

function isAbsolute(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/** Takes either a worktree-relative entry or an absolute path from anywhere on the host. */
export function attachPath(
	path: string,
	worktreePath: string | undefined,
	cwd: string | undefined,
): string {
	const absolute = isAbsolute(path) ? path : worktreePath ? `${worktreePath}/${path}` : null;
	if (!absolute) return path;
	if (!cwd) return absolute;
	if (absolute.startsWith(`${cwd}/`)) return absolute.slice(cwd.length + 1);
	return absolute;
}
