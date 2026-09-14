/** `~` for the home directory, so a path reads at a glance rather than as a full filesystem path. */
export function abbreviateHomePath(path: string): string {
	return path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~");
}
