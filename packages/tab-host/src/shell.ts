import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { createTwoFilesPatch } from "diff";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import {
	Bash,
	defineCommand,
	type ExecResult,
	type FsStat,
	type IFileSystem,
} from "just-bash/browser";
import { dirnamePath, joinPath, normalizePath, type TabFs } from "./fs";
import {
	CORS_PROXY_CONFIG,
	commitAll,
	currentBranch,
	headText,
	listCommits,
	status,
	TAB_AUTHOR,
} from "./git";
import { nodeCommands } from "./nodeCommands";

const MAX_OUTPUT_CHARS = 50_000;

type Encoding = "utf8" | "utf-8" | "ascii" | "binary" | "base64" | "hex" | "latin1";

function encodingOf(options?: { encoding?: Encoding | null } | Encoding): Encoding {
	const encoding = typeof options === "string" ? options : options?.encoding;
	return encoding ?? "utf8";
}

/** just-bash's filesystem contract over the tab's volume, so the shell sees what Files, git and the tools see. */
export function volumeFileSystem(fs: TabFs): IFileSystem {
	const stat = (path: string, link: boolean): FsStat => {
		const s = link ? fs.lstatSync(path) : fs.statSync(path);
		return {
			isFile: s.isFile(),
			isDirectory: s.isDirectory(),
			isSymbolicLink: s.isSymbolicLink(),
			mode: Number(s.mode),
			size: Number(s.size),
			mtime: new Date(Number(s.mtimeMs)),
			ino: Number(s.ino),
		};
	};
	const allPaths = (dir: string, out: string[]): string[] => {
		for (const name of fs.readdirSync(dir) as string[]) {
			const child = joinPath(dir, name);
			out.push(child);
			if (fs.statSync(child).isDirectory()) allPaths(child, out);
		}
		return out;
	};
	return {
		readFile: async (path, options) =>
			fs.readFileSync(path, { encoding: encodingOf(options) as BufferEncoding }) as string,
		readFileBuffer: async (path) => new Uint8Array(fs.readFileSync(path) as Uint8Array),
		writeFile: async (path, content, options) => {
			fs.writeFileSync(
				path,
				content,
				typeof content === "string" ? { encoding: encodingOf(options) as BufferEncoding } : {},
			);
		},
		appendFile: async (path, content, options) => {
			fs.appendFileSync(
				path,
				content,
				typeof content === "string" ? { encoding: encodingOf(options) as BufferEncoding } : {},
			);
		},
		exists: async (path) => fs.existsSync(path),
		stat: async (path) => stat(path, false),
		lstat: async (path) => stat(path, true),
		mkdir: async (path, options) => {
			fs.mkdirSync(path, { recursive: options?.recursive === true });
		},
		readdir: async (path) => (fs.readdirSync(path) as string[]).sort(),
		rm: async (path, options) => {
			fs.rmSync(path, { recursive: options?.recursive === true, force: options?.force === true });
		},
		cp: async (src, dest, options) => {
			fs.cpSync(src, dest, { recursive: options?.recursive === true });
		},
		mv: async (src, dest) => {
			fs.renameSync(src, dest);
		},
		resolvePath: (base, path) =>
			path.startsWith("/") ? normalizePath(path) : joinPath(base, path),
		getAllPaths: () => allPaths("/", []),
		chmod: async (path, mode) => {
			fs.chmodSync(path, mode);
		},
		symlink: async (target, linkPath) => {
			fs.symlinkSync(target, linkPath);
		},
		link: async (existingPath, newPath) => {
			fs.linkSync(existingPath, newPath);
		},
		readlink: async (path) => fs.readlinkSync(path) as string,
		realpath: async (path) => fs.realpathSync(path) as string,
		utimes: async (path, atime, mtime) => {
			fs.utimesSync(path, atime, mtime);
		},
	};
}

const ok = (stdout: string): ExecResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr: string, exitCode = 1): ExecResult => ({ stdout: "", stderr, exitCode });

function repoRoot(fs: TabFs, cwd: string): string | null {
	for (let dir = normalizePath(cwd); ; dir = dirnamePath(dir)) {
		if (fs.existsSync(joinPath(dir, ".git"))) return dir;
		if (dir === "/") return null;
	}
}

function flagValue(args: string[], ...names: string[]): string | undefined {
	for (const name of names) {
		const index = args.indexOf(name);
		if (index >= 0) return args[index + 1];
		const inline = args.find((arg) => arg.startsWith(`${name}=`));
		if (inline) return inline.slice(name.length + 1);
	}
	return undefined;
}

const GIT_USAGE = [
	"git in the Playground is isomorphic-git; supported:",
	"  status [-s], add <path…|.|-A>, rm <path…>, commit [-a] -m <message>,",
	"  log [-n <count>] [--oneline], diff [--stat|--name-only] [<path…>],",
	"  branch [<name>], checkout [-b] <branch>, rev-parse HEAD|--abbrev-ref HEAD|--show-toplevel,",
	"  pull, fetch, push [<remote>] [<branch>], remote [-v], config <key> [<value>].",
	"Network goes through the CORS proxy in `git config http.corsProxy`; push and private pulls read",
	"GIT_USERNAME and GIT_TOKEN from the environment (export GIT_TOKEN=… first).",
].join("\n");

/** `git` for the tab's shell: the everyday subset, over isomorphic-git and the volume. */
export function gitCommand(fs: TabFs) {
	return defineCommand("git", async (args, ctx) => {
		const [sub, ...rest] = args;
		if (!sub || sub === "help" || sub === "--help") return ok(`${GIT_USAGE}\n`);
		if (sub === "--version" || sub === "version")
			return ok("git version 2.47.0 (isomorphic-git)\n");
		if (sub === "init") {
			await git.init({ fs, dir: ctx.cwd, defaultBranch: "main" });
			return ok(`Initialized empty Git repository in ${joinPath(ctx.cwd, ".git")}/\n`);
		}
		const dir = repoRoot(fs, ctx.cwd);
		if (!dir)
			return fail("fatal: not a git repository (or any of the parent directories): .git\n", 128);
		const relative = (path: string) => {
			const full = path.startsWith("/") ? normalizePath(path) : joinPath(ctx.cwd, path);
			return full === dir ? "." : full.slice(dir.length + 1);
		};
		const paths = rest.filter((arg) => !arg.startsWith("-"));
		switch (sub) {
			case "status": {
				const { branch, changes } = await status(fs, dir);
				if (rest.includes("-s") || rest.includes("--short") || rest.includes("--porcelain")) {
					const code = {
						added: "A ",
						modified: " M",
						deleted: " D",
						renamed: "R ",
						untracked: "??",
					};
					return ok(changes.map((c) => `${code[c.status]} ${c.path}\n`).join(""));
				}
				const lines = [`On branch ${branch}`];
				if (changes.length === 0) lines.push("nothing to commit, working tree clean");
				for (const change of changes) lines.push(`\t${change.status}: ${change.path}`);
				return ok(`${lines.join("\n")}\n`);
			}
			case "add": {
				if (rest.includes("-A") || rest.includes("--all") || paths.includes(".")) {
					for (const [path, , workdir] of await git.statusMatrix({ fs, dir })) {
						if (workdir === 0) await git.remove({ fs, dir, filepath: path });
						else await git.add({ fs, dir, filepath: path });
					}
					return ok("");
				}
				for (const path of paths) await git.add({ fs, dir, filepath: relative(path) });
				return ok("");
			}
			case "rm": {
				for (const path of paths) {
					await git.remove({ fs, dir, filepath: relative(path) });
					if (!rest.includes("--cached")) fs.rmSync(joinPath(dir, relative(path)), { force: true });
				}
				return ok("");
			}
			case "commit": {
				const message = flagValue(rest, "-m", "--message");
				if (!message) return fail("error: commit needs -m <message> in the Playground\n");
				const oid =
					rest.includes("-a") || rest.includes("--all") || rest.includes("-am")
						? await commitAll(fs, dir, message)
						: await git.commit({ fs, dir, message, author: TAB_AUTHOR });
				return ok(
					`[${await currentBranch(fs, dir)} ${oid.slice(0, 7)}] ${message.split("\n")[0]}\n`,
				);
			}
			case "log": {
				const count = Number(flagValue(rest, "-n", "--max-count") ?? 20);
				const commits = await listCommits(fs, dir, count);
				if (rest.includes("--oneline"))
					return ok(commits.map((c) => `${c.shortSha} ${c.subject}\n`).join(""));
				return ok(
					commits
						.map(
							(c) =>
								`commit ${c.sha}\nAuthor: ${c.author}\nDate:   ${c.committedAt}\n\n    ${c.subject}\n`,
						)
						.join("\n"),
				);
			}
			case "diff": {
				const wanted = new Set(paths.map(relative));
				const { changes } = await status(fs, dir);
				const selected = changes.filter((c) => wanted.size === 0 || wanted.has(c.path));
				if (rest.includes("--name-only")) return ok(selected.map((c) => `${c.path}\n`).join(""));
				let out = "";
				for (const change of selected) {
					const before = (await headText(fs, dir, change.path)).text;
					const file = joinPath(dir, change.path);
					const after = fs.existsSync(file) ? (fs.readFileSync(file, "utf8") as string) : "";
					const patch = createTwoFilesPatch(`a/${change.path}`, `b/${change.path}`, before, after);
					if (rest.includes("--stat")) {
						const lines = patch.split("\n");
						const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
						const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
						out += ` ${change.path} | ${added + removed} ${"+".repeat(added)}${"-".repeat(removed)}\n`;
					} else
						out += `diff --git a/${change.path} b/${change.path}\n${patch.split("\n").slice(1).join("\n")}`;
				}
				return ok(out);
			}
			case "branch": {
				if (paths[0]) {
					await git.branch({ fs, dir, ref: paths[0] });
					return ok("");
				}
				const current = await currentBranch(fs, dir);
				const branches = await git.listBranches({ fs, dir });
				return ok(branches.map((b) => `${b === current ? "*" : " "} ${b}\n`).join(""));
			}
			case "checkout":
			case "switch": {
				const create = rest.includes("-b") || rest.includes("-c");
				const ref = paths[0];
				if (!ref) return fail(`error: ${sub} needs a branch\n`);
				if (create) await git.branch({ fs, dir, ref, checkout: true });
				else await git.checkout({ fs, dir, ref });
				return ok(`Switched to ${create ? "a new " : ""}branch '${ref}'\n`);
			}
			case "pull":
			case "fetch":
			case "push": {
				const remote = paths[0] ?? "origin";
				const ref = paths[1] ?? (await currentBranch(fs, dir));
				const corsProxy = (await git.getConfig({ fs, dir, path: CORS_PROXY_CONFIG })) as
					| string
					| undefined;
				const token = ctx.env.get("GIT_TOKEN");
				const network = {
					fs,
					http,
					dir,
					remote,
					...(corsProxy ? { corsProxy } : {}),
					...(token
						? {
								onAuth: () => ({ username: ctx.env.get("GIT_USERNAME") ?? token, password: token }),
							}
						: {}),
				};
				if (sub === "fetch") {
					const result = await git.fetch({ ...network, ref, singleBranch: true });
					return ok(
						`From ${remote}\n * ${ref} -> ${result.fetchHead?.slice(0, 7) ?? "nothing new"}\n`,
					);
				}
				if (sub === "pull") {
					const before = await git.resolveRef({ fs, dir, ref: "HEAD" }).catch(() => null);
					await git.pull({ ...network, ref, singleBranch: true, author: TAB_AUTHOR });
					const after = await git.resolveRef({ fs, dir, ref: "HEAD" });
					return ok(
						before === after
							? "Already up to date.\n"
							: `Updating ${before?.slice(0, 7) ?? "(none)"}..${after.slice(0, 7)}\nFast-forward\n`,
					);
				}
				const pushed = await git.push({ ...network, ref });
				return pushed.ok
					? ok(`To ${remote}\n   ${ref} -> ${ref}\n`)
					: fail(`error: failed to push ${ref}: ${pushed.error ?? "rejected"}\n`);
			}
			case "remote": {
				const remotes = await git.listRemotes({ fs, dir });
				return ok(
					remotes
						.map(({ remote, url }) =>
							rest.includes("-v")
								? `${remote}\t${url} (fetch)\n${remote}\t${url} (push)\n`
								: `${remote}\n`,
						)
						.join(""),
				);
			}
			case "config": {
				const [key, value] = paths;
				if (!key) return fail("usage: git config <key> [<value>]\n");
				if (value !== undefined) {
					await git.setConfig({ fs, dir, path: key, value });
					return ok("");
				}
				const current = await git.getConfig({ fs, dir, path: key });
				return current === undefined ? fail("", 1) : ok(`${String(current)}\n`);
			}
			case "rev-parse": {
				if (rest.includes("--show-toplevel")) return ok(`${dir}\n`);
				if (rest.includes("--abbrev-ref")) return ok(`${await currentBranch(fs, dir)}\n`);
				return ok(`${await git.resolveRef({ fs, dir, ref: paths[0] ?? "HEAD" })}\n`);
			}
			default:
				return fail(`git: '${sub}' is not available in the Playground.\n${GIT_USAGE}\n`);
		}
	});
}

function clip(text: string): string {
	return text.length <= MAX_OUTPUT_CHARS
		? text
		: `${text.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated: ${text.length} characters]`;
}

/**
 * pi's `bash` tool, run by just-bash over the tab's volume: coreutils, pipes, redirections, jq, rg, and a
 * `git` command; no processes, so anything else answers "command not found".
 */
const BUILTIN_VERSIONS: Readonly<Record<string, string>> = {
	jq: "jq-1.7.1 (just-bash)",
	rg: "ripgrep 14.1.1 (just-bash)",
	sed: "sed (just-bash) 4.9",
	grep: "grep (just-bash) 3.11",
	awk: "awk (just-bash) 5.3",
	find: "find (just-bash) 4.10",
};

/** just-bash's own tools answer `--version` here; everything else goes to the built-in unchanged. */
function versionAware() {
	return Object.entries(BUILTIN_VERSIONS).map(([name, version]) =>
		defineCommand(name, async (args, ctx) => {
			if (args.length === 1 && (args[0] === "--version" || args[0] === "-V"))
				return ok(`${version}\n`);
			if (!ctx.origCommand) return fail(`${name}: unavailable\n`, 127);
			return ctx.origCommand(args);
		}),
	);
}

/** A just-bash shell over the volume, rooted at `root`, with the tab's `git`. */
export function createShell(fs: TabFs, root: string): Bash {
	fs.mkdirSync("/tmp", { recursive: true });
	fs.mkdirSync("/dev", { recursive: true });
	if (!fs.existsSync("/dev/null")) fs.writeFileSync("/dev/null", "");
	return new Bash({
		fs: volumeFileSystem(fs),
		cwd: root,
		env: { HOME: root, PWD: root, USER: "thinkrail" },
		customCommands: [gitCommand(fs), ...nodeCommands(fs, root), ...versionAware()],
	});
}

export function bashTool(fs: TabFs, root: string): AgentTool {
	const shell = createShell(fs, root);
	return {
		name: "bash",
		label: "Bash",
		description:
			"Run a bash command in the workspace (a simulated shell in the ThinkRail Playground: coreutils, grep/rg, sed, awk, find, jq, pipes and redirections, git including pull/push, and node, npm install, npx and tsc emulated in a sandboxed worker). No other programs; npm never runs install scripts.",
		parameters: Type.Object({
			command: Type.String({ description: "The bash command to run" }),
			timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
		}),
		execute: async (_toolCallId, params) => {
			const { command } = params as { command: string };
			const result = await shell.exec(command, { cwd: root });
			const output = clip([result.stdout, result.stderr].filter(Boolean).join("\n").trimEnd());
			if (result.exitCode !== 0)
				throw new Error(
					`${output}${output ? "\n\n" : ""}Command exited with code ${result.exitCode}`,
				);
			return { content: [{ type: "text", text: output || "(no output)" }], details: {} };
		},
	} as AgentTool;
}
