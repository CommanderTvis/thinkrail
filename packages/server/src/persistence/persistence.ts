import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AppConfig,
	DEFAULT_CONFIG,
	isComposerGrowthLimit,
	isJbcentralQuotaRefreshSeconds,
	isLineWidth,
	isTerminalWindowsShell,
	normalizeThemePreference,
	type Project,
	type TerminalAgentRecord,
	type Workspace,
} from "@thinkrail/contracts";
import { pluginStateFile } from "@thinkrail/plugin-api";

export function dataDir(): string {
	return process.env.THINKRAIL_DATA_DIR ?? join(homedir(), ".thinkrail");
}

function readJson<T>(file: string, fallback: T): T {
	try {
		return JSON.parse(readFileSync(join(dataDir(), file), "utf8")) as T;
	} catch {
		return fallback;
	}
}

function writeJson(file: string, value: unknown): void {
	mkdirSync(dataDir(), { recursive: true });
	writeFileSync(join(dataDir(), file), `${JSON.stringify(value, null, "\t")}\n`);
}

export function loadProjects(): Project[] {
	return readJson<Project[]>("projects.json", []);
}

export function saveProjects(projects: Project[]): void {
	writeJson("projects.json", projects);
}

export function loadWorkspaces(): Workspace[] {
	return readJson<Workspace[]>("workspaces.json", []);
}

export function saveWorkspaces(workspaces: Workspace[]): void {
	writeJson("workspaces.json", workspaces);
}

export interface PersistedTerminalTab {
	tabKey: string;
	title: string;
	recorded?: string;
	/** The agent invocation live in this tab at shutdown, so reopening can offer to resume it. */
	agent?: TerminalAgentRecord;
}

export type PersistedTerminalSessions = Record<string, PersistedTerminalTab[]>;

export function loadTerminalSessions(): PersistedTerminalSessions {
	return readJson<PersistedTerminalSessions>("terminals.json", {});
}

export function saveTerminalSessions(sessions: PersistedTerminalSessions): void {
	writeJson("terminals.json", sessions);
}

export function readPluginState<T>(id: string, name: string, fallback: T): T {
	return readJson<T>(pluginStateFile(id, name), fallback);
}

export function writePluginState(id: string, name: string, value: unknown): void {
	mkdirSync(join(dataDir(), "plugin-state", id), { recursive: true });
	writeJson(pluginStateFile(id, name), value);
}

export function loadConfig(): AppConfig {
	const raw = readJson<unknown>("config.json", {});
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return structuredClone(DEFAULT_CONFIG);
	const value = raw as Record<string, unknown>;
	const extensions = { ...value };
	delete extensions.chatMessageOrder;
	delete extensions.layout;
	delete extensions.themeMode;
	delete extensions.systemThemePair;
	return {
		...extensions,
		...normalizeThemePreference(value),
		analyticsEnabled:
			typeof value.analyticsEnabled === "boolean"
				? value.analyticsEnabled
				: DEFAULT_CONFIG.analyticsEnabled,
		analyticsConsentConfirmed: value.analyticsConsentConfirmed === true,
		terminalReplayKb:
			typeof value.terminalReplayKb === "number" && Number.isFinite(value.terminalReplayKb)
				? value.terminalReplayKb
				: DEFAULT_CONFIG.terminalReplayKb,
		composerGrowthLimit: isComposerGrowthLimit(value.composerGrowthLimit)
			? value.composerGrowthLimit
			: DEFAULT_CONFIG.composerGrowthLimit,
		chatLineWidth: isLineWidth(value.chatLineWidth)
			? value.chatLineWidth
			: DEFAULT_CONFIG.chatLineWidth,
		fileLineWidth: isLineWidth(value.fileLineWidth)
			? value.fileLineWidth
			: DEFAULT_CONFIG.fileLineWidth,
		chatLineWidthBounded:
			typeof value.chatLineWidthBounded === "boolean"
				? value.chatLineWidthBounded
				: DEFAULT_CONFIG.chatLineWidthBounded,
		fileLineWidthBounded:
			typeof value.fileLineWidthBounded === "boolean"
				? value.fileLineWidthBounded
				: DEFAULT_CONFIG.fileLineWidthBounded,
		reviewAutoFix:
			typeof value.reviewAutoFix === "boolean" ? value.reviewAutoFix : DEFAULT_CONFIG.reviewAutoFix,
		subagentsEnabled:
			typeof value.subagentsEnabled === "boolean"
				? value.subagentsEnabled
				: DEFAULT_CONFIG.subagentsEnabled,
		editorGpuRendering:
			typeof value.editorGpuRendering === "boolean"
				? value.editorGpuRendering
				: DEFAULT_CONFIG.editorGpuRendering,
		codeFontFamily:
			typeof value.codeFontFamily === "string"
				? value.codeFontFamily
				: DEFAULT_CONFIG.codeFontFamily,
		codeFontLigatures:
			typeof value.codeFontLigatures === "boolean"
				? value.codeFontLigatures
				: DEFAULT_CONFIG.codeFontLigatures,
		jbcentralQuotaEnabled:
			typeof value.jbcentralQuotaEnabled === "boolean"
				? value.jbcentralQuotaEnabled
				: DEFAULT_CONFIG.jbcentralQuotaEnabled,
		jbcentralQuotaRefreshSeconds: isJbcentralQuotaRefreshSeconds(value.jbcentralQuotaRefreshSeconds)
			? value.jbcentralQuotaRefreshSeconds
			: DEFAULT_CONFIG.jbcentralQuotaRefreshSeconds,
		customLayoutPresets: Array.isArray(value.customLayoutPresets)
			? value.customLayoutPresets
			: DEFAULT_CONFIG.customLayoutPresets,
		terminalWindowsShell: isTerminalWindowsShell(value.terminalWindowsShell)
			? value.terminalWindowsShell
			: DEFAULT_CONFIG.terminalWindowsShell,
		hiddenModels: Array.isArray(value.hiddenModels)
			? value.hiddenModels.filter(
					(id): id is string => typeof id === "string" && id.trim().length > 0,
				)
			: DEFAULT_CONFIG.hiddenModels,
		plugins:
			value.plugins &&
			typeof value.plugins === "object" &&
			!Array.isArray(value.plugins) &&
			Object.values(value.plugins).every((ns) => typeof ns === "object" && ns !== null)
				? (value.plugins as AppConfig["plugins"])
				: DEFAULT_CONFIG.plugins,
		pluginPaths: Array.isArray(value.pluginPaths)
			? value.pluginPaths.filter((path): path is string => typeof path === "string")
			: DEFAULT_CONFIG.pluginPaths,
	};
}

export function saveConfig(config: AppConfig): void {
	writeJson("config.json", config);
}

export interface InstallationRecord {
	id: string;
}

export function ensureInstallation(): InstallationRecord {
	const raw = readJson<Partial<InstallationRecord>>("installation.json", {});
	if (typeof raw?.id === "string" && raw.id.length > 0) return { id: raw.id };
	const record: InstallationRecord = { id: randomUUID() };
	writeJson("installation.json", record);
	return record;
}
