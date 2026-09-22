import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
	FileKind,
	FileNode,
	FileWriteResult,
	SearchHit,
	SearchHits,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { readFileAt, writeFileAt } from "@thinkrail/shared/textFile";
import { loadWorkspaces } from "../persistence";

export { contentHash, readFileAt, writeFileAt } from "@thinkrail/shared/textFile";

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

/** A file that is gone reads as `FILE_NOT_FOUND`, so a client can tell it from a failed request. */
export function readExistingFile(abs: string): { content: string; hash: string } {
	try {
		return readFileAt(abs);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		throw new CodedError("FILE_NOT_FOUND", `${abs} no longer exists`);
	}
}

export function readFile(workspaceId: string, path: string): { content: string; hash: string } {
	return readExistingFile(resolveInWorktree(workspaceId, path).abs);
}

/** Creates an empty file or folder, and any folders on the way to it; never overwrites. */
export function createPath(workspaceId: string, path: string, kind: FileKind): void {
	const { abs } = resolveInWorktree(workspaceId, path);
	if (existsSync(abs)) throw new Error(`${path} already exists`);
	mkdirSync(dirname(abs), { recursive: true });
	if (kind === "dir") mkdirSync(abs);
	else writeFileSync(abs, "", { flag: "wx" });
}

/** Moves a file or folder within the worktree; refuses to replace anything but itself (a case-only rename). */
export function renamePath(workspaceId: string, path: string, to: string): void {
	const from = resolveInWorktree(workspaceId, path);
	const target = resolveInWorktree(workspaceId, to);
	if (from.abs === from.root) throw new Error("The workspace folder itself cannot be renamed");
	if (existsSync(target.abs) && statSync(target.abs).ino !== statSync(from.abs).ino) {
		throw new Error(`${to} already exists`);
	}
	mkdirSync(dirname(target.abs), { recursive: true });
	renameSync(from.abs, target.abs);
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
