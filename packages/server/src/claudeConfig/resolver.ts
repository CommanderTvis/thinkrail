import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
	ClaudeCapability,
	ClaudeConfigOrigin,
	ClaudeConfigProblem,
	ClaudeConfigScope,
	ClaudeConfigSnapshot,
	ClaudeContextLayer,
	FileWriteResult,
} from "@thinkrail/contracts";
import { readFileAt, writeFileAt } from "../fs";
import { isObject, stringList } from "./json";
import { resolveSettings, type ScopedDocument } from "./merge";
import {
	agentDirs,
	claudeStatePath,
	instructionPaths,
	mcpPaths,
	memoryIndexPath,
	rulesDirs,
	type ScopedPath,
	settingsPaths,
	skillDirs,
} from "./paths";
import { CLAUDE_SETTINGS_DOC_KEYS, settingsDocsUrl } from "./settingsDocs";

function readJson(path: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function sizeOf(path: string): number | null {
	try {
		return statSync(path).size;
	} catch {
		return null;
	}
}

function listFiles(dir: string, extension: string): string[] {
	try {
		return readdirSync(dir)
			.filter((name) => name.endsWith(extension))
			.map((name) => join(dir, name))
			.sort();
	} catch {
		return [];
	}
}

function listDirs(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

function frontmatterGlobs(path: string): string[] | null {
	try {
		const head = readFileSync(path, "utf8").slice(0, 2048);
		const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
		if (!block) return null;
		const paths = /^paths:\s*(.+)$/m.exec(block[1] ?? "");
		if (!paths) return null;
		return (paths[1] ?? "")
			.replace(/^\[|\]$/g, "")
			.split(",")
			.map((glob) => glob.trim().replace(/^["']|["']$/g, ""))
			.filter((glob) => glob !== "");
	} catch {
		return null;
	}
}

const MAX_IMPORT_DEPTH = 4;

const IMPORT_RE = /^\s*@([^\s`]+)\s*$/gm;

function expandImports(
	path: string,
	scope: ClaudeConfigScope,
	depth: number,
	seen: Set<string>,
): ClaudeContextLayer[] {
	if (depth >= MAX_IMPORT_DEPTH) return [];
	let body: string;
	try {
		body = readFileSync(path, "utf8");
	} catch {
		return [];
	}

	const layers: ClaudeContextLayer[] = [];
	IMPORT_RE.lastIndex = 0;
	let match = IMPORT_RE.exec(body);
	while (match !== null) {
		const raw = match[1] ?? "";
		const target = raw.startsWith("~/")
			? join(homedir(), raw.slice(2))
			: raw.startsWith("/")
				? raw
				: join(dirname(path), raw);
		match = IMPORT_RE.exec(body);
		if (seen.has(target)) continue;
		seen.add(target);
		const bytes = sizeOf(target);
		if (bytes === null) continue;
		layers.push({
			kind: "import",
			label: basename(target),
			path: target,
			origin: { scope, path: target },
			bytes,
			depth: depth + 1,
		});
		layers.push(...expandImports(target, scope, depth + 1, seen));
	}
	return layers;
}

function contextLayer(
	kind: ClaudeContextLayer["kind"],
	label: string,
	{ scope, path }: ScopedPath,
): ClaudeContextLayer | null {
	const bytes = sizeOf(path);
	if (bytes === null) return null;
	return {
		kind,
		label,
		path,
		origin: { scope, path },
		bytes,
	};
}

function collectContext(root: string): ClaudeContextLayer[] {
	const layers: ClaudeContextLayer[] = [];

	for (const entry of instructionPaths(root)) {
		const kind = entry.path.endsWith("CLAUDE.local.md") ? "local-instructions" : "instructions";
		const layer = contextLayer(kind, basename(entry.path), entry);
		if (!layer) continue;
		layers.push(layer);
		layers.push(...expandImports(entry.path, entry.scope, 0, new Set([entry.path])));
	}

	for (const dir of rulesDirs(root)) {
		for (const path of listFiles(dir.path, ".md")) {
			const layer = contextLayer("rules", basename(path), { scope: dir.scope, path });
			if (!layer) continue;
			const globs = frontmatterGlobs(path);
			// A rule with `paths:` only enters context when Claude reads a matching file, so the pane must not present it as always-on weight.
			if (globs && globs.length > 0) layers.push({ ...layer, pathGlobs: globs, lazy: true });
			else layers.push(layer);
		}
	}

	const memory = contextLayer("memory", "MEMORY.md", {
		scope: "user",
		path: memoryIndexPath(root),
	});
	if (memory) layers.push(memory);

	return layers;
}

/** The first scope that switches something off. `documents` arrives highest-precedence first. */
function switchedOffBy(
	documents: readonly ScopedDocument[],
	holds: (data: Record<string, unknown>) => readonly string[] | null,
	keyPath: (name: string) => string[],
	name: string,
): ClaudeConfigOrigin | undefined {
	for (const doc of documents) {
		const listed = holds(doc.data);
		if (listed?.includes(name)) return { ...doc.origin, keyPath: keyPath(name) };
	}
	return undefined;
}

function mcpDenial(
	documents: readonly ScopedDocument[],
	name: string,
	fromProjectFile: boolean,
): ClaudeConfigOrigin | undefined {
	const denied = switchedOffBy(
		documents,
		(data) => stringList(data.deniedMcpServers),
		() => ["deniedMcpServers"],
		name,
	);
	if (denied || !fromProjectFile) return denied;
	// `.mcp.json` servers answer to a second switch that no other server does.
	return switchedOffBy(
		documents,
		(data) => stringList(data.disabledMcpjsonServers),
		() => ["disabledMcpjsonServers"],
		name,
	);
}

function skillOverride(
	documents: readonly ScopedDocument[],
	name: string,
): ClaudeConfigOrigin | undefined {
	for (const doc of documents) {
		const overrides = doc.data.skillOverrides;
		if (isObject(overrides) && overrides[name] === "off") {
			return { ...doc.origin, keyPath: ["skillOverrides", name] };
		}
	}
	return undefined;
}

function withState(
	capability: ClaudeCapability,
	disabledBy: ClaudeConfigOrigin | undefined,
): ClaudeCapability {
	return disabledBy ? { ...capability, enabled: false, disabledBy } : capability;
}

function collectCapabilities(
	root: string,
	documents: readonly ScopedDocument[],
): ClaudeCapability[] {
	const capabilities: ClaudeCapability[] = [];

	for (const entry of mcpPaths(root)) {
		const servers = readJson(entry.path)?.mcpServers;
		if (typeof servers !== "object" || servers === null) continue;
		for (const [name, config] of Object.entries(servers as Record<string, unknown>)) {
			const transport =
				typeof config === "object" && config !== null
					? ((config as { type?: unknown }).type ?? "stdio")
					: "stdio";
			capabilities.push(
				withState(
					{
						kind: "mcp",
						name,
						origin: { scope: entry.scope, path: entry.path, keyPath: ["mcpServers", name] },
						enabled: true,
						detail: String(transport),
					},
					mcpDenial(documents, name, true),
				),
			);
		}
	}

	// User-scope MCP servers live in ~/.claude.json, not in settings.json — the single sharpest trap in the whole surface, so the pane sources them from the file that actually holds them.
	const statePath = claudeStatePath();
	const state = readJson(statePath);
	const userServers = state?.mcpServers;
	if (isObject(userServers)) {
		for (const name of Object.keys(userServers)) {
			capabilities.push(
				withState(
					{
						kind: "mcp",
						name,
						origin: { scope: "user", path: statePath, keyPath: ["mcpServers", name] },
						enabled: true,
						detail: "user scope",
					},
					mcpDenial(documents, name, false),
				),
			);
		}
	}

	// The same file's per-project block is where Claude Code's "local" servers live.
	const projects = state?.projects;
	const localServers = isObject(projects) ? projects[root] : undefined;
	const localMcp = isObject(localServers) ? localServers.mcpServers : undefined;
	if (isObject(localMcp)) {
		for (const name of Object.keys(localMcp)) {
			capabilities.push(
				withState(
					{
						kind: "mcp",
						name,
						origin: {
							scope: "local",
							path: statePath,
							keyPath: ["projects", root, "mcpServers", name],
						},
						enabled: true,
						detail: "this project only",
					},
					mcpDenial(documents, name, false),
				),
			);
		}
	}

	for (const dirs of [skillDirs(root), agentDirs(root)]) {
		for (const dir of dirs) {
			const isSkill = dir.path.endsWith("skills");
			const names = isSkill
				? listDirs(dir.path)
				: listFiles(dir.path, ".md").map((path) => basename(path));
			for (const name of names) {
				const label = name.replace(/\.md$/, "");
				capabilities.push(
					withState(
						{
							kind: isSkill ? "skill" : "agent",
							name: label,
							origin: { scope: dir.scope, path: join(dir.path, name) },
							enabled: true,
						},
						isSkill ? skillOverride(documents, label) : undefined,
					),
				);
			}
		}
	}

	return capabilities;
}

/**
 * Hooks are the sharpest thing in this file — a matched event runs a shell command — so the pane lists
 * every one with the command it runs and the file it came from.
 */
function collectHooks(documents: readonly ScopedDocument[]): ClaudeCapability[] {
	const off = documents.find((doc) => doc.data.disableAllHooks === true);
	const capabilities: ClaudeCapability[] = [];
	for (const doc of documents) {
		const hooks = doc.data.hooks;
		if (!isObject(hooks)) continue;
		for (const [event, groups] of Object.entries(hooks)) {
			if (!Array.isArray(groups)) continue;
			for (const group of groups) {
				if (!isObject(group)) continue;
				const matcher = typeof group.matcher === "string" ? group.matcher : "";
				const entries = Array.isArray(group.hooks) ? group.hooks : [];
				for (const entry of entries) {
					const command = isObject(entry) && typeof entry.command === "string" ? entry.command : "";
					capabilities.push(
						withState(
							{
								kind: "hook",
								name: matcher === "" ? event : `${event} · ${matcher}`,
								origin: { ...doc.origin, keyPath: ["hooks", event] },
								enabled: true,
								...(command === "" ? {} : { detail: command }),
							},
							off ? { ...off.origin, keyPath: ["disableAllHooks"] } : undefined,
						),
					);
				}
			}
		}
	}
	return capabilities;
}

function marketplaceDetail(entry: unknown): string | undefined {
	if (typeof entry !== "object" || entry === null) return undefined;
	const source = (entry as Record<string, unknown>).source;
	if (typeof source === "string") return source;
	if (typeof source !== "object" || source === null) return undefined;
	const record = source as Record<string, unknown>;
	for (const key of ["repo", "url", "path", "source"]) {
		const value = record[key];
		if (typeof value === "string" && value !== "") return value;
	}
	return undefined;
}

/** The catalogs plugins come from, as first-class rows instead of flattened settings keys. */
function collectMarketplaces(documents: readonly ScopedDocument[]): ClaudeCapability[] {
	const marketplaces: ClaudeCapability[] = [];
	const seen = new Set<string>();
	for (const doc of documents) {
		const known = doc.data.extraKnownMarketplaces;
		if (typeof known !== "object" || known === null) continue;
		for (const [name, entry] of Object.entries(known as Record<string, unknown>)) {
			if (seen.has(name)) continue;
			seen.add(name);
			const detail = marketplaceDetail(entry);
			marketplaces.push({
				kind: "marketplace",
				name,
				origin: { ...doc.origin, keyPath: ["extraKnownMarketplaces", name] },
				enabled: true,
				...(detail ? { detail } : {}),
			});
		}
	}
	return marketplaces;
}

function collectPlugins(documents: readonly ScopedDocument[]): ClaudeCapability[] {
	const plugins: ClaudeCapability[] = [];
	const seen = new Set<string>();
	for (const doc of documents) {
		const enabled = doc.data.enabledPlugins;
		if (typeof enabled !== "object" || enabled === null) continue;
		for (const [name, on] of Object.entries(enabled as Record<string, unknown>)) {
			if (seen.has(name)) continue;
			seen.add(name);
			const marketplace = name.split("@")[1];
			plugins.push({
				kind: "plugin",
				name,
				origin: { ...doc.origin, keyPath: ["enabledPlugins", name] },
				enabled: on === true,
				...(marketplace ? { detail: marketplace } : {}),
				...(on === true
					? {}
					: { disabledBy: { ...doc.origin, keyPath: ["enabledPlugins", name] } }),
			});
		}
	}
	return plugins;
}

function detectProblems(
	root: string,
	inspected: ClaudeConfigSnapshot["inspected"],
): ClaudeConfigProblem[] {
	const problems: ClaudeConfigProblem[] = [];

	for (const entry of inspected) {
		if (!entry.exists || !entry.path.endsWith(".json")) continue;
		if (readJson(entry.path) === null) {
			problems.push({
				severity: "warning",
				title: "Unreadable settings file",
				detail: "This file is not valid JSON, so Claude Code cannot apply anything in it.",
				path: entry.path,
			});
		}
	}

	void root;
	return problems;
}

/**
 * Read one file the pane links to. Claude's configuration lives largely outside any worktree, so the
 * worktree-scoped `fs.readFile` cannot serve these — and rather than widen that boundary, this reads only
 * paths the resolver itself just reported, which is what keeps an arbitrary absolute path from being
 * readable through this method. See SPEC.md.
 */
export function claudeConfigFilePath(workspaceId: string, root: string, path: string): string {
	const snapshot = resolveClaudeConfig(workspaceId, root);
	const allowed = new Set<string>(snapshot.inspected.map((entry) => entry.path));
	for (const layer of snapshot.context) allowed.add(layer.path);
	for (const capability of snapshot.capabilities) {
		if (capability.origin.path) allowed.add(capability.origin.path);
	}
	for (const setting of snapshot.settings) {
		if (setting.origin.path) allowed.add(setting.origin.path);
		for (const shadow of setting.shadowed) {
			if (shadow.origin.path) allowed.add(shadow.origin.path);
		}
	}
	if (!allowed.has(path))
		throw new Error("Not a file this workspace's Claude configuration reports");
	return path;
}

export function readClaudeConfigFile(
	workspaceId: string,
	root: string,
	path: string,
): { content: string; hash: string } {
	return readFileAt(claudeConfigFilePath(workspaceId, root, path));
}

export function writeClaudeConfigFile(
	workspaceId: string,
	root: string,
	path: string,
	content: string,
	baseHash: string,
): FileWriteResult {
	return writeFileAt(claudeConfigFilePath(workspaceId, root, path), content, baseHash);
}

export function resolveClaudeConfig(workspaceId: string, root: string): ClaudeConfigSnapshot {
	const scoped = settingsPaths(root);
	const inspected: ClaudeConfigSnapshot["inspected"] = scoped.map((entry) => ({
		path: entry.path,
		scope: entry.scope as ClaudeConfigScope,
		exists: existsSync(entry.path),
	}));

	const documents: ScopedDocument[] = [];
	for (const entry of scoped) {
		const data = readJson(entry.path);
		if (data) documents.push({ origin: { scope: entry.scope, path: entry.path }, data });
	}

	return {
		workspaceId,
		root,
		context: collectContext(root),
		settings: resolveSettings(documents).map((entry) => {
			const docsUrl = settingsDocsUrl(entry.key);
			return docsUrl ? { ...entry, docsUrl } : entry;
		}),
		capabilities: [
			...collectCapabilities(root, documents),
			...collectPlugins(documents),
			...collectMarketplaces(documents),
			...collectHooks(documents),
		],
		problems: detectProblems(root, inspected),
		inspected,
		knownSettingKeys: CLAUDE_SETTINGS_DOC_KEYS,
	};
}
