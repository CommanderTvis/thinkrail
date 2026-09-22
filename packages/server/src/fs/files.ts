import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
	FileNode,
	FileWriteResult,
	ResourceMeta,
	SearchHit,
	SearchHits,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { readFileAt, writeFileAt } from "@thinkrail/shared/textFile";
import { loadWorkspaces } from "../persistence";
import { decodeText, resourceMeta } from "./content";

export { contentHash, readFileAt, writeFileAt } from "@thinkrail/shared/textFile";

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isGitMetadataPath(root: string, candidate: string): boolean {
	return relative(root, candidate).split(sep).includes(".git");
}

function assertExistingAncestorContained(root: string, abs: string): void {
	const realRoot = realpathSync(root);
	let cursor = abs;
	while (true) {
		let real: string;
		try {
			real = realpathSync(cursor);
		} catch (error) {
			const code =
				typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
			const parent = dirname(cursor);
			if (parent === cursor) throw error;
			cursor = parent;
			continue;
		}
		if (!isContained(realRoot, real)) throw new Error("Path escapes the worktree");
		if (isGitMetadataPath(realRoot, real)) throw new Error("The .git directory is not readable");
		return;
	}
}

function resolveInWorktree(
	workspaceId: string,
	path: string,
	followLeaf: boolean,
): { root: string; abs: string } {
	const ws = loadWorkspaces().find((workspace) => workspace.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const root = ws.worktreePath;
	const abs = resolve(root, path);
	if (!isContained(resolve(root), abs)) throw new Error("Path escapes the worktree");
	if (isGitMetadataPath(resolve(root), abs)) throw new Error("The .git directory is not readable");
	assertExistingAncestorContained(root, followLeaf ? abs : dirname(abs));
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
	const { root, abs } = resolveInWorktree(workspaceId, path, true);

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

function missingAsNotFound(err: unknown, abs: string): never {
	if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	throw new CodedError("FILE_NOT_FOUND", `${abs} no longer exists`);
}

/** A file that is gone reads as `FILE_NOT_FOUND`, so a client can tell it from a failed request. */
export function readExistingFile(abs: string): { content: string; hash: string } {
	try {
		return readFileAt(abs);
	} catch (err) {
		missingAsNotFound(err, abs);
	}
}

export function readFile(
	workspaceId: string,
	path: string,
): { content: string; meta: ResourceMeta } {
	const { abs } = resolveInWorktree(workspaceId, path, true);
	let bytes: Uint8Array;
	try {
		bytes = readFileSync(abs);
	} catch (err) {
		missingAsNotFound(err, abs);
	}
	const meta = resourceMeta(bytes, path);
	return { content: meta.text ? decodeText(bytes) : "", meta };
}

export function writeFile(
	workspaceId: string,
	path: string,
	content: string,
	baseHash: string,
): FileWriteResult {
	return writeFileAt(resolveInWorktree(workspaceId, path, true).abs, content, baseHash);
}

export function resolveWorktreeFile(
	workspaceId: string,
	path: string,
	options: { followLeaf?: boolean } = {},
): string {
	return resolveInWorktree(workspaceId, path, options.followLeaf !== false).abs;
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
	const { root } = resolveInWorktree(workspaceId, ".", true);
	const hits: SearchHit[] = [];
	searchDir(root, root, needle, hits);
	return { hits, truncated: hits.length >= SEARCH_MATCH_LIMIT };
}
