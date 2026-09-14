import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ThinkrailPluginStatus } from "../../contracts";
import { claudeHome } from "./paths";
import { claudeBinary, runPluginCommand } from "./uninstall";

export const MARKETPLACE_NAME = "thinkrail";
export const PLUGIN_ID = "thinkrail@thinkrail";

interface PluginManifest {
	version?: unknown;
}

let assetsRoot: string | null = null;

/** `ctx.assetsDir` for the current activation — dev's own package dir, or the staged dir in a compiled
 * binary/desktop build. Set once at activation; see SPEC.md. */
export function setAssetsRoot(dir: string | null): void {
	assetsRoot = dir;
}

function resolvedAssetsRoot(): string {
	// A caller outside a real activation (a test, `bun-agent-dir` tooling) never sets this — fall back to
	// this module's own package location, the same directory `ctx.assetsDir` resolves to in dev anyway.
	return assetsRoot ?? join(import.meta.dir, "..", "..", "assets");
}

function marketplaceRoot(): string {
	return join(resolvedAssetsRoot(), "marketplace");
}

export function pluginRoot(): string {
	return join(marketplaceRoot(), "claude-plugin");
}

export function shippedVersion(): string {
	try {
		const manifest = JSON.parse(
			readFileSync(join(pluginRoot(), ".claude-plugin", "plugin.json"), "utf8"),
		) as PluginManifest;
		return typeof manifest.version === "string" ? manifest.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function userSettingsPath(): string {
	return join(claudeHome(), "settings.json");
}

function readJsonObject(path: string): Record<string, unknown> | null {
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function readUserSettings(): Record<string, unknown> | null {
	return readJsonObject(userSettingsPath());
}

/** The version Claude Code actually runs: the copy in its plugin cache, as its own install registry names it. */
export function cachedVersion(): string | null {
	const registry = readJsonObject(join(claudeHome(), "plugins", "installed_plugins.json"));
	const plugins = registry?.plugins;
	if (typeof plugins !== "object" || plugins === null) return null;
	const entries = (plugins as Record<string, unknown>)[PLUGIN_ID];
	if (!Array.isArray(entries)) return null;
	const entry = (entries.find((e) => (e as { scope?: unknown })?.scope === "user") ?? entries[0]) as
		| { version?: unknown }
		| undefined;
	return typeof entry?.version === "string" ? entry.version : null;
}

/** The exact argv that brings Claude's cached copy to the shipped version — shown in `pendingChange`. */
export function pluginRefreshCommand(claudeCommand: string, cached: string | null): string[] {
	const base = [claudeBinary(claudeCommand), "plugin"];
	return cached === null
		? [...base, "install", PLUGIN_ID, "--scope", "user", "--yes"]
		: [...base, "update", PLUGIN_ID, "--scope", "user"];
}

function installedVersionFrom(settings: Record<string, unknown>): string | null {
	const enabled = settings.enabledPlugins;
	if (typeof enabled !== "object" || enabled === null) return null;
	if ((enabled as Record<string, unknown>)[PLUGIN_ID] !== true) return null;
	const markets = settings.extraKnownMarketplaces;
	if (typeof markets !== "object" || markets === null) return null;
	const entry = (markets as Record<string, unknown>)[MARKETPLACE_NAME];
	if (typeof entry !== "object" || entry === null) return null;
	const recorded = (entry as { thinkrailVersion?: unknown }).thinkrailVersion;
	return typeof recorded === "string" ? recorded : "0.0.0";
}

/**
 * A registration pointing somewhere else is broken, not installed: Claude Code reports it as a plugin
 * error, and the version alone cannot see it — so it has to read as work still to do.
 */
function registeredElsewhere(settings: Record<string, unknown>): boolean {
	const markets = settings.extraKnownMarketplaces;
	if (typeof markets !== "object" || markets === null) return false;
	const entry = (markets as Record<string, unknown>)[MARKETPLACE_NAME];
	if (typeof entry !== "object" || entry === null) return false;
	const source = (entry as { source?: unknown }).source;
	if (typeof source !== "object" || source === null) return false;
	const path = (source as { path?: unknown }).path;
	return typeof path === "string" && path !== marketplaceRoot();
}

export function pluginStatus(claudeCommand = "claude"): ThinkrailPluginStatus {
	const available = shippedVersion();
	const settings = readUserSettings();
	if (settings === null) {
		return {
			state: "unknown",
			installedVersion: null,
			availableVersion: available,
			pendingChange: null,
		};
	}

	const registered = installedVersionFrom(settings);
	const cached = cachedVersion();
	const change = `${userSettingsPath()}: register marketplace "${MARKETPLACE_NAME}" -> ${marketplaceRoot()}, enable plugin "${PLUGIN_ID}" (v${available}); then ${pluginRefreshCommand(claudeCommand, cached).join(" ")}`;

	if (registered === null) {
		return {
			state: "absent",
			installedVersion: cached,
			availableVersion: available,
			pendingChange: change,
		};
	}
	if (registered !== available || registeredElsewhere(settings) || cached !== available) {
		return {
			state: "outdated",
			installedVersion: cached ?? registered,
			availableVersion: available,
			pendingChange: change,
		};
	}
	return {
		state: "enabled",
		installedVersion: cached,
		availableVersion: available,
		pendingChange: null,
	};
}

let maintainedFor: string | null = null;

/**
 * The status, with a registration the user already approved brought back into line — once per shipped
 * version and activation, so a refresh Claude keeps refusing is not retried on every poll. See SPEC.md.
 */
export async function pluginStatusMaintained(
	claudeCommand: string,
): Promise<ThinkrailPluginStatus> {
	const status = pluginStatus(claudeCommand);
	if (status.state !== "outdated" || maintainedFor === status.availableVersion) return status;
	maintainedFor = status.availableVersion;
	return installPlugin(claudeCommand);
}

async function refreshCache(claudeCommand: string): Promise<void> {
	const cached = cachedVersion();
	if (cached === shippedVersion()) return;
	try {
		await runPluginCommand(
			pluginRefreshCommand(claudeCommand, cached),
			homedir(),
			"plugin refresh",
		);
	} catch {}
}

export async function installPlugin(claudeCommand: string): Promise<ThinkrailPluginStatus> {
	const settings = readUserSettings();
	if (settings === null) return pluginStatus(claudeCommand);

	const markets =
		typeof settings.extraKnownMarketplaces === "object" && settings.extraKnownMarketplaces !== null
			? { ...(settings.extraKnownMarketplaces as Record<string, unknown>) }
			: {};
	markets[MARKETPLACE_NAME] = {
		source: { source: "directory", path: marketplaceRoot() },
		thinkrailVersion: shippedVersion(),
	};

	const enabled =
		typeof settings.enabledPlugins === "object" && settings.enabledPlugins !== null
			? { ...(settings.enabledPlugins as Record<string, unknown>) }
			: {};
	enabled[PLUGIN_ID] = true;

	const next = { ...settings, extraKnownMarketplaces: markets, enabledPlugins: enabled };
	const path = userSettingsPath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
	} catch {
		return pluginStatus(claudeCommand);
	}
	await refreshCache(claudeCommand);
	return pluginStatus(claudeCommand);
}
