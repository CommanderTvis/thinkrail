import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, type TSchema, Type } from "@earendil-works/pi-ai";
import { joinPath, normalizePath, type TabFs } from "./fs";
import { commitAll, listCommits, status } from "./git";
import { bashTool } from "./shell";

const MAX_READ_LINES = 2000;
const MAX_LISTED = 500;

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: {} };
}

function tool<T extends TSchema>(definition: {
	name: string;
	label: string;
	description: string;
	parameters: T;
	run: (params: Static<T>) => Promise<string>;
}): AgentTool {
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		execute: async (_id, params) => text(await definition.run(params as Static<T>)),
	} as AgentTool;
}

/** Resolves a tool path inside `root`; the agent may name it relative to the root or absolutely under it. */
export function resolveInside(root: string, path: string): string {
	const full =
		path.startsWith(`${root}/`) || path === root ? normalizePath(path) : joinPath(root, path);
	if (full !== root && !full.startsWith(`${root}/`))
		throw new Error(`path escapes the workspace: ${path}`);
	return full;
}

function walk(fs: TabFs, dir: string, visit: (path: string) => boolean | undefined): void {
	for (const name of (fs.readdirSync(dir) as string[]).sort()) {
		if (name === ".git" || name === "node_modules") continue;
		const child = joinPath(dir, name);
		if (fs.statSync(child).isDirectory()) walk(fs, child, visit);
		else if (visit(child) === false) return;
	}
}

function globToRegExp(pattern: string): RegExp {
	let source = "";
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern.charAt(i);
		if (char === "*") {
			if (pattern[i + 1] === "*") {
				source += ".*";
				i++;
				if (pattern[i + 1] === "/") i++;
			} else source += "[^/]*";
		} else if (char === "?") source += "[^/]";
		else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${source}$`);
}

/** The in-tab agent's tools: pi's file tool names and argument shapes, plus git over isomorphic-git. */
export function createTools(fs: TabFs, root: string): AgentTool[] {
	const rel = (path: string) => path.slice(root.length + 1);
	return [
		bashTool(fs, root),
		tool({
			name: "read",
			label: "Read",
			description: "Read a text file. Paths are relative to the workspace root.",
			parameters: Type.Object({
				path: Type.String(),
				offset: Type.Optional(Type.Number({ description: "1-based line to start at" })),
				limit: Type.Optional(Type.Number()),
			}),
			run: async ({ path, offset, limit }) => {
				const lines = (fs.readFileSync(resolveInside(root, path), "utf8") as string).split("\n");
				const start = Math.max(0, (offset ?? 1) - 1);
				return lines.slice(start, start + (limit ?? MAX_READ_LINES)).join("\n");
			},
		}),
		tool({
			name: "write",
			label: "Write",
			description: "Create or overwrite a file, creating parent directories.",
			parameters: Type.Object({ path: Type.String(), content: Type.String() }),
			run: async ({ path, content }) => {
				const full = resolveInside(root, path);
				fs.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
				fs.writeFileSync(full, content);
				return `Wrote ${content.length} characters to ${rel(full)}`;
			},
		}),
		tool({
			name: "edit",
			label: "Edit",
			description: "Replace one exact, unique occurrence of oldText with newText in a file.",
			parameters: Type.Object({
				path: Type.String(),
				oldText: Type.String(),
				newText: Type.String(),
			}),
			run: async ({ path, oldText, newText }) => {
				const full = resolveInside(root, path);
				const current = fs.readFileSync(full, "utf8") as string;
				const first = current.indexOf(oldText);
				if (first < 0) throw new Error(`oldText not found in ${path}`);
				if (current.indexOf(oldText, first + 1) >= 0)
					throw new Error(`oldText occurs more than once in ${path}`);
				fs.writeFileSync(
					full,
					current.slice(0, first) + newText + current.slice(first + oldText.length),
				);
				return `Edited ${rel(full)}`;
			},
		}),
		tool({
			name: "ls",
			label: "List",
			description: 'List a directory ("." for the workspace root); directories end with /.',
			parameters: Type.Object({ path: Type.Optional(Type.String()) }),
			run: async ({ path }) => {
				const dir = resolveInside(root, path ?? ".");
				const names = (fs.readdirSync(dir) as string[])
					.filter((name) => name !== ".git")
					.sort()
					.map((name) => (fs.statSync(joinPath(dir, name)).isDirectory() ? `${name}/` : name));
				return names.join("\n") || "(empty)";
			},
		}),
		tool({
			name: "find",
			label: "Find",
			description: "Find files whose workspace-relative path matches a glob such as **/*.ts.",
			parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }),
			run: async ({ pattern, path }) => {
				const matcher = globToRegExp(pattern.includes("/") ? pattern : `**/${pattern}`);
				const found: string[] = [];
				walk(fs, resolveInside(root, path ?? "."), (file) => {
					if (matcher.test(rel(file))) found.push(rel(file));
					return found.length < MAX_LISTED;
				});
				return found.join("\n") || "No files found";
			},
		}),
		tool({
			name: "grep",
			label: "Grep",
			description: "Search file contents with a regular expression; prints path:line: text.",
			parameters: Type.Object({
				pattern: Type.String(),
				path: Type.Optional(Type.String()),
				ignoreCase: Type.Optional(Type.Boolean()),
			}),
			run: async ({ pattern, path, ignoreCase }) => {
				const regex = new RegExp(pattern, ignoreCase ? "i" : "");
				const hits: string[] = [];
				walk(fs, resolveInside(root, path ?? "."), (file) => {
					const lines = (fs.readFileSync(file, "utf8") as string).split("\n");
					lines.forEach((line, index) => {
						if (hits.length < MAX_LISTED && regex.test(line))
							hits.push(`${rel(file)}:${index + 1}: ${line}`);
					});
					return hits.length < MAX_LISTED;
				});
				return hits.join("\n") || "No matches";
			},
		}),
		tool({
			name: "git_status",
			label: "Git status",
			description: "Show the current branch and changed files.",
			parameters: Type.Object({}),
			run: async () => {
				const { branch, changes } = await status(fs, root);
				return [`On branch ${branch}`, ...changes.map((c) => `${c.status} ${c.path}`)].join("\n");
			},
		}),
		tool({
			name: "git_commit",
			label: "Git commit",
			description: "Stage every change, deletions included, and commit with the message.",
			parameters: Type.Object({ message: Type.String() }),
			run: async ({ message }) => `Committed ${(await commitAll(fs, root, message)).slice(0, 7)}`,
		}),
		tool({
			name: "git_log",
			label: "Git log",
			description: "Show recent commits, newest first.",
			parameters: Type.Object({ limit: Type.Optional(Type.Number()) }),
			run: async ({ limit }) =>
				(await listCommits(fs, root, limit ?? 20))
					.map((c) => `${c.shortSha} ${c.subject}`)
					.join("\n") || "No commits yet",
		}),
	];
}
