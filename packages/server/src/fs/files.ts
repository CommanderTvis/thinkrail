import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { FileNode, FileWriteResult, SearchHit, SearchHits } from "@thinkrail/contracts";
import { loadWorkspaces } from "../persistence";

function resolveInWorktree(workspaceId: string, path: string): { root: string; abs: string } {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const root = ws.worktreePath;
	const abs = resolve(root, path);
	const rel = relative(root, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes the worktree");
	return { root, abs };
}

function ignoredPaths(root: string, paths: readonly string[]): Set<string> {
	if (paths.length === 0) return new Set();
	const result = Bun.spawnSync(["git", "-C", root, "check-ignore", "-z", "--stdin"], {
		stdin: Buffer.from(`${paths.join("\0")}\0`),
		stdout: "pipe",
		stderr: "ignore",
	});
	if (result.exitCode > 1) return new Set();
	return new Set(
		new TextDecoder()
			.decode(result.stdout)
			.split("\0")
			.filter((entry) => entry !== ""),
	);
}

export function readDir(workspaceId: string, path: string): FileNode[] {
	const { root, abs } = resolveInWorktree(workspaceId, path);

	const nodes = readdirSync(abs, { withFileTypes: true })
		.filter((entry) => entry.name !== ".git")
		.map(
			(entry): FileNode => ({
				path: relative(root, join(abs, entry.name)),
				name: entry.name,
				kind: entry.isDirectory() ? "dir" : "file",
			}),
		)
		.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
	const ignored = ignoredPaths(
		root,
		nodes.map((node) => node.path),
	);
	return nodes.map((node) => (ignored.has(node.path) ? { ...node, gitignored: true } : node));
}

export function contentHash(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

export function readFileAt(abs: string): { content: string; hash: string } {
	const content = readFileSync(abs, "utf8");
	return { content, hash: contentHash(content) };
}

export function readFile(workspaceId: string, path: string): { content: string; hash: string } {
	return readFileAt(resolveInWorktree(workspaceId, path).abs);
}

/**
 * Compare-and-swap: the write lands only if what is on disk is still what the editor last read. See
 * SPEC.md for why the base is a content hash rather than an mtime.
 */
export function writeFileAt(abs: string, content: string, baseHash: string): FileWriteResult {
	let disk: { content: string; hash: string };
	try {
		disk = readFileAt(abs);
	} catch {
		disk = { content: "", hash: contentHash("") };
	}
	if (disk.hash !== baseHash) return { written: false, disk };
	writeFileSync(abs, content, "utf8");
	return { written: true, hash: contentHash(content) };
}

export function writeFile(
	workspaceId: string,
	path: string,
	content: string,
	baseHash: string,
): FileWriteResult {
	return writeFileAt(resolveInWorktree(workspaceId, path).abs, content, baseHash);
}

export function resolveWorktreeFile(workspaceId: string, path: string): string {
	return resolveInWorktree(workspaceId, path).abs;
}

const SEARCH_MATCH_LIMIT = 200;
const SEARCH_FILE_BYTE_LIMIT = 512 * 1024;

function searchDir(root: string, dir: string, needle: string, hits: SearchHit[]): void {
	if (hits.length >= SEARCH_MATCH_LIMIT) return;
	const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== ".git");
	const ignored = ignoredPaths(
		root,
		entries.map((entry) => relative(root, join(dir, entry.name))),
	);
	for (const entry of entries) {
		if (hits.length >= SEARCH_MATCH_LIMIT) return;
		const abs = join(dir, entry.name);
		const rel = relative(root, abs);
		if (ignored.has(rel)) continue;
		if (entry.isDirectory()) {
			searchDir(root, abs, needle, hits);
			continue;
		}
		if (!entry.isFile()) continue;
		let text: string;
		try {
			if (statSync(abs).size > SEARCH_FILE_BYTE_LIMIT) continue;
			text = readFileSync(abs, "utf8");
		} catch {
			continue;
		}
		if (text.includes("\0")) continue;
		const lines = text.split("\n");
		for (const [index, line] of lines.entries()) {
			if (!line.toLowerCase().includes(needle)) continue;
			hits.push({ path: rel, line: index + 1, text: line.slice(0, 400) });
			if (hits.length >= SEARCH_MATCH_LIMIT) return;
		}
	}
}

export function searchWorktree(workspaceId: string, query: string): SearchHits {
	const needle = query.toLowerCase();
	if (needle.length === 0) return { hits: [], truncated: false };
	const { root } = resolveInWorktree(workspaceId, ".");
	const hits: SearchHit[] = [];
	searchDir(root, root, needle, hits);
	return { hits, truncated: hits.length >= SEARCH_MATCH_LIMIT };
}
