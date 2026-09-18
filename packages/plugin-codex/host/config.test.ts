import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createInstructions,
	HOOK_COMMAND,
	HOOK_EVENTS,
	hooksInstalled,
	installHooks,
	resolveCodexConfig,
	setKeyPath,
	writeCodexValue,
} from "./config";

let root: string;
let home: string;
let worktree: string;
const originalHome = process.env.CODEX_HOME;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "plugin-codex-"));
	home = join(root, "home");
	worktree = join(root, "repo");
	mkdirSync(home, { recursive: true });
	mkdirSync(join(worktree, ".codex"), { recursive: true });
	process.env.CODEX_HOME = home;
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (originalHome === undefined) delete process.env.CODEX_HOME;
	else process.env.CODEX_HOME = originalHome;
});

test("setKeyPath replaces, inserts before the first table, and removes", () => {
	const text = '# mine\nmodel = "a"\n\n[features]\nhooks = true\n';
	expect(setKeyPath(text, ["model"], "b")).toBe(
		'# mine\nmodel = "b"\n\n[features]\nhooks = true\n',
	);
	expect(setKeyPath(text, ["sandbox_mode"], "read-only")).toBe(
		'# mine\nmodel = "a"\nsandbox_mode = "read-only"\n\n[features]\nhooks = true\n',
	);
	expect(setKeyPath(text, ["model"], null)).toBe("# mine\n\n[features]\nhooks = true\n");
	expect(setKeyPath("", ["model"], "x")).toBe('model = "x"\n');
});

test("setKeyPath edits inside a table section, and adds the section when it is missing", () => {
	const text = 'model = "a"\n\n[features]\nhooks = true\n\n[tui]\ntheme = "dark"\n';
	expect(setKeyPath(text, ["features", "memories"], true)).toBe(
		'model = "a"\n\n[features]\nhooks = true\nmemories = true\n\n[tui]\ntheme = "dark"\n',
	);
	expect(setKeyPath(text, ["tui", "theme"], "light")).toContain('[tui]\ntheme = "light"');
	expect(setKeyPath(text, ["features", "hooks"], null)).toBe(
		'model = "a"\n\n[features]\n\n[tui]\ntheme = "dark"\n',
	);
	expect(setKeyPath(text, ["projects", "/a b", "trust_level"], "trusted")).toBe(
		`${text.trimEnd()}\n\n[projects."/a b"]\ntrust_level = "trusted"\n`,
	);
});

test("tables flatten into dotted keys, with Codex's hook and project trust bookkeeping left out", () => {
	writeFileSync(
		join(home, "config.toml"),
		"[features]\nhooks = true\n[hooks.state.'x:y']\ntrusted_hash = 'h'\n[projects.\"/r\"]\ntrust_level = \"trusted\"\n",
	);
	expect(resolveCodexConfig(worktree).settings.map((s) => [s.key, s.keyPath])).toEqual([
		["features.hooks", ["features", "hooks"]],
	]);
});

test("setKeyPath never touches a same-named key inside a table", () => {
	const text = "[profiles.fast]\nmodel = 'x'\n";
	expect(setKeyPath(text, ["model"], "y")).toBe("model = \"y\"\n[profiles.fast]\nmodel = 'x'\n");
});

test("setKeyPath refuses an edit it cannot make in place", () => {
	expect(() => setKeyPath('model = [\n "a",\n]\n', ["model"], "b")).toThrow(
		"edit the file by hand",
	);
});

test("the project layer wins only when the project is trusted", () => {
	writeFileSync(
		join(home, "config.toml"),
		'model = "user"\n[mcp_servers.docs]\nurl = "http://d"\n',
	);
	writeFileSync(join(worktree, ".codex", "config.toml"), 'model = "project"\n');

	const untrusted = resolveCodexConfig(worktree);
	expect(untrusted.projectTrusted).toBe(false);
	expect(untrusted.settings.find((s) => s.key === "model")?.value).toBe("user");
	expect(untrusted.layers.find((l) => l.scope === "project")?.ignored).toBe(true);
	expect(untrusted.mcpServers).toEqual([
		{ name: "docs", scope: "user", path: join(home, "config.toml"), target: "http://d" },
	]);

	writeCodexValue(worktree, "user", ["sandbox_mode"], "read-only");
	writeFileSync(
		join(home, "config.toml"),
		`${readFileSync(join(home, "config.toml"), "utf8")}\n[projects."${root}"]\ntrust_level = "trusted"\n`,
	);
	const trusted = resolveCodexConfig(worktree);
	expect(trusted.projectTrusted).toBe(true);
	expect(trusted.settings.find((s) => s.key === "model")).toEqual({
		key: "model",
		keyPath: ["model"],
		value: "project",
		scope: "project",
		path: join(worktree, ".codex", "config.toml"),
		shadowed: [{ value: "user", scope: "user", path: join(home, "config.toml") }],
	});
	expect(trusted.settings.find((s) => s.key === "sandbox_mode")?.value).toBe("read-only");
});

test("AGENTS.override.md beats AGENTS.md, and an empty file is skipped", () => {
	writeFileSync(join(home, "AGENTS.override.md"), "");
	writeFileSync(join(home, "AGENTS.md"), "global");
	writeFileSync(join(worktree, "AGENTS.md"), "plain");
	writeFileSync(join(worktree, "AGENTS.override.md"), "override");
	expect(resolveCodexConfig(worktree).instructions).toEqual([
		{ scope: "global", path: join(home, "AGENTS.md"), bytes: 6 },
		{
			scope: "project",
			path: join(worktree, "AGENTS.override.md"),
			relativePath: "AGENTS.override.md",
			bytes: 8,
		},
	]);
});

test("installHooks keeps the user's hooks and is idempotent", () => {
	const theirs = { hooks: [{ type: "command", command: "echo mine" }] };
	writeFileSync(join(home, "hooks.json"), JSON.stringify({ hooks: { Stop: [theirs] } }));
	expect(hooksInstalled()).toBe(false);

	installHooks();
	installHooks();

	const hooks = JSON.parse(readFileSync(join(home, "hooks.json"), "utf8")).hooks;
	expect(hooks.Stop).toEqual([theirs, { hooks: [{ type: "command", command: HOOK_COMMAND }] }]);
	for (const event of HOOK_EVENTS) expect(hooks[event]).toHaveLength(event === "Stop" ? 2 : 1);
	expect(hooksInstalled()).toBe(true);
});

test("the hook command posts stdin only inside a ThinkRail terminal", async () => {
	const received: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch: async (request) => {
			received.push(await request.text());
			return new Response("ok");
		},
	});
	const run = (env: Record<string, string>) =>
		Bun.spawn(["sh", "-c", HOOK_COMMAND], {
			stdin: new TextEncoder().encode('{"hook_event_name":"Stop"}'),
			env: { PATH: process.env.PATH ?? "", ...env },
		}).exited;
	try {
		expect(await run({})).toBe(0);
		expect(await run({ THINKRAIL_CODEX_STATUS_URL: `http://127.0.0.1:${server.port}/s` })).toBe(0);
	} finally {
		server.stop(true);
	}
	expect(received).toEqual(['{"hook_event_name":"Stop"}']);
});

test("typed values keep their TOML type", () => {
	writeCodexValue(worktree, "user", ["hide_agent_reasoning"], true);
	writeCodexValue(worktree, "user", ["project_doc_max_bytes"], 65536);
	writeCodexValue(worktree, "user", ["project_doc_fallback_filenames"], ["CLAUDE.md"]);
	expect(Bun.TOML.parse(readFileSync(join(home, "config.toml"), "utf8"))).toEqual({
		hide_agent_reasoning: true,
		project_doc_max_bytes: 65536,
		project_doc_fallback_filenames: ["CLAUDE.md"],
	});
});

test("an enum key refuses a value Codex does not accept", () => {
	expect(() => writeCodexValue(worktree, "user", ["sandbox_mode"], "anything")).toThrow(
		"sandbox_mode must be one of",
	);
	writeCodexValue(worktree, "user", ["sandbox_mode"], "read-only");
	expect(readFileSync(join(home, "config.toml"), "utf8")).toBe('sandbox_mode = "read-only"\n');
});

test("createInstructions writes a non-empty starter and never overwrites", () => {
	writeFileSync(join(worktree, "AGENTS.md"), "mine");
	expect(createInstructions(worktree, "project")).toEqual({
		path: join(worktree, "AGENTS.md"),
		relativePath: "AGENTS.md",
	});
	expect(readFileSync(join(worktree, "AGENTS.md"), "utf8")).toBe("mine");
	createInstructions(worktree, "global");
	expect(resolveCodexConfig(worktree).instructions.map((file) => file.scope)).toEqual([
		"global",
		"project",
	]);
});

test("instructions walk the repository root to tab CWD, choosing one file per directory", () => {
	mkdirSync(join(worktree, ".git"));
	const nested = join(worktree, "app", "src");
	mkdirSync(nested, { recursive: true });
	writeFileSync(join(root, "AGENTS.md"), "Outside repository");
	writeFileSync(join(home, "AGENTS.md"), "Global");
	writeFileSync(join(worktree, "AGENTS.md"), "Root");
	writeFileSync(join(worktree, "app", "AGENTS.md"), "Shadowed");
	writeFileSync(join(worktree, "app", "AGENTS.override.md"), "Override");
	writeFileSync(join(nested, "AGENTS.override.md"), "");
	writeFileSync(join(nested, "CONTEXT.md"), "Fallback");
	writeFileSync(join(home, "config.toml"), 'project_doc_fallback_filenames = ["CONTEXT.md"]');
	const snapshot = resolveCodexConfig(worktree, nested);
	expect(snapshot.root).toBe(nested);
	expect(snapshot.instructions.map((file) => file.path)).toEqual([
		join(home, "AGENTS.md"),
		join(worktree, "AGENTS.md"),
		join(worktree, "app", "AGENTS.override.md"),
		join(nested, "CONTEXT.md"),
	]);
	expect(snapshot.instructions.at(-1)?.relativePath).toBe(join("app", "src", "CONTEXT.md"));
	expect(resolveCodexConfig(worktree).instructions).toHaveLength(2);
});

test("without a repository only the CWD contributes project instructions", () => {
	const nested = join(worktree, "nested");
	mkdirSync(nested);
	writeFileSync(join(worktree, "AGENTS.md"), "Parent");
	writeFileSync(join(nested, "AGENTS.md"), "CWD");
	expect(resolveCodexConfig(worktree, nested).instructions.map((file) => file.path)).toEqual([
		join(nested, "AGENTS.md"),
	]);
});

test("instructions outside the worktree open through their absolute external-file path", () => {
	const outside = join(root, "other");
	mkdirSync(outside);
	writeFileSync(join(outside, "AGENTS.md"), "Other directory");
	const snapshot = resolveCodexConfig(worktree, outside);
	expect(snapshot.instructions).toEqual([
		{ scope: "project", path: join(outside, "AGENTS.md"), bytes: 15 },
	]);
});

test("launch instructions appear as an explicit source after the AGENTS chain", () => {
	const prompt = join(home, "developer-instructions.md");
	writeFileSync(prompt, "ThinkRail guidance");
	writeFileSync(join(worktree, "AGENTS.md"), "Project instructions");
	const snapshot = resolveCodexConfig(worktree, worktree, [prompt]);
	expect(snapshot.instructions.map((file) => file.scope)).toEqual(["project", "launch"]);
	expect(snapshot.instructions.at(-1)).toEqual({ scope: "launch", path: prompt, bytes: 18 });
	expect(resolveCodexConfig(worktree).instructions).toHaveLength(1);
});
