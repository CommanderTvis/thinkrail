function isAbsolute(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Takes either a worktree-relative entry or an absolute path from anywhere on the host, and writes it the
 * way a shell (or an agent standing in some directory under the worktree) will resolve it back to the same
 * file — relative to `cwd` when that keeps it inside the worktree, absolute otherwise.
 */
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
