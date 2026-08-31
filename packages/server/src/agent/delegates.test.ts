import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpClientDelegates, TerminalExit, TerminalOutput } from "@thinkrail/acp";
import type { Workspace } from "@thinkrail/contracts";
import { readFile, resolveWorktreeFile, writeFile } from "../fs";
import { createAcpDelegates, sliceLines } from "./delegates";
import type { AgentTerminalRequest, SessionLocation } from "./ports";

const WORKSPACE = "w1";

let dataDir = "";
let worktree = "";
let previousDataDir: string | undefined;
const created: AgentTerminalRequest[] = [];
const killed: string[] = [];

beforeAll(() => {
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-delegates-"));
	worktree = join(dataDir, "worktree");
	mkdirSync(join(worktree, "src"), { recursive: true });
	writeFileSync(join(worktree, "src", "app.ts"), "one\ntwo\nthree\nfour\n", "utf8");
	writeFileSync(join(dataDir, "outside.txt"), "secret", "utf8");
	const workspaces: Workspace[] = [
		{
			id: WORKSPACE,
			projectId: "p1",
			name: "feature",
			branch: "feature",
			worktreePath: worktree,
			baseBranch: "main",
		},
	];
	writeFileSync(join(dataDir, "workspaces.json"), JSON.stringify(workspaces), "utf8");
	previousDataDir = process.env.THINKRAIL_DATA_DIR;
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterAll(() => {
	if (previousDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = previousDataDir;
	rmSync(dataDir, { recursive: true, force: true });
});

function delegates(known: SessionLocation | null = location()): AcpClientDelegates {
	return createAcpDelegates({
		files: {
			read: (workspaceId, path) => readFile(workspaceId, path).content,
			write: (workspaceId, path, content) => {
				writeFile(workspaceId, path, content);
			},
			resolve: (workspaceId, path) => resolveWorktreeFile(workspaceId, path),
		},
		terminals: {
			create: (request) => {
				created.push(request);
				return `t${created.length}`;
			},
			read: (): TerminalOutput => ({ output: "done", truncated: false }),
			waitForExit: async (): Promise<TerminalExit> => ({ exitCode: 0, signal: null }),
			kill: (terminalId) => {
				killed.push(terminalId);
			},
			release: () => undefined,
		},
		locate: (sessionId) => (known !== null && known.sessionId === sessionId ? known : undefined),
		publish: () => undefined,
		askPermission: async (request) => ({ id: request.id, outcome: "cancelled" }),
		askElicitation: async (request) => ({ id: request.id, outcome: "cancelled" }),
		closeElicitation: () => undefined,
		openMcp: async () => {
			throw new Error("not exercised");
		},
	});
}

function location(): SessionLocation {
	return { sessionId: "s1", workspaceId: WORKSPACE, cwd: worktree };
}

test("a line window is a window, and no window means the whole file", () => {
	expect(sliceLines("a\nb\nc")).toBe("a\nb\nc");
	expect(sliceLines("a\nb\nc", 2)).toBe("b\nc");
	expect(sliceLines("a\nb\nc", 2, 1)).toBe("b");
	expect(sliceLines("a\nb\nc", undefined, 2)).toBe("a\nb");
});

test("a read is scoped to the session's worktree by absolute path", async () => {
	const content = await delegates().readTextFile({
		sessionId: "s1",
		path: join(worktree, "src/app.ts"),
		line: 2,
		limit: 2,
	});
	expect(content).toBe("two\nthree");
});

test("a path that escapes the worktree is refused, not read and not written", async () => {
	const outside = join(worktree, "..", "outside.txt");
	await expect(delegates().readTextFile({ sessionId: "s1", path: outside })).rejects.toThrow(
		"Path escapes the worktree",
	);
	await expect(
		delegates().writeTextFile({ sessionId: "s1", path: outside, content: "owned" }),
	).rejects.toThrow("Path escapes the worktree");
	expect(readFileSync(join(dataDir, "outside.txt"), "utf8")).toBe("secret");
});

test("a write lands in the worktree, creating the directory it needs", async () => {
	await delegates().writeTextFile({
		sessionId: "s1",
		path: join(worktree, "docs/new/note.md"),
		content: "hello",
	});
	expect(readFileSync(join(worktree, "docs/new/note.md"), "utf8")).toBe("hello");
});

test("a request naming a session this host does not hold is refused", async () => {
	await expect(
		delegates(null).readTextFile({ sessionId: "s1", path: join(worktree, "src/app.ts") }),
	).rejects.toThrow("isn't attached to the running host");
});

test("a terminal runs in the session's worktree unless the agent names a contained cwd", async () => {
	created.length = 0;
	const bare = delegates();
	await bare.createTerminal({
		sessionId: "s1",
		command: "bun",
		args: ["test"],
		env: { CI: "1" },
	});
	expect(created[0]).toEqual({
		workspaceId: WORKSPACE,
		command: "bun",
		args: ["test"],
		env: { CI: "1" },
		cwd: worktree,
	});

	await bare.createTerminal({
		sessionId: "s1",
		command: "ls",
		args: [],
		env: {},
		cwd: "src",
		outputByteLimit: 64,
	});
	expect(created[1]?.cwd).toBe(join(worktree, "src"));
	expect(created[1]?.outputByteLimit).toBe(64);

	await expect(
		bare.createTerminal({ sessionId: "s1", command: "ls", args: [], env: {}, cwd: "../.." }),
	).rejects.toThrow("Path escapes the worktree");
});

test("terminal reads, waits and kills address the terminal the agent was given", async () => {
	killed.length = 0;
	const bare = delegates();
	expect(await bare.terminalOutput("s1", "t7")).toEqual({ output: "done", truncated: false });
	expect(await bare.waitForTerminalExit("s1", "t7")).toEqual({ exitCode: 0, signal: null });
	await bare.killTerminal("s1", "t7");
	expect(killed).toEqual(["t7"]);
});
