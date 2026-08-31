import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatEvent, ChatMessage, StopReason } from "@thinkrail/contracts";
import { createWorkspace, listWorkspaces, removeWorkspace, renameWorkspace } from "../workspaces";
import { isPromptCommitted, maybeNaiveNameWorkspace } from "./autoRename";

async function worktrees(projectId = "p1") {
	return (await listWorkspaces(projectId)).filter((w) => w.kind !== "default");
}

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "pipe" });
	if (result.success) return;
	const stderr = result.stderr.toString().trim();
	throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-rename-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(
		repo,
		"-c",
		"user.email=t@thinkrail.test",
		"-c",
		"user.name=ThinkRail Test",
		"commit",
		"--allow-empty",
		"-m",
		"init",
	);
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

let seq = 0;

function user(text: string): ChatMessage {
	seq += 1;
	return { role: "user", id: `u${seq}`, timestamp: seq, content: [{ type: "text", text }] };
}

function assistant(text: string): ChatMessage {
	seq += 1;
	return { role: "assistant", id: `a${seq}`, timestamp: seq, blocks: [{ type: "text", text }] };
}

function settled(stopReason: StopReason): ChatMessage {
	seq += 1;
	return {
		role: "marker",
		id: `m${seq}`,
		timestamp: seq,
		marker: { kind: "turnSettled", stopReason },
	};
}

const firstTurn = async (): Promise<ChatMessage[]> => [
	user("add a login form to the settings page"),
	assistant("Done — added the form."),
	settled("completed"),
];

test("names the workspace from the first prompt, provisionally (the branch moves, the flag does not)", async () => {
	const ws = await createWorkspace("p1");

	const named = await maybeNaiveNameWorkspace("s1", ws.id, firstTurn);

	expect(named?.name).toBe("Add A Login Form To");
	expect(named?.branch).toBe("add-a-login-form-to");
	expect(named?.worktreePath).toBe(ws.worktreePath);
	expect(named?.renamed).toBeUndefined();
	expect((await worktrees())[0]?.renamed).toBeUndefined();
});

test("it fires only while the workspace is pristine (branch still workspace-N)", async () => {
	const ws = await createWorkspace("p1");
	await maybeNaiveNameWorkspace("s1", ws.id, firstTurn);

	expect(await maybeNaiveNameWorkspace("s1", ws.id, firstTurn)).toBeNull();
	expect((await worktrees())[0]?.name).toBe("Add A Login Form To");
});

test("it never touches a user-named workspace", async () => {
	const ws = await createWorkspace("p1", "chosen name");

	expect(await maybeNaiveNameWorkspace("s1", ws.id, firstTurn)).toBeNull();
	expect((await worktrees())[0]?.name).toBe("chosen name");
});

test("a killed turn is never naming material — the first clean turn is", async () => {
	const ws = await createWorkspace("p1");
	const transcript = async (): Promise<ChatMessage[]> => [
		user("refactor the billing engine"),
		assistant("Starting on billing…"),
		settled("cancelled"),
		user("fix the header layout"),
		assistant("Done — header fixed."),
		settled("completed"),
	];

	const named = await maybeNaiveNameWorkspace("s1", ws.id, transcript);

	expect(named?.name).toBe("Fix The Header Layout");
});

test("it resolves null when the first prompt is blank or the transcript is empty", async () => {
	const ws = await createWorkspace("p1");
	const punctOnly = async (): Promise<ChatMessage[]> => [user("!!! ??? ..."), assistant("hm")];

	expect(await maybeNaiveNameWorkspace("s1", ws.id, punctOnly)).toBeNull();
	expect((await worktrees())[0]?.name).toBe("workspace-1");
	expect(await maybeNaiveNameWorkspace("s1", ws.id, async () => [])).toBeNull();
});

test("an unknown workspace resolves null", async () => {
	expect(await maybeNaiveNameWorkspace("s1", "nope", firstTurn)).toBeNull();
});

test("a workspace archived during the read is not renamed or resurrected", async () => {
	const ws = await createWorkspace("p1");
	let release = (): void => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});

	const pending = maybeNaiveNameWorkspace("s1", ws.id, async () => {
		await gate;
		return firstTurn();
	});
	removeWorkspace(ws.id);
	release();

	expect(await pending).toBeNull();
	expect(await worktrees()).toHaveLength(0);
});

test("a user rename landing during the read wins; the late name is dropped", async () => {
	const ws = await createWorkspace("p1");
	let release = (): void => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});

	const pending = maybeNaiveNameWorkspace("s1", ws.id, async () => {
		await gate;
		return firstTurn();
	});
	renameWorkspace(ws.id, "user picked this");
	release();

	expect(await pending).toBeNull();
	expect((await worktrees())[0]?.name).toBe("user picked this");
});

test("concurrent prompt-commits dedupe to one attempt", async () => {
	const ws = await createWorkspace("p1");
	let release = (): void => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let reads = 0;
	const slow = async (): Promise<ChatMessage[]> => {
		reads += 1;
		await gate;
		return firstTurn();
	};

	const first = maybeNaiveNameWorkspace("s1", ws.id, slow);
	const second = maybeNaiveNameWorkspace("s2", ws.id, slow);
	release();
	const [a, b] = await Promise.all([first, second]);

	expect(a?.name).toBe("Add A Login Form To");
	expect(b).toBeNull();
	expect(reads).toBe(1);
});

test("isPromptCommitted: only a user message_start carries the prompt", () => {
	const started = (message: ChatMessage): ChatEvent => ({ type: "message_start", message });
	expect(isPromptCommitted(started(user("hi")))).toBe(true);
	expect(isPromptCommitted(started(assistant("hi")))).toBe(false);
	expect(isPromptCommitted(started(settled("completed")))).toBe(false);
	expect(isPromptCommitted({ type: "turn_start" })).toBe(false);
	expect(isPromptCommitted({ type: "message_end", messageId: "u1", endedAt: 1 })).toBe(false);
});
