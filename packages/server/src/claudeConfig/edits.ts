import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	ClaudeEdit,
	ClaudeEditPlan,
	ClaudeEditRequest,
	ClaudeMarketplaceSource,
	ClaudeMcpServerDraft,
	ClaudeWritableScope,
} from "@thinkrail/contracts";
import { CLAUDE_SCOPE_WORDING, claudeEditScopes } from "@thinkrail/contracts";
import { contentHash as hashOf } from "../fs";
import { diffLines, formatJson } from "./diff";
import { isObject, stringList } from "./json";
import { claudeHome, claudeStatePath, settingsPaths } from "./paths";
import { resolveClaudeConfig } from "./resolver";

/** A server the user rejects is recorded here; the key applies in every scope, unlike the mcpjson pair. */
const DENIED_KEY = "deniedMcpServers";
const PLUGINS_KEY = "enabledPlugins";
const SKILLS_KEY = "skillOverrides";
const HOOKS_KEY = "hooks";
const MARKETPLACES_KEY = "extraKnownMarketplaces";

const TEMPLATES: Record<string, { file: (root: string) => string; body: string; what: string }> = {
	"project-local-instructions": {
		file: (root) => join(root, "CLAUDE.local.md"),
		what: "personal notes for this project that are not shared",
		body: [
			"# Local notes",
			"",
			"Instructions for this project that only apply on this machine: the toolchain installed here,",
			"local ports, scratch paths.",
			"",
		].join("\n"),
	},
	"project-instructions": {
		file: (root) => join(root, "CLAUDE.md"),
		what: "shared instructions for everyone on this project",
		body: ["# Project instructions", "", "How Claude should work in this repository.", ""].join(
			"\n",
		),
	},
};

function readIfPresent(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function settingsPathFor(root: string, scope: ClaudeWritableScope): string {
	const match = settingsPaths(root).find((entry) => entry.scope === scope);
	if (match) return match.path;
	// The resolver lists the files it reads; a scope missing from it has no settings file to write.
	if (scope === "user") return join(claudeHome(), "settings.json");
	throw new Error(`No settings file for scope: ${scope}`);
}

function targetPath(root: string, scope: ClaudeWritableScope, edit: ClaudeEdit): string {
	if (edit.kind === "file") {
		const template = TEMPLATES[edit.template];
		if (!template) throw new Error(`Unknown template: ${edit.template}`);
		return template.file(root);
	}
	// A server is never declared in settings.json — see SPEC.md.
	if (edit.kind === "mcp-add") {
		return scope === "project" ? join(root, ".mcp.json") : claudeStatePath();
	}
	if (edit.kind === "skill-create") {
		const name = skillDirName(edit.name);
		const home = scope === "user" ? claudeHome() : join(root, ".claude");
		return join(home, "skills", name, "SKILL.md");
	}
	return settingsPathFor(root, scope);
}

/** Claude Code addresses a skill by its directory, and reads its name from the frontmatter. */
function skillDirName(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (slug === "") throw new Error("A skill needs a name");
	return slug;
}

function skillBody(name: string, description: string): string {
	if (description.trim() === "")
		throw new Error("A skill needs a description — it is how Claude finds it");
	return [
		"---",
		`name: ${skillDirName(name)}`,
		`description: ${description.trim()}`,
		"---",
		"",
		`# ${name.trim()}`,
		"",
		"What to do, step by step.",
		"",
	].join("\n");
}

function marketplaceEntry(source: ClaudeMarketplaceSource): Record<string, unknown> {
	if (source.kind === "github") {
		if (!/^[^/\s]+\/[^/\s]+$/.test(source.repo.trim())) {
			throw new Error("A GitHub marketplace is owner/repo");
		}
		return { source: { source: "github", repo: source.repo.trim() } };
	}
	if (source.path.trim() === "") throw new Error("A directory marketplace needs a path");
	return { source: { source: "directory", path: source.path.trim() } };
}

/**
 * Hooks nest event → matcher group → commands, and a second hook on the same matcher joins that group
 * rather than opening a rival one — Claude Code runs every group that matches.
 */
function addHook(
	object: Record<string, unknown>,
	event: string,
	matcher: string,
	command: string,
): void {
	if (command.trim() === "") throw new Error("A hook needs a command to run");
	const hooks = branch(object, HOOKS_KEY);
	const existing = hooks[event];
	const groups = Array.isArray(existing) ? [...existing] : [];
	const target = groups.find(
		(group) =>
			typeof group === "object" &&
			group !== null &&
			((group as { matcher?: unknown }).matcher ?? "") === matcher,
	) as { hooks?: unknown } | undefined;
	const entry = { type: "command", command: command.trim() };
	if (target) {
		target.hooks = [...(Array.isArray(target.hooks) ? target.hooks : []), entry];
	} else {
		groups.push({ ...(matcher === "" ? {} : { matcher }), hooks: [entry] });
	}
	hooks[event] = groups;
}

function parseObject(raw: string): Record<string, unknown> {
	if (raw.trim() === "") return {};
	const parsed: unknown = JSON.parse(raw);
	if (!isObject(parsed)) throw new Error("That settings file is not a JSON object");
	return parsed;
}

function branch(object: Record<string, unknown>, key: string): Record<string, unknown> {
	const existing = object[key];
	if (isObject(existing)) return existing;
	const created: Record<string, unknown> = {};
	object[key] = created;
	return created;
}

function prune(object: Record<string, unknown>, key: string): void {
	const value = object[key];
	if (typeof value === "object" && value !== null && Object.keys(value).length === 0) {
		delete object[key];
	}
}

function setDotted(object: Record<string, unknown>, key: string, value: unknown): void {
	const parts = key.split(".");
	let cursor = object;
	for (const part of parts.slice(0, -1)) {
		const next = cursor[part];
		if (typeof next !== "object" || next === null || Array.isArray(next)) cursor[part] = {};
		cursor = cursor[part] as Record<string, unknown>;
	}
	const last = parts[parts.length - 1] as string;
	if (value === null) delete cursor[last];
	else cursor[last] = value;
}

function serverEntry(draft: ClaudeMcpServerDraft): Record<string, unknown> {
	const entry: Record<string, unknown> = { type: draft.transport };
	if (draft.transport === "stdio") {
		if (!draft.command || draft.command.trim() === "") {
			throw new Error("A stdio server needs a command to run");
		}
		entry.command = draft.command.trim();
		if (draft.args && draft.args.length > 0) entry.args = draft.args;
	} else {
		if (!draft.url || draft.url.trim() === "") {
			throw new Error(`A ${draft.transport} server needs a URL`);
		}
		entry.url = draft.url.trim();
		if (draft.headers && Object.keys(draft.headers).length > 0) entry.headers = draft.headers;
	}
	if (draft.env && Object.keys(draft.env).length > 0) entry.env = draft.env;
	return entry;
}

/** Where a server of a given scope is declared inside its file — `~/.claude.json` nests per project. */
function serverHome(
	object: Record<string, unknown>,
	scope: ClaudeWritableScope,
	root: string,
): Record<string, unknown> {
	if (scope === "local") return branch(branch(branch(object, "projects"), root), "mcpServers");
	return branch(object, "mcpServers");
}

function nextContent(
	existing: string,
	edit: ClaudeEdit,
	scope: ClaudeWritableScope,
	root: string,
): string {
	if (edit.kind === "file") {
		const template = TEMPLATES[edit.template];
		if (!template) throw new Error(`Unknown template: ${edit.template}`);
		return existing === "" ? template.body : existing;
	}
	if (edit.kind === "skill-create") {
		// A skill that already exists is someone's work; the pane offers to create one, never to replace one.
		return existing === "" ? skillBody(edit.name, edit.description) : existing;
	}
	const object = parseObject(existing);
	if (edit.kind === "setting") {
		setDotted(object, edit.key, edit.value);
	} else if (edit.kind === "mcp") {
		const denied = stringList(object[DENIED_KEY]);
		const without = denied.filter((name) => name !== edit.server);
		const next = edit.allowed ? without : [...without, edit.server];
		if (next.length > 0) object[DENIED_KEY] = next;
		else delete object[DENIED_KEY];
	} else if (edit.kind === "mcp-add") {
		if (edit.server.trim() === "") throw new Error("A server needs a name");
		serverHome(object, scope, root)[edit.server] = serverEntry(edit.draft);
	} else if (edit.kind === "plugin") {
		branch(object, PLUGINS_KEY)[edit.name] = edit.enabled;
	} else if (edit.kind === "plugin-add") {
		if (edit.marketplace.trim() === "" || edit.plugin.trim() === "") {
			throw new Error("A plugin needs a marketplace and a name");
		}
		branch(object, MARKETPLACES_KEY)[edit.marketplace.trim()] = marketplaceEntry(edit.source);
		branch(object, PLUGINS_KEY)[`${edit.plugin.trim()}@${edit.marketplace.trim()}`] = true;
	} else if (edit.kind === "hook") {
		addHook(object, edit.event, edit.matcher.trim(), edit.command);
	} else {
		// An override is only ever a switch-off: re-enabling is the absence of one, not `"on"` written back.
		if (edit.enabled) {
			delete branch(object, SKILLS_KEY)[edit.name];
			prune(object, SKILLS_KEY);
		} else {
			branch(object, SKILLS_KEY)[edit.name] = "off";
		}
	}
	return formatJson(existing, object);
}

function describe(edit: ClaudeEdit, scope: ClaudeWritableScope): string {
	const who = CLAUDE_SCOPE_WORDING[scope];
	if (edit.kind === "mcp") {
		return edit.allowed
			? `Stop denying the MCP server "${edit.server}" — affects ${who}.`
			: `Deny the MCP server "${edit.server}" — affects ${who}.`;
	}
	if (edit.kind === "mcp-add") {
		return `Add the MCP server "${edit.server}" — affects ${who}.`;
	}
	if (edit.kind === "plugin") {
		return edit.enabled
			? `Turn on the plugin "${edit.name}" — affects ${who}.`
			: `Turn off the plugin "${edit.name}" — affects ${who}.`;
	}
	if (edit.kind === "plugin-add") {
		return `Add the plugin "${edit.plugin}" from "${edit.marketplace}" — affects ${who}.`;
	}
	if (edit.kind === "hook") {
		return `Run \`${edit.command}\` on ${edit.event}${edit.matcher ? ` for ${edit.matcher}` : ""} — affects ${who}.`;
	}
	if (edit.kind === "skill-create") {
		return `Create the skill "${edit.name}" — affects ${who}.`;
	}
	if (edit.kind === "skill") {
		return edit.enabled
			? `Stop overriding the skill "${edit.name}" — affects ${who}.`
			: `Turn off the skill "${edit.name}" — affects ${who}.`;
	}
	if (edit.kind === "setting") {
		return edit.value === null
			? `Remove "${edit.key}" — affects ${who}.`
			: `Set "${edit.key}" to ${JSON.stringify(edit.value)} — affects ${who}.`;
	}
	const template = TEMPLATES[edit.template];
	return `Create ${template ? template.what : edit.template} — affects ${who}.`;
}

/** The resolved settings key an edit competes on, or null for an edit precedence does not arbitrate. */
function contestedKey(edit: ClaudeEdit): string | null {
	if (edit.kind === "setting") return edit.key;
	if (edit.kind === "mcp") return DENIED_KEY;
	if (edit.kind === "plugin") return `${PLUGINS_KEY}.${edit.name}`;
	if (edit.kind === "skill") return `${SKILLS_KEY}.${edit.name}`;
	return null;
}

/**
 * What a higher-precedence file already decides, so the user is told before writing something inert.
 *
 * Warn, never refuse: a losing file can still be the one worth editing — preparing a project setting
 * while a managed policy is in force is a real thing to want.
 */
function conflictWarnings(
	workspaceId: string,
	root: string,
	scope: ClaudeWritableScope,
	edit: ClaudeEdit,
): string[] {
	const snapshot = resolveClaudeConfig(workspaceId, root);

	if (edit.kind === "mcp-add") {
		const clash = snapshot.capabilities.find(
			(item) => item.kind === "mcp" && item.name === edit.server,
		);
		return clash
			? [
					`A server called "${edit.server}" is already declared in ${clash.origin.scope} scope — Claude Code will use one of the two, and which one is not something this pane can promise.`,
				]
			: [];
	}

	const key = contestedKey(edit);
	if (key === null) return [];
	const resolved = snapshot.settings.find((entry) => entry.key === key);
	if (!resolved || resolved.origin.scope === scope) return [];
	const order = ["managed", "local", "project", "user", "default"];
	const wins = order.indexOf(resolved.origin.scope) < order.indexOf(scope);
	if (!wins) return [];
	return [
		`"${key}" is already set in ${resolved.origin.scope} settings, which wins over ${scope} — this change will have no effect until that one changes.`,
	];
}

function requireScope(request: ClaudeEditRequest): void {
	if (!claudeEditScopes(request.edit).includes(request.scope)) {
		throw new Error(`That change cannot be written to ${request.scope} settings`);
	}
}

export function planClaudeEdit(request: ClaudeEditRequest, root: string): ClaudeEditPlan {
	requireScope(request);
	const path = targetPath(root, request.scope, request.edit);
	const existing = readIfPresent(path);
	const updated = nextContent(existing, request.edit, request.scope, root);
	return {
		path,
		exists: existsSync(path),
		summary: describe(request.edit, request.scope),
		diff: diffLines(existing, updated),
		warnings: conflictWarnings(request.workspaceId, root, request.scope, request.edit),
		baseHash: hashOf(existing),
		changes: updated !== existing,
	};
}

export function applyClaudeEdit(
	request: ClaudeEditRequest & { baseHash: string },
	root: string,
): ClaudeEditPlan {
	requireScope(request);
	const path = targetPath(root, request.scope, request.edit);
	const existing = readIfPresent(path);
	// The approval was given for a diff against this exact content; if the file moved since, the diff the
	// user approved is not the change that would land.
	if (hashOf(existing) !== request.baseHash) {
		throw new Error("That file changed since the diff was shown — review it again");
	}
	const updated = nextContent(existing, request.edit, request.scope, root);
	if (updated !== existing) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, updated, "utf8");
	}
	return planClaudeEdit(request, root);
}
