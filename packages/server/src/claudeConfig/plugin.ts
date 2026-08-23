import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ThinkrailPluginStatus } from "@thinkrail/contracts";
import { claudeHome } from "./paths";

export const MARKETPLACE_NAME = "thinkrail";
export const PLUGIN_ID = "thinkrail@thinkrail";

interface PluginManifest {
	version?: unknown;
}

export function pluginRoot(): string {
	// A host that flattened this module into one file has no repo above it — deriving the path from
	// `import.meta.dir` there lands inside the app bundle, which is how a marketplace got registered at a
	// path that does not exist. Such a host resolves the real one and hands it down. See apps/desktop/SPEC.md.
	const handed = process.env.THINKRAIL_CLAUDE_PLUGIN_DIR;
	if (handed) return handed;
	return join(import.meta.dir, "..", "..", "..", "claude-plugin");
}

function marketplaceRoot(): string {
	return join(pluginRoot(), "..", "..");
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

function readUserSettings(): Record<string, unknown> | null {
	const path = userSettingsPath();
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

export function pluginStatus(): ThinkrailPluginStatus {
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

	const installed = installedVersionFrom(settings);
	const change = `${userSettingsPath()}: register marketplace "${MARKETPLACE_NAME}" -> ${marketplaceRoot()}, enable plugin "${PLUGIN_ID}" (v${available})`;

	if (installed === null) {
		return {
			state: "absent",
			installedVersion: null,
			availableVersion: available,
			pendingChange: change,
		};
	}
	if (installed !== available || registeredElsewhere(settings)) {
		return {
			state: "outdated",
			installedVersion: installed,
			availableVersion: available,
			pendingChange: change,
		};
	}
	return {
		state: "enabled",
		installedVersion: installed,
		availableVersion: available,
		pendingChange: null,
	};
}

/**
 * The status, with a registration the user already approved brought back into line — see SPEC.md.
 */
export function pluginStatusMaintained(): ThinkrailPluginStatus {
	const status = pluginStatus();
	return status.state === "outdated" ? installPlugin() : status;
}

export function installPlugin(): ThinkrailPluginStatus {
	const settings = readUserSettings();
	if (settings === null) return pluginStatus();

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
		return pluginStatus();
	}
	return pluginStatus();
}
