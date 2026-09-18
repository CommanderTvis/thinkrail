import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { codexEnumValues } from "../configDocs";
import type {
	CodexConfigSnapshot,
	CodexInstructions,
	CodexInstructionsTarget,
	CodexLayer,
	CodexMcpServer,
	CodexScope,
	CodexSetting,
	CodexValue,
	CodexWritableScope,
} from "../contracts";

type Table = Record<string, unknown>;

export const HOOK_EVENTS = [
	"SessionStart",
	"UserPromptSubmit",
	"PostToolUse",
	"PermissionRequest",
	"Stop",
	"Interrupt",
] as const;

export const STATUS_URL_ENV = "THINKRAIL_CODEX_STATUS_URL";

export const HOOK_COMMAND = `[ -z "$${STATUS_URL_ENV}" ] || curl -fsS -m 2 -H 'content-type: application/json' --data-binary @- "$${STATUS_URL_ENV}" >/dev/null 2>&1; true`;

export function codexHome(): string {
	return process.env.CODEX_HOME || join(homedir(), ".codex");
}

export function layerPath(scope: CodexScope, worktreePath: string): string {
	if (scope === "project") return join(worktreePath, ".codex", "config.toml");
	if (scope === "user") return join(codexHome(), "config.toml");
	return "/etc/codex/config.toml";
}

function isTable(value: unknown): value is Table {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readToml(path: string): { exists: boolean; table: Table; error?: string } {
	if (!existsSync(path)) return { exists: false, table: {} };
	try {
		const parsed: unknown = Bun.TOML.parse(readFileSync(path, "utf8"));
		return { exists: true, table: isTable(parsed) ? parsed : {} };
	} catch (err) {
		return { exists: true, table: {}, error: err instanceof Error ? err.message : String(err) };
	}
}

function isTrusted(user: Table, worktreePath: string): boolean {
	const projects = user.projects;
	if (!isTable(projects)) return false;
	return Object.entries(projects).some(([path, entry]) => {
		if (!isTable(entry) || entry.trust_level !== "trusted") return false;
		return worktreePath === path || worktreePath.startsWith(path.endsWith(sep) ? path : path + sep);
	});
}

function firstNonEmpty(dir: string, names: readonly string[]): string | null {
	for (const name of names) {
		const path = join(dir, name);
		try {
			if (statSync(path).size > 0) return path;
		} catch {}
	}
	return null;
}

function instructionsOf(worktreePath: string, fallbacks: readonly string[]): CodexInstructions[] {
	const found: CodexInstructions[] = [];
	const global = firstNonEmpty(codexHome(), ["AGENTS.override.md", "AGENTS.md"]);
	if (global) found.push({ scope: "global", path: global, bytes: statSync(global).size });
	const project = firstNonEmpty(worktreePath, ["AGENTS.override.md", "AGENTS.md", ...fallbacks]);
	if (project) {
		found.push({
			scope: "project",
			path: project,
			relativePath: relative(worktreePath, project),
			bytes: statSync(project).size,
		});
	}
	return found;
}

function hooksPath(): string {
	return join(codexHome(), "hooks.json");
}

function readHooksFile(): Table {
	try {
		const parsed: unknown = JSON.parse(readFileSync(hooksPath(), "utf8"));
		return isTable(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function hasOurHook(groups: unknown): boolean {
	return (
		Array.isArray(groups) &&
		groups.some(
			(group) =>
				isTable(group) &&
				Array.isArray(group.hooks) &&
				group.hooks.some((hook) => isTable(hook) && hook.command === HOOK_COMMAND),
		)
	);
}

export function hooksInstalled(): boolean {
	const hooks = readHooksFile().hooks;
	return isTable(hooks) && HOOK_EVENTS.every((event) => hasOurHook(hooks[event]));
}

export function hooksTrusted(): boolean {
	const state = readToml(layerPath("user", "")).table.hooks;
	const trusted = isTable(state) && isTable(state.state) ? Object.keys(state.state) : [];
	return trusted.some((key) => key.startsWith(`${hooksPath()}:`));
}

const INSTRUCTIONS_STARTER = "# Instructions for Codex\n\n";

export function createInstructions(
	worktreePath: string,
	target: CodexInstructionsTarget,
): { path: string; relativePath?: string } {
	const path =
		target === "global"
			? join(codexHome(), "AGENTS.md")
			: join(worktreePath, target === "project" ? "AGENTS.md" : "AGENTS.override.md");
	if (!existsSync(path) || statSync(path).size === 0) writeAtomic(path, INSTRUCTIONS_STARTER);
	return target === "global" ? { path } : { path, relativePath: relative(worktreePath, path) };
}

export function installHooks(): void {
	const file = readHooksFile();
	const hooks: Table = isTable(file.hooks) ? file.hooks : {};
	for (const event of HOOK_EVENTS) {
		const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
		if (!hasOurHook(groups)) groups.push({ hooks: [{ type: "command", command: HOOK_COMMAND }] });
		hooks[event] = groups;
	}
	writeAtomic(hooksPath(), `${JSON.stringify({ ...file, hooks }, null, 2)}\n`);
}

function writeAtomic(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.thinkrail-${process.pid}`;
	writeFileSync(temp, content);
	renameSync(temp, path);
}

const HIDDEN_TABLES: readonly (readonly string[])[] = [["hooks", "state"], ["projects"]];

function flatten(value: unknown, keyPath: string[]): [string[], unknown][] {
	if (HIDDEN_TABLES.some((hidden) => samePath(hidden, keyPath))) return [];
	if (!isTable(value)) return [[keyPath, value]];
	return Object.entries(value).flatMap(([key, child]) => flatten(child, [...keyPath, key]));
}

export function resolveCodexConfig(worktreePath: string): CodexConfigSnapshot {
	const system = readToml(layerPath("system", worktreePath));
	const user = readToml(layerPath("user", worktreePath));
	const project = readToml(layerPath("project", worktreePath));
	const projectTrusted = isTrusted(user.table, worktreePath);

	const ordered: { scope: CodexScope; read: ReturnType<typeof readToml>; ignored: boolean }[] = [
		{ scope: "project", read: project, ignored: !projectTrusted },
		{ scope: "user", read: user, ignored: false },
		{ scope: "system", read: system, ignored: false },
	];
	const layers: CodexLayer[] = ordered.map(({ scope, read, ignored }) => ({
		scope,
		path: layerPath(scope, worktreePath),
		exists: read.exists,
		ignored: read.exists && ignored,
		...(read.error ? { error: read.error } : {}),
	}));
	const active = ordered.filter((layer) => !layer.ignored);

	const settings = new Map<string, CodexSetting>();
	const mcpServers = new Map<string, CodexMcpServer>();
	for (const { scope, read } of active) {
		const path = layerPath(scope, worktreePath);
		for (const [key, value] of Object.entries(read.table)) {
			if (isTable(value) && key === "mcp_servers") {
				for (const [name, server] of Object.entries(value)) {
					if (mcpServers.has(name) || !isTable(server)) continue;
					const target =
						typeof server.url === "string"
							? server.url
							: [server.command, ...(Array.isArray(server.args) ? server.args : [])].join(" ");
					mcpServers.set(name, { name, scope, path, target });
				}
				continue;
			}
			for (const [keyPath, leaf] of flatten(value, [key])) {
				const dotted = keyPath.map(formatKeySegment).join(".");
				const existing = settings.get(dotted);
				if (existing) existing.shadowed.push({ value: leaf, scope, path });
				else settings.set(dotted, { key: dotted, keyPath, value: leaf, scope, path, shadowed: [] });
			}
		}
	}

	const fallbacks = settings.get("project_doc_fallback_filenames")?.value;
	return {
		home: codexHome(),
		layers,
		settings: [...settings.values()].sort((a, b) => a.key.localeCompare(b.key)),
		mcpServers: [...mcpServers.values()],
		instructions: instructionsOf(
			worktreePath,
			Array.isArray(fallbacks) ? fallbacks.filter((name) => typeof name === "string") : [],
		),
		projectTrusted,
		hooksInstalled: hooksInstalled(),
		hooksTrusted: hooksTrusted(),
	};
}

export function formatKeySegment(segment: string): string {
	return /^[A-Za-z0-9_-]+$/.test(segment) ? segment : JSON.stringify(segment);
}

function parseKeySegments(text: string): string[] | null {
	const segments: string[] = [];
	const pattern = /\s*(?:([A-Za-z0-9_-]+)|"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(\.|$)/y;
	let at = 0;
	while (at < text.length) {
		pattern.lastIndex = at;
		const match = pattern.exec(text);
		if (!match) return null;
		segments.push(
			match[1] ?? (match[2] !== undefined ? JSON.parse(`"${match[2]}"`) : (match[3] ?? "")),
		);
		at = pattern.lastIndex;
		if (match[4] === "") break;
	}
	return segments;
}

function headerOf(line: string): string[] | "array" | null {
	const trimmed = line.trim();
	if (trimmed.startsWith("[[")) return "array";
	const match = /^\[(.*)\]\s*(#.*)?$/.exec(trimmed);
	return match ? parseKeySegments(match[1] ?? "") : null;
}

function leafKeyOf(line: string): string[] | null {
	const cut = line.indexOf("=");
	if (cut === -1 || /^\s*(#|\[)/.test(line)) return null;
	return parseKeySegments(line.slice(0, cut));
}

const samePath = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((segment, index) => segment === b[index]);

function withValue(table: Table, keyPath: readonly string[], value: CodexValue | null): Table {
	const [head, ...rest] = keyPath;
	if (head === undefined) return table;
	const next: Table = { ...table };
	if (rest.length === 0) {
		if (value === null) delete next[head];
		else next[head] = value;
		return next;
	}
	const child = isTable(table[head]) ? (table[head] as Table) : {};
	next[head] = withValue(child, rest, value);
	return next;
}

export function setKeyPath(
	text: string,
	keyPath: readonly string[],
	value: CodexValue | null,
): string {
	const table = keyPath.slice(0, -1);
	const leaf = keyPath.at(-1) ?? "";
	const lines = text.split("\n");

	let start = table.length === 0 ? 0 : -1;
	let end = lines.length;
	let current: string[] | "array" = [];
	for (let index = 0; index < lines.length; index += 1) {
		const header = headerOf(lines[index] ?? "");
		if (header === null) continue;
		if (start !== -1 && index >= start) {
			end = index;
			break;
		}
		current = header;
		if (current !== "array" && samePath(current, table)) start = index + 1;
	}

	const line = value === null ? null : `${formatKeySegment(leaf)} = ${JSON.stringify(value)}`;
	if (start === -1) {
		if (line === null) return text;
		const body = text.replace(/\n*$/, "");
		const header = `[${table.map(formatKeySegment).join(".")}]`;
		return `${body}${body ? "\n\n" : ""}${header}\n${line}\n`;
	}
	const section = lines.slice(start, end);
	const at = section.findIndex((candidate) => {
		const key = leafKeyOf(candidate);
		return key !== null && samePath(key, [leaf]);
	});
	if (at !== -1) {
		if (line === null) lines.splice(start + at, 1);
		else lines[start + at] = line;
	} else if (line !== null) {
		let insertAt = end;
		while (insertAt > start && lines[insertAt - 1]?.trim() === "") insertAt -= 1;
		lines.splice(insertAt, 0, line);
	}
	const next = lines.join("\n");

	const expected = withValue(Bun.TOML.parse(text) as Table, keyPath, value);
	let after: unknown = null;
	try {
		after = Bun.TOML.parse(next);
	} catch {}
	if (!isDeepStrictEqual(after, expected)) {
		throw new Error(`Couldn't edit ${keyPath.join(".")} in place — edit the file by hand`);
	}
	return next;
}

export function writeCodexValue(
	worktreePath: string,
	scope: CodexWritableScope,
	keyPath: readonly string[],
	value: CodexValue | null,
): void {
	const key = keyPath.join(".");
	const allowed = codexEnumValues(key);
	if (allowed && value !== null && (typeof value !== "string" || !allowed.includes(value))) {
		throw new Error(`${key} must be one of ${allowed.join(", ")}`);
	}
	const path = layerPath(scope, worktreePath);
	const text = existsSync(path) ? readFileSync(path, "utf8") : "";
	writeAtomic(path, setKeyPath(text, keyPath, value));
}
