import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffLines, formatJson } from "./diff";
import { applyClaudeEdit, planClaudeEdit } from "./edits";

function workspace(files: Record<string, string> = {}): string {
	const root = mkdtempSync(join(tmpdir(), "claude-edits-"));
	for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body, "utf8");
	return root;
}

const added = (plan: { diff: { kind: string; text: string }[] }) =>
	plan.diff.filter((line) => line.kind === "add").map((line) => line.text);
const removed = (plan: { diff: { kind: string; text: string }[] }) =>
	plan.diff.filter((line) => line.kind === "remove").map((line) => line.text);

describe("diffLines", () => {
	test("reports only what moved, not the whole file", () => {
		const diff = diffLines("a\nb\nc", "a\nB\nc");
		expect(removed({ diff })).toEqual(["b"]);
		expect(added({ diff })).toEqual(["B"]);
		expect(diff.filter((line) => line.kind === "context").map((line) => line.text)).toEqual([
			"a",
			"c",
		]);
	});

	test("shows a deletion, which is the failure this exists to catch", () => {
		const diff = diffLines("keep\ndrop\nkeep2", "keep\nkeep2");
		expect(removed({ diff })).toEqual(["drop"]);
		expect(added({ diff })).toEqual([]);
	});
});

describe("formatJson", () => {
	test("keeps the file's own indentation so an edit is not a reformat", () => {
		const existing = '{\n    "a": 1\n}\n';
		expect(formatJson(existing, { a: 1, b: 2 })).toBe('{\n    "a": 1,\n    "b": 2\n}\n');
	});

	test("uses two spaces when there is nothing to copy", () => {
		expect(formatJson("", { a: 1 })).toBe('{\n  "a": 1\n}\n');
	});
});

describe("planClaudeEdit", () => {
	test("denying an MCP server adds it to the denied list", () => {
		const root = workspace();
		const plan = planClaudeEdit(
			{
				workspaceId: "ws",
				scope: "project",
				edit: { kind: "mcp", server: "uber", allowed: false },
			},
			root,
		);
		expect(plan.changes).toBe(true);
		expect(plan.summary).toContain("everyone who works on this project");
		expect(added(plan).join("\n")).toContain("uber");
	});

	test("the summary names who the change affects, per scope", () => {
		const root = workspace();
		const local = planClaudeEdit(
			{ workspaceId: "ws", scope: "local", edit: { kind: "mcp", server: "uber", allowed: false } },
			root,
		);
		expect(local.summary).toContain("this project only");
	});

	test("re-allowing removes the entry, and drops the key when it empties", () => {
		const root = workspace();
		mkdirSync(join(root, ".claude"), { recursive: true });
		writeFileSync(
			join(root, ".claude", "settings.json"),
			'{\n  "deniedMcpServers": ["uber"]\n}\n',
			"utf8",
		);
		const plan = planClaudeEdit(
			{ workspaceId: "ws", scope: "project", edit: { kind: "mcp", server: "uber", allowed: true } },
			root,
		);
		expect(plan.changes).toBe(true);
		expect(removed(plan).join("\n")).toContain("uber");
		// The key goes with its last entry rather than being left as an empty list.
		expect(added(plan).join("\n")).not.toContain("deniedMcpServers");
	});

	test("a setting edit writes a dotted key as nested objects", () => {
		const root = workspace();
		const plan = planClaudeEdit(
			{
				workspaceId: "ws",
				scope: "project",
				edit: { kind: "setting", key: "permissions.defaultMode", value: "plan" },
			},
			root,
		);
		expect(added(plan).join("\n")).toContain("permissions");
		expect(added(plan).join("\n")).toContain("plan");
	});

	test("creating a known file proposes its body, and never overwrites one that exists", () => {
		const root = workspace();
		const fresh = planClaudeEdit(
			{
				workspaceId: "ws",
				scope: "local",
				edit: { kind: "file", template: "project-local-instructions" },
			},
			root,
		);
		expect(fresh.changes).toBe(true);
		expect(fresh.path.endsWith("CLAUDE.local.md")).toBe(true);

		writeFileSync(join(root, "CLAUDE.local.md"), "mine\n", "utf8");
		const existing = planClaudeEdit(
			{
				workspaceId: "ws",
				scope: "local",
				edit: { kind: "file", template: "project-local-instructions" },
			},
			root,
		);
		expect(existing.changes).toBe(false);
	});
});

describe("applyClaudeEdit", () => {
	test("writes the file the plan described", () => {
		const root = workspace();
		const request = {
			workspaceId: "ws",
			scope: "local" as const,
			edit: { kind: "file" as const, template: "project-local-instructions" as const },
		};
		const plan = planClaudeEdit(request, root);
		applyClaudeEdit({ ...request, baseHash: plan.baseHash }, root);
		expect(readFileSync(join(root, "CLAUDE.local.md"), "utf8")).toContain("Local notes");
	});

	test("refuses when the file moved since the diff was approved", () => {
		const root = workspace();
		const request = {
			workspaceId: "ws",
			scope: "local" as const,
			edit: { kind: "file" as const, template: "project-local-instructions" as const },
		};
		const plan = planClaudeEdit(request, root);
		writeFileSync(join(root, "CLAUDE.local.md"), "someone else got here first\n", "utf8");
		expect(() => applyClaudeEdit({ ...request, baseHash: plan.baseHash }, root)).toThrow(
			"changed since",
		);
	});
});

describe("diffLines elision", () => {
	test("collapses unchanged text far from the change", () => {
		const before = Array.from({ length: 40 }, (_, line) => `line ${line}`).join("\n");
		const after = before.replace("line 20", "line twenty");
		const diff = diffLines(before, after);
		expect(added({ diff })).toEqual(["line twenty"]);
		expect(diff.filter((line) => line.kind === "gap").map((line) => line.text)).toEqual([
			"17 unchanged lines",
			"16 unchanged lines",
		]);
	});
});

describe("editing a settings value", () => {
	test("a list value writes as a list", () => {
		const root = workspace();
		const plan = planClaudeEdit(
			{
				workspaceId: "ws",
				scope: "project",
				edit: { kind: "setting", key: "permissions.allow", value: ["Bash(ls:*)", "Read(*)"] },
			},
			root,
		);
		expect(added(plan).join("\n")).toContain("Bash(ls:*)");
		expect(added(plan).join("\n")).toContain("Read(*)");
	});

	test("a null value removes the key, and the diff shows the removal", () => {
		const root = workspace();
		mkdirSync(join(root, ".claude"), { recursive: true });
		writeFileSync(
			join(root, ".claude", "settings.json"),
			'{\n  "cleanupPeriodDays": 30,\n  "model": "opus"\n}\n',
			"utf8",
		);
		const plan = planClaudeEdit(
			{
				workspaceId: "ws",
				scope: "project",
				edit: { kind: "setting", key: "cleanupPeriodDays", value: null },
			},
			root,
		);
		expect(plan.summary).toContain("Remove");
		expect(removed(plan).join("\n")).toContain("cleanupPeriodDays");
		expect(added(plan).join("\n")).not.toContain("cleanupPeriodDays");
	});

	test("a number stays a number rather than becoming a string", () => {
		const root = workspace();
		const request = {
			workspaceId: "ws",
			scope: "project" as const,
			edit: { kind: "setting" as const, key: "cleanupPeriodDays", value: 14 },
		};
		const plan = planClaudeEdit(request, root);
		applyClaudeEdit({ ...request, baseHash: plan.baseHash }, root);
		const written: unknown = JSON.parse(
			readFileSync(join(root, ".claude", "settings.json"), "utf8"),
		);
		expect((written as { cleanupPeriodDays: unknown }).cleanupPeriodDays).toBe(14);
	});
});

describe("editing a capability", () => {
	test("turning a plugin off records the decision rather than dropping the entry", () => {
		const root = workspace();
		const plan = planClaudeEdit(
			{
				workspaceId: "ws",
				scope: "project",
				edit: { kind: "plugin", name: "thinkrail@thinkrail", enabled: false },
			},
			root,
		);
		expect(added(plan).join("\n")).toContain("enabledPlugins");
		expect(added(plan).join("\n")).toContain("false");
	});

	test("turning a skill off writes an override, and turning it back on removes it", () => {
		const root = workspace();
		mkdirSync(join(root, ".claude"), { recursive: true });
		const settings = join(root, ".claude", "settings.json");
		const off = {
			workspaceId: "ws",
			scope: "project" as const,
			edit: { kind: "skill" as const, name: "code-review", enabled: false },
		};
		applyClaudeEdit({ ...off, baseHash: planClaudeEdit(off, root).baseHash }, root);
		expect(readFileSync(settings, "utf8")).toContain('"code-review": "off"');

		const on = { ...off, edit: { ...off.edit, enabled: true } };
		applyClaudeEdit({ ...on, baseHash: planClaudeEdit(on, root).baseHash }, root);
		// The absence of an override *is* the enabled state; `"on"` written back would claim otherwise.
		expect(readFileSync(settings, "utf8")).not.toContain("skillOverrides");
	});
});

describe("adding an MCP server", () => {
	test("a project server lands in .mcp.json, not in settings", () => {
		const root = workspace();
		const request = {
			workspaceId: "ws",
			scope: "project" as const,
			edit: {
				kind: "mcp-add" as const,
				server: "git",
				draft: { transport: "stdio" as const, command: "uvx", args: ["mcp-server-git"] },
			},
		};
		const plan = planClaudeEdit(request, root);
		expect(plan.path).toBe(join(root, ".mcp.json"));
		applyClaudeEdit({ ...request, baseHash: plan.baseHash }, root);
		const written = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
			mcpServers: Record<string, { command: string; args: string[] }>;
		};
		expect(written.mcpServers.git?.command).toBe("uvx");
		expect(written.mcpServers.git?.args).toEqual(["mcp-server-git"]);
	});

	test("a stdio server without a command is refused, and so is an http one without a URL", () => {
		const root = workspace();
		expect(() =>
			planClaudeEdit(
				{
					workspaceId: "ws",
					scope: "project",
					edit: { kind: "mcp-add", server: "git", draft: { transport: "stdio" } },
				},
				root,
			),
		).toThrow("needs a command");
		expect(() =>
			planClaudeEdit(
				{
					workspaceId: "ws",
					scope: "project",
					edit: { kind: "mcp-add", server: "docs", draft: { transport: "http" } },
				},
				root,
			),
		).toThrow("needs a URL");
	});
});

describe("scope", () => {
	test("a template writes the one file it names, and refuses any other scope", () => {
		const root = workspace();
		expect(() =>
			planClaudeEdit(
				{
					workspaceId: "ws",
					scope: "user",
					edit: { kind: "file", template: "project-instructions" },
				},
				root,
			),
		).toThrow("cannot be written to user");
	});
});

describe("creating a skill", () => {
	test("writes a SKILL.md whose frontmatter matches its directory, and never over one that exists", () => {
		const root = workspace();
		const request = {
			workspaceId: "ws",
			scope: "project" as const,
			edit: {
				kind: "skill-create" as const,
				name: "Reviewing A Migration",
				description: "Use when a change moves data between schema versions.",
			},
		};
		const plan = planClaudeEdit(request, root);
		expect(plan.path).toBe(join(root, ".claude", "skills", "reviewing-a-migration", "SKILL.md"));
		applyClaudeEdit({ ...request, baseHash: plan.baseHash }, root);
		const written = readFileSync(plan.path, "utf8");
		expect(written).toContain("name: reviewing-a-migration");
		expect(written).toContain("description: Use when a change moves data");

		writeFileSync(plan.path, "mine\n", "utf8");
		expect(planClaudeEdit(request, root).changes).toBe(false);
	});

	test("a description is required, because it is what Claude reads to choose a skill", () => {
		const root = workspace();
		expect(() =>
			planClaudeEdit(
				{
					workspaceId: "ws",
					scope: "user",
					edit: { kind: "skill-create", name: "thing", description: "  " },
				},
				root,
			),
		).toThrow("description");
	});

	test("there is no local skills directory, so that scope is refused", () => {
		const root = workspace();
		expect(() =>
			planClaudeEdit(
				{
					workspaceId: "ws",
					scope: "local",
					edit: { kind: "skill-create", name: "thing", description: "why" },
				},
				root,
			),
		).toThrow("cannot be written to local");
	});
});

describe("adding a hook", () => {
	test("a second hook on the same matcher joins that group rather than opening a rival one", () => {
		const root = workspace();
		mkdirSync(join(root, ".claude"), { recursive: true });
		const settings = join(root, ".claude", "settings.json");
		const first = {
			workspaceId: "ws",
			scope: "project" as const,
			edit: {
				kind: "hook" as const,
				event: "PreToolUse" as const,
				matcher: "Edit|Write",
				command: "./format.sh",
			},
		};
		applyClaudeEdit({ ...first, baseHash: planClaudeEdit(first, root).baseHash }, root);
		const second = { ...first, edit: { ...first.edit, command: "./lint.sh" } };
		applyClaudeEdit({ ...second, baseHash: planClaudeEdit(second, root).baseHash }, root);

		const written = JSON.parse(readFileSync(settings, "utf8")) as {
			hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] };
		};
		expect(written.hooks.PreToolUse).toHaveLength(1);
		expect(written.hooks.PreToolUse[0]?.matcher).toBe("Edit|Write");
		expect(written.hooks.PreToolUse[0]?.hooks.map((entry) => entry.command)).toEqual([
			"./format.sh",
			"./lint.sh",
		]);
	});

	test("an event with no matcher writes a group without one", () => {
		const root = workspace();
		const request = {
			workspaceId: "ws",
			scope: "project" as const,
			edit: {
				kind: "hook" as const,
				event: "SessionStart" as const,
				matcher: "",
				command: "./announce.sh",
			},
		};
		applyClaudeEdit({ ...request, baseHash: planClaudeEdit(request, root).baseHash }, root);
		const written = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")) as {
			hooks: { SessionStart: Record<string, unknown>[] };
		};
		expect(written.hooks.SessionStart[0]).not.toHaveProperty("matcher");
	});

	test("a hook without a command is refused", () => {
		const root = workspace();
		expect(() =>
			planClaudeEdit(
				{
					workspaceId: "ws",
					scope: "project",
					edit: { kind: "hook", event: "Stop", matcher: "", command: "  " },
				},
				root,
			),
		).toThrow("needs a command");
	});
});

describe("adding a plugin", () => {
	test("registers the marketplace and enables the plugin under it", () => {
		const root = workspace();
		const request = {
			workspaceId: "ws",
			scope: "project" as const,
			edit: {
				kind: "plugin-add" as const,
				marketplace: "claude-code-plugins",
				plugin: "typescript-lsp",
				source: { kind: "github" as const, repo: "anthropics/claude-code" },
			},
		};
		applyClaudeEdit({ ...request, baseHash: planClaudeEdit(request, root).baseHash }, root);
		const written = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")) as {
			extraKnownMarketplaces: Record<string, { source: { source: string; repo: string } }>;
			enabledPlugins: Record<string, boolean>;
		};
		expect(written.extraKnownMarketplaces["claude-code-plugins"]?.source).toEqual({
			source: "github",
			repo: "anthropics/claude-code",
		});
		expect(written.enabledPlugins["typescript-lsp@claude-code-plugins"]).toBe(true);
	});

	test("a GitHub marketplace that is not owner/repo is refused", () => {
		const root = workspace();
		expect(() =>
			planClaudeEdit(
				{
					workspaceId: "ws",
					scope: "user",
					edit: {
						kind: "plugin-add",
						marketplace: "m",
						plugin: "p",
						source: { kind: "github", repo: "claude-code" },
					},
				},
				root,
			),
		).toThrow("owner/repo");
	});
});
