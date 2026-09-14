import { isAbsolute } from "node:path";
import {
	type AppConfig,
	type AppConfigUpdate,
	isCodeFontFamily,
	isJbcentralQuotaRefreshSeconds,
	isLineWidth,
	isSystemThemePair,
	isTerminalWindowsShell,
	isThemeMode,
	LINE_WIDTH_COLUMNS,
	type PluginSettingsNamespace,
} from "@thinkrail/contracts";
import { loadConfig, saveConfig } from "../persistence";
import { normalizeStoredCustomLayoutPresets, validateCustomLayoutPresets } from "./layoutPresets";

type SettingsPublisher = (config: AppConfig) => void;
type RuntimeAppConfigUpdate = AppConfigUpdate & {
	chatMessageOrder?: unknown;
	layout?: unknown;
};

let publishSettings: SettingsPublisher | null = null;

export function setSettingsPublisher(fn: SettingsPublisher | null): void {
	publishSettings = fn;
}

type PluginNamespaceValidator = (
	update: Record<string, PluginSettingsNamespace | null>,
	current: AppConfig["plugins"],
) => AppConfig["plugins"];

/** Merge per namespace, touching only the ids present in the update; `null` resets one back to `{}`. */
function defaultPluginNamespaceMerge(
	update: Record<string, PluginSettingsNamespace | null>,
	current: AppConfig["plugins"],
): AppConfig["plugins"] {
	const merged = { ...current };
	for (const [id, patch] of Object.entries(update)) {
		merged[id] = patch === null ? {} : { ...merged[id], ...patch };
	}
	return merged;
}

let pluginNamespaceValidator: PluginNamespaceValidator = defaultPluginNamespaceMerge;

/** Installed by the plugin loader: validates each touched namespace against its plugin's schema. */
export function setPluginNamespaceValidator(fn: PluginNamespaceValidator | null): void {
	pluginNamespaceValidator = fn ?? defaultPluginNamespaceMerge;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
	if (cached) return cached;
	const loaded = loadConfig();
	const customLayoutPresets = normalizeStoredCustomLayoutPresets(loaded.customLayoutPresets);
	cached = { ...loaded, customLayoutPresets };
	if (JSON.stringify(customLayoutPresets) !== JSON.stringify(loaded.customLayoutPresets)) {
		saveConfig(cached);
	}
	return cached;
}

export function updateConfig(partial: AppConfigUpdate): AppConfig {
	const runtimeUpdate: RuntimeAppConfigUpdate = { ...partial };
	delete runtimeUpdate.chatMessageOrder;
	delete runtimeUpdate.layout;
	for (const [name, value] of [
		["chatLineWidth", runtimeUpdate.chatLineWidth],
		["fileLineWidth", runtimeUpdate.fileLineWidth],
	] as const) {
		if (value !== undefined && !isLineWidth(value)) {
			throw new Error(
				`${name} must be a whole number from ${LINE_WIDTH_COLUMNS.min} to ${LINE_WIDTH_COLUMNS.max}`,
			);
		}
	}
	for (const [name, value] of [
		["chatLineWidthBounded", runtimeUpdate.chatLineWidthBounded],
		["fileLineWidthBounded", runtimeUpdate.fileLineWidthBounded],
		["analyticsEnabled", runtimeUpdate.analyticsEnabled],
		["analyticsConsentConfirmed", runtimeUpdate.analyticsConsentConfirmed],
	] as const) {
		if (value !== undefined && typeof value !== "boolean") {
			throw new Error(`${name} must be a boolean`);
		}
	}
	if (
		runtimeUpdate.analyticsConsentConfirmed !== undefined &&
		runtimeUpdate.analyticsEnabled === undefined
	) {
		throw new Error("analytics consent must include the sharing preference");
	}
	const {
		reviewModel,
		reviewEffort,
		customLayoutPresets,
		subagentsEnabled,
		theme,
		themeMode,
		systemThemePair,
		jbcentralQuotaEnabled,
		jbcentralQuotaRefreshSeconds,
		hiddenModels,
		plugins,
		...rest
	} = runtimeUpdate;
	if (subagentsEnabled !== undefined && typeof subagentsEnabled !== "boolean") {
		throw new Error("subagentsEnabled must be a boolean");
	}
	if (jbcentralQuotaEnabled !== undefined && typeof jbcentralQuotaEnabled !== "boolean") {
		throw new Error("jbcentralQuotaEnabled must be a boolean");
	}
	if (
		runtimeUpdate.hiddenModels !== undefined &&
		(!Array.isArray(runtimeUpdate.hiddenModels) ||
			!runtimeUpdate.hiddenModels.every((item) => typeof item === "string"))
	) {
		throw new Error("hiddenModels must be an array of strings");
	}
	if (
		runtimeUpdate.editorGpuRendering !== undefined &&
		typeof runtimeUpdate.editorGpuRendering !== "boolean"
	) {
		throw new Error("editorGpuRendering must be a boolean");
	}
	if (
		runtimeUpdate.codeFontFamily !== undefined &&
		!isCodeFontFamily(runtimeUpdate.codeFontFamily)
	) {
		throw new Error("codeFontFamily must be a font family name, at most 120 characters");
	}
	if (
		runtimeUpdate.codeFontLigatures !== undefined &&
		typeof runtimeUpdate.codeFontLigatures !== "boolean"
	) {
		throw new Error("codeFontLigatures must be a boolean");
	}
	if (
		runtimeUpdate.terminalWindowsShell !== undefined &&
		!isTerminalWindowsShell(runtimeUpdate.terminalWindowsShell)
	) {
		throw new Error("terminalWindowsShell must be auto, pwsh, powershell, or cmd");
	}
	if (
		jbcentralQuotaRefreshSeconds !== undefined &&
		!isJbcentralQuotaRefreshSeconds(jbcentralQuotaRefreshSeconds)
	) {
		throw new Error("jbcentralQuotaRefreshSeconds must be a whole number from 1 to 3600");
	}
	if (themeMode !== undefined && !isThemeMode(themeMode)) {
		throw new Error("themeMode must be fixed or system");
	}
	if (
		runtimeUpdate.pluginPaths !== undefined &&
		!runtimeUpdate.pluginPaths.every((path) => isAbsolute(path))
	) {
		throw new Error("pluginPaths must be absolute paths");
	}
	if (systemThemePair !== undefined && !isSystemThemePair(systemThemePair)) {
		throw new Error("systemThemePair must contain light and dark theme ids");
	}
	const current = getConfig();
	if (
		runtimeUpdate.analyticsEnabled === true &&
		!current.analyticsEnabled &&
		current.analyticsConsentConfirmed &&
		runtimeUpdate.analyticsConsentConfirmed === undefined
	) {
		throw new Error("enabling additional analytics requires an explicit confirmation");
	}
	const nextThemeMode = themeMode ?? (theme !== undefined ? "fixed" : current.themeMode);
	const nextSystemThemePair =
		systemThemePair === undefined
			? current.systemThemePair
			: { light: systemThemePair.light, dark: systemThemePair.dark };
	if (nextThemeMode === "system" && !nextSystemThemePair) {
		throw new Error("system theme mode requires a complete pair");
	}
	const merged: AppConfig = {
		...current,
		...rest,
		...(theme === undefined ? {} : { theme }),
		themeMode: nextThemeMode,
		...(nextSystemThemePair ? { systemThemePair: nextSystemThemePair } : {}),
		...(subagentsEnabled === undefined ? {} : { subagentsEnabled }),
		...(jbcentralQuotaEnabled === undefined ? {} : { jbcentralQuotaEnabled }),
		...(jbcentralQuotaRefreshSeconds === undefined ? {} : { jbcentralQuotaRefreshSeconds }),
		...(hiddenModels === undefined
			? {}
			: {
					hiddenModels: [...new Set(hiddenModels.map((s) => s.trim()).filter((s) => s.length > 0))],
				}),
	};
	const next: AppConfig = {
		...merged,
		...(customLayoutPresets === undefined
			? {}
			: { customLayoutPresets: validateCustomLayoutPresets(customLayoutPresets) }),
	};
	if (reviewModel !== undefined) {
		if (reviewModel === null) delete next.reviewModel;
		else next.reviewModel = reviewModel;
	}
	if (reviewEffort !== undefined) {
		if (reviewEffort === null) delete next.reviewEffort;
		else next.reviewEffort = reviewEffort;
	}
	if (plugins !== undefined) {
		next.plugins = pluginNamespaceValidator(plugins, next.plugins);
	}
	saveConfig(next);
	cached = next;
	publishSettings?.(next);
	return next;
}

export function resetConfigCache(): void {
	cached = null;
}
