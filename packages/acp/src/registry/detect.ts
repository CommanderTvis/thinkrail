import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { AgentRegistryEntry, DetectedAgent } from "@thinkrail/contracts";
import type { AgentCatalogEntry } from "./types";

export const DETECTION_SHORTLIST = [
	"junie",
	"claude-acp",
	"codex-acp",
	"gemini",
	"github-copilot-cli",
	"cursor",
	"opencode",
	"goose",
] as const;

export type DetectionQuery =
	| { kind: "command"; name: string }
	| { kind: "globalPackage"; runner: "npx" | "uvx"; package: string };

export type DetectionProbe = (query: DetectionQuery) => Promise<string | null>;

export interface DetectAgentsOptions {
	entries: readonly AgentRegistryEntry[];
	catalog: readonly AgentCatalogEntry[];
	probe?: DetectionProbe;
	shortlist?: readonly string[];
}

const LAUNCHER_EXTENSIONS = [".exe", ".cmd", ".bat", ".ps1"];

function baseCommandName(command: string): string {
	const base = command.split(/[/\\]/).pop() ?? command;
	const dot = base.lastIndexOf(".");
	if (dot <= 0) return base;
	return LAUNCHER_EXTENSIONS.includes(base.slice(dot).toLowerCase()) ? base.slice(0, dot) : base;
}

function packageName(spec: string): string {
	const at = spec.lastIndexOf("@");
	return at > 0 ? spec.slice(0, at) : spec;
}

function searchDirs(): string[] {
	const home = homedir();
	const fromPath = (process.env.PATH ?? "").split(delimiter).filter((dir) => dir.length > 0);
	return [
		...new Set([
			...fromPath,
			join(home, ".local", "bin"),
			join(home, "bin"),
			join(home, ".bun", "bin"),
			join(home, ".cargo", "bin"),
			join(home, ".npm-global", "bin"),
			join(home, ".local", "share", "JetBrains", "Toolbox", "scripts"),
			join(home, "Library", "Application Support", "JetBrains", "Toolbox", "scripts"),
			"/usr/local/bin",
			"/opt/homebrew/bin",
		]),
	];
}

function executableNames(name: string): string[] {
	if (process.platform !== "win32") return [name];
	const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
		.split(";")
		.filter((extension) => extension.length > 0)
		.map((extension) => `${name}${extension.toLowerCase()}`);
	return [...extensions, name];
}

async function reachable(path: string, mode: number): Promise<boolean> {
	try {
		await access(path, mode);
		return true;
	} catch {
		return false;
	}
}

async function findExecutable(name: string): Promise<string | null> {
	const mode = process.platform === "win32" ? constants.F_OK : constants.X_OK;
	for (const dir of searchDirs()) {
		for (const candidate of executableNames(name)) {
			const path = join(dir, candidate);
			if (await reachable(path, mode)) return path;
		}
	}
	return null;
}

function globalRoots(runner: "npx" | "uvx", runnerPath: string): string[] {
	const home = homedir();
	if (runner === "uvx") {
		const configured = process.env.UV_TOOL_DIR;
		const roots = [join(home, ".local", "share", "uv", "tools")];
		if (configured !== undefined) roots.unshift(configured);
		return [...new Set(roots)];
	}
	const prefix = process.env.npm_config_prefix;
	const roots = [
		join(dirname(runnerPath), "..", "lib", "node_modules"),
		join(home, ".npm-global", "lib", "node_modules"),
		join(home, ".bun", "install", "global", "node_modules"),
		"/usr/local/lib/node_modules",
		"/opt/homebrew/lib/node_modules",
	];
	if (prefix !== undefined) roots.unshift(join(prefix, "lib", "node_modules"));
	return [...new Set(roots)];
}

export const systemProbe: DetectionProbe = async (query) => {
	if (query.kind === "command") return findExecutable(query.name);
	const runnerPath = await findExecutable(query.runner);
	if (runnerPath === null) return null;
	const segments = query.runner === "npx" ? query.package.split("/") : [query.package];
	for (const root of globalRoots(query.runner, runnerPath)) {
		if (await reachable(join(root, ...segments), constants.F_OK)) return runnerPath;
	}
	return null;
};

async function detectOne(
	entry: AgentRegistryEntry,
	probe: DetectionProbe,
): Promise<DetectedAgent | null> {
	const distribution = entry.distribution;
	if (distribution === null || distribution.env !== undefined) return null;
	const identity = {
		id: entry.id,
		name: entry.name,
		...(entry.icon === undefined ? {} : { icon: entry.icon }),
	};

	if (distribution.kind === "binary") {
		const path = await probe({ kind: "command", name: baseCommandName(distribution.command) });
		if (path === null) return null;
		return { ...identity, command: path, args: distribution.args, source: "path", detail: path };
	}

	const runnerPath = await probe({
		kind: "globalPackage",
		runner: distribution.kind,
		package: packageName(distribution.package),
	});
	if (runnerPath === null) return null;
	const runnerArgs =
		distribution.kind === "npx" ? ["-y", distribution.package] : [distribution.package];
	return {
		...identity,
		command: runnerPath,
		args: [...runnerArgs, ...(distribution.args ?? [])],
		source: distribution.kind,
		detail: distribution.package,
	};
}

export async function detectAgents(options: DetectAgentsOptions): Promise<DetectedAgent[]> {
	const probe = options.probe ?? systemProbe;
	const registered = new Set(options.catalog.map((entry) => entry.id));
	const published = new Map(options.entries.map((entry) => [entry.id, entry]));

	const detected: DetectedAgent[] = [];
	for (const id of options.shortlist ?? DETECTION_SHORTLIST) {
		if (registered.has(id)) continue;
		const entry = published.get(id);
		if (entry === undefined) continue;
		const row = await detectOne(entry, probe);
		if (row !== null) detected.push(row);
	}
	return detected;
}
