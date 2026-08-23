import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginStatus, pluginStatusMaintained } from "./plugin";
import { resolveClaudeConfig } from "./resolver";

// `CLAUDE_CONFIG_DIR` is the whole isolation: it moves both `~/.claude` and `~/.claude.json`, so this
// test never reads the developer's own Claude configuration.
const original = process.env.CLAUDE_CONFIG_DIR;

let home: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "claude-caps-home-"));
	process.env.CLAUDE_CONFIG_DIR = home;
});

afterEach(() => {
	if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = original;
});

function project(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "claude-caps-"));
	for (const [name, body] of Object.entries(files)) {
		const path = join(root, name);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, body, "utf8");
	}
	return root;
}

const find = (root: string, kind: string, name: string) =>
	resolveClaudeConfig("ws", root).capabilities.find(
		(item) => item.kind === kind && item.name === name,
	);

describe("capability state", () => {
	test("a denied MCP server reads as off, and says which file denied it", () => {
		const root = project({
			".mcp.json": '{ "mcpServers": { "git": { "command": "uvx" } } }',
			".claude/settings.json": '{ "deniedMcpServers": ["git"] }',
		});
		const server = find(root, "mcp", "git");
		expect(server?.enabled).toBe(false);
		expect(server?.disabledBy?.scope).toBe("project");
	});

	test("a server left alone reads as on", () => {
		const root = project({ ".mcp.json": '{ "mcpServers": { "git": { "command": "uvx" } } }' });
		expect(find(root, "mcp", "git")?.enabled).toBe(true);
	});

	test("disabledMcpjsonServers switches off a project server too", () => {
		const root = project({
			".mcp.json": '{ "mcpServers": { "git": { "command": "uvx" } } }',
			".claude/settings.local.json": '{ "disabledMcpjsonServers": ["git"] }',
		});
		expect(find(root, "mcp", "git")?.enabled).toBe(false);
	});

	test("a skill with an off override reads as off", () => {
		const root = project({
			".claude/skills/reviewer/SKILL.md": "# reviewer\n",
			".claude/settings.json": '{ "skillOverrides": { "reviewer": "off" } }',
		});
		const skill = find(root, "skill", "reviewer");
		expect(skill?.enabled).toBe(false);
		expect(skill?.disabledBy?.keyPath).toEqual(["skillOverrides", "reviewer"]);
	});

	test("an agent has no switch, so it is never reported as off", () => {
		const root = project({
			".claude/agents/scout.md": "---\nname: scout\n---\n",
			".claude/settings.json": '{ "skillOverrides": { "scout": "off" } }',
		});
		expect(find(root, "agent", "scout")?.enabled).toBe(true);
	});

	test("servers declared for this project in ~/.claude.json are reported as local", () => {
		const root = project({});
		writeFileSync(
			join(home, ".claude.json"),
			JSON.stringify({ projects: { [root]: { mcpServers: { notes: { command: "notes-mcp" } } } } }),
			"utf8",
		);
		const server = find(root, "mcp", "notes");
		expect(server?.origin.scope).toBe("local");
		expect(server?.origin.keyPath).toEqual(["projects", root, "mcpServers", "notes"]);
	});
});

describe("hooks", () => {
	test("every hook is listed with the command it runs and the file it came from", () => {
		const root = project({
			".claude/settings.json": JSON.stringify({
				hooks: {
					PreToolUse: [
						{ matcher: "Edit|Write", hooks: [{ type: "command", command: "./format.sh" }] },
					],
					SessionStart: [{ hooks: [{ type: "command", command: "./announce.sh" }] }],
				},
			}),
		});
		const hooks = resolveClaudeConfig("ws", root).capabilities.filter(
			(item) => item.kind === "hook",
		);
		expect(hooks.map((hook) => hook.name)).toEqual(["PreToolUse · Edit|Write", "SessionStart"]);
		expect(hooks[0]?.detail).toBe("./format.sh");
		expect(hooks[0]?.origin.keyPath).toEqual(["hooks", "PreToolUse"]);
		expect(hooks.every((hook) => hook.enabled)).toBe(true);
	});

	test("disableAllHooks switches every one of them off, and says where that came from", () => {
		const root = project({
			".claude/settings.json": JSON.stringify({
				hooks: { Stop: [{ hooks: [{ type: "command", command: "./done.sh" }] }] },
			}),
			".claude/settings.local.json": JSON.stringify({ disableAllHooks: true }),
		});
		const hook = resolveClaudeConfig("ws", root).capabilities.find((item) => item.kind === "hook");
		expect(hook?.enabled).toBe(false);
		expect(hook?.disabledBy?.keyPath).toEqual(["disableAllHooks"]);
		expect(hook?.disabledBy?.scope).toBe("local");
	});
});

describe("plugin registration", () => {
	test("an entry the user already approved is brought back into line without asking again", () => {
		writeFileSync(
			join(home, "settings.json"),
			JSON.stringify({
				enabledPlugins: { "thinkrail@thinkrail": true },
				extraKnownMarketplaces: {
					thinkrail: {
						source: { source: "directory", path: "/somewhere/else" },
						thinkrailVersion: "0.0.1",
					},
				},
			}),
			"utf8",
		);
		expect(pluginStatus().state).toBe("outdated");
		expect(pluginStatusMaintained().state).toBe("enabled");
		// And the second reading is a no-op rather than a rewrite loop.
		expect(pluginStatus().state).toBe("enabled");
	});

	test("nothing registered still asks", () => {
		writeFileSync(join(home, "settings.json"), "{}", "utf8");
		expect(pluginStatusMaintained().state).toBe("absent");
	});
});
