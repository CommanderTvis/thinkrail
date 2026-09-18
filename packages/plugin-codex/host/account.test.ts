import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountReader } from "./account";
import { codexExecutable, createAppServer } from "./appServer";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
	cleanups.length = 0;
});

function fixture(timeoutMs = 2_000) {
	const dir = mkdtempSync(join(tmpdir(), "codex-account-"));
	const executable = join(dir, "codex fixture");
	const control = join(dir, "control.json");
	const log = join(dir, "requests.jsonl");
	const primary = { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 };
	const bucket = { limitId: "codex", limitName: "Codex", primary, secondary: null };
	const defaults = {
		account: {
			account: { type: "chatgpt", email: "test@example.com", planType: "pro" },
			requiresOpenaiAuth: true,
		},
		limits: { rateLimits: bucket },
	};
	function configure(overrides: Record<string, unknown> = {}) {
		writeFileSync(control, JSON.stringify({ ...defaults, ...overrides }));
	}
	configure();
	writeFileSync(
		executable,
		`#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
let initialized = false;
if (JSON.parse(readFileSync(${JSON.stringify(control)}, "utf8")).descendant) {
 const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "inherit" });
 appendFileSync(${JSON.stringify(log)}, JSON.stringify({ method: "descendant", pid: child.pid }) + "\\n");
}
if (process.argv.slice(2).join(" ") !== "app-server") process.exit(2);
createInterface({ input: process.stdin }).on("line", (line) => {
 const msg = JSON.parse(line);
 appendFileSync(${JSON.stringify(log)}, JSON.stringify({ ...msg, pid: process.pid }) + "\\n");
 const config = JSON.parse(readFileSync(${JSON.stringify(control)}, "utf8"));
 if (config.exit === msg.method) process.exit(3);
 if (config.hang === msg.method) return;
 if (config.malformed === msg.method) { process.stdout.write("not json\\n"); return; }
 if (msg.method === "initialized") { initialized = true; return; }
 const error = msg.method !== "initialize" && !initialized ? "missing handshake" : config.error === msg.method ? "quota unavailable" : null;
 const result = msg.method === "initialize" ? {} : msg.method === "account/read" ? config.account : config.limits;
 const reply = JSON.stringify(error ? { id: msg.id, error: { code: -1, message: error } } : { id: msg.id, result }) + "\\n";
 process.stdout.write(JSON.stringify({ method: "account/updated", params: {} }) + "\\n");
 process.stdout.write(reply.slice(0, 8));
 setTimeout(() => process.stdout.write(reply.slice(8)), 5);
});
`,
		{ mode: 0o755 },
	);
	const reader = createAccountReader(() => JSON.stringify(executable), timeoutMs);
	cleanups.push(
		() => rmSync(dir, { recursive: true, force: true }),
		() => reader.stop(),
	);
	return {
		reader,
		configure,
		executable,
		bucket,
		primary,
		requests: () =>
			readFileSync(log, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { method: string; pid: number }),
	};
}

test("initializes once, shares concurrent reads, and refreshes over the retained process", async () => {
	const f = fixture();
	const first = f.reader.read();
	expect(f.reader.read()).toBe(first);
	expect(await first).toMatchObject({
		loggedIn: true,
		email: "test@example.com",
		plan: "pro",
		usage: [{ usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 }],
	});
	f.configure({
		limits: { rateLimits: { ...f.bucket, primary: { ...f.primary, usedPercent: 63 } } },
	});
	expect((await f.reader.read()).usage[0]?.usedPercent).toBe(63);
	expect(f.requests().map((r) => r.method)).toEqual([
		"initialize",
		"initialized",
		"account/read",
		"account/rateLimits/read",
		"account/read",
		"account/rateLimits/read",
	]);
	expect(new Set(f.requests().map((r) => r.pid)).size).toBe(1);
});

test("uses all named buckets without duplicating the legacy view", async () => {
	const f = fixture();
	f.configure({
		limits: {
			rateLimits: f.bucket,
			rateLimitsByLimitId: {
				codex: {
					...f.bucket,
					secondary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: null },
				},
				review: {
					...f.bucket,
					limitName: "Code review",
					primary: { ...f.primary, usedPercent: 0 },
				},
			},
		},
	});
	const result = await f.reader.read();
	expect(result.usage.map((w) => w.id)).toEqual([
		"codex:primary",
		"codex:secondary",
		"review:primary",
	]);
	expect(result.usage[2]?.label).toBe("Code review");
	expect(result.usageFetchedAt).toBeString();
});

test.each([
	null,
	{ type: "apiKey" },
	{ type: "amazonBedrock" },
])("does not ask for ChatGPT limits for %j", async (account) => {
	const f = fixture();
	f.configure({ account: { account, requiresOpenaiAuth: true } });
	expect(await f.reader.read()).toMatchObject({ loggedIn: account !== null, usage: [] });
	expect(f.requests().map((r) => r.method)).not.toContain("account/rateLimits/read");
});

test("keeps identity but never old usage after a rate-limit error", async () => {
	const f = fixture();
	await f.reader.read();
	f.configure({ error: "account/rateLimits/read" });
	expect(await f.reader.read()).toMatchObject({
		email: "test@example.com",
		usage: [],
		usageError: "quota unavailable",
	});
});

test.each(["exit", "malformed", "hang"])("recovers on the next read after %s", async (mode) => {
	const f = fixture(1_000);
	f.configure({ [mode]: "account/read" });
	await expect(f.reader.read()).rejects.toThrow();
	f.configure();
	expect((await f.reader.read()).loggedIn).toBe(true);
	expect(new Set(f.requests().map((r) => r.pid)).size).toBe(2);
});

test("rejects malformed account and limits rather than reporting zero usage", async () => {
	const f = fixture();
	f.configure({ account: {} });
	await expect(f.reader.read()).rejects.toThrow("Invalid Codex account");
	f.configure({ limits: { rateLimits: { primary: { usedPercent: "25" } } } });
	expect((await f.reader.read()).usageError).toContain("Invalid Codex rate-limits");
});

test("dispose rejects in-flight work and reaps the child", async () => {
	const f = fixture();
	await f.reader.read();
	f.configure({ hang: "account/read" });
	const pending = f.reader.read().catch((error: unknown) => error);
	await f.reader.stop();
	expect(await pending).toMatchObject({ message: "Codex app-server stopped." });
	const pid = f.requests()[0]?.pid;
	expect(pid).toBeNumber();
	if (pid) expect(() => process.kill(pid, 0)).toThrow();
	await expect(f.reader.read()).rejects.toThrow("stopped");
});

test("initialization failure is bounded and a missing executable is reported", async () => {
	const f = fixture(1_000);
	f.configure({ hang: "initialize" });
	await expect(f.reader.read()).rejects.toThrow("initialize timed out");
	const server = createAppServer(`${f.executable}-missing`);
	try {
		await expect(server.request("account/read")).rejects.toThrow("Could not start");
	} finally {
		await server.stop();
	}
});

test.skipIf(process.platform === "win32")(
	"disposal also kills a wrapper's resistant descendant",
	async () => {
		const f = fixture();
		f.configure({ descendant: true });
		await f.reader.read();
		const descendant = f.requests().find((request) => request.method === "descendant")?.pid;
		expect(descendant).toBeNumber();
		await f.reader.stop();
		if (descendant) expect(() => process.kill(descendant, 0)).toThrow();
	},
);

test("extracts quoted executable paths without launching interactive arguments or a shell", () => {
	expect(codexExecutable('"/Applications/Codex CLI/codex" --yolo')).toBe(
		"/Applications/Codex CLI/codex",
	);
	expect(codexExecutable("codex --model configured")).toBe("codex");
	expect(() => codexExecutable("CODEX_HOME=/tmp codex")).toThrow();
	expect(() => codexExecutable('"unclosed path')).toThrow();
});
