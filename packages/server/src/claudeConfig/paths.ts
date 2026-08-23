import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeConfigScope } from "@thinkrail/contracts";

export interface ScopedPath {
	scope: ClaudeConfigScope;
	path: string;
}

export function claudeHome(): string {
	const override = process.env.CLAUDE_CONFIG_DIR;
	return override && override.trim() !== "" ? override : join(homedir(), ".claude");
}

const MANAGED_SETTINGS: Record<string, string> = {
	darwin: "/Library/Application Support/ClaudeCode/managed-settings.json",
	win32: "C:\\Program Files\\ClaudeCode\\managed-settings.json",
};

function managedSettingsPath(): string {
	return MANAGED_SETTINGS[process.platform] ?? "/etc/claude-code/managed-settings.json";
}

const MANAGED_INSTRUCTIONS: Record<string, string> = {
	darwin: "/Library/Application Support/ClaudeCode/CLAUDE.md",
	win32: "C:\\Program Files\\ClaudeCode\\CLAUDE.md",
};

function managedInstructionsPath(): string {
	return MANAGED_INSTRUCTIONS[process.platform] ?? "/etc/claude-code/CLAUDE.md";
}

export function settingsPaths(root: string): ScopedPath[] {
	return [
		{ scope: "managed", path: managedSettingsPath() },
		{ scope: "local", path: join(root, ".claude", "settings.local.json") },
		{ scope: "project", path: join(root, ".claude", "settings.json") },
		{ scope: "user", path: join(claudeHome(), "settings.json") },
	];
}

export function instructionPaths(root: string): ScopedPath[] {
	return [
		{ scope: "managed", path: managedInstructionsPath() },
		{ scope: "user", path: join(claudeHome(), "CLAUDE.md") },
		{ scope: "project", path: join(root, "CLAUDE.md") },
		{ scope: "project", path: join(root, ".claude", "CLAUDE.md") },
		{ scope: "local", path: join(root, "CLAUDE.local.md") },
	];
}

export function rulesDirs(root: string): ScopedPath[] {
	return [
		{ scope: "user", path: join(claudeHome(), "rules") },
		{ scope: "project", path: join(root, ".claude", "rules") },
	];
}

export function mcpPaths(root: string): ScopedPath[] {
	return [{ scope: "project", path: join(root, ".mcp.json") }];
}

/** Follows `CLAUDE_CONFIG_DIR` exactly as Claude Code resolves it — see SPEC.md. */
export function claudeStatePath(): string {
	const override = process.env.CLAUDE_CONFIG_DIR;
	return join(override && override.trim() !== "" ? override : homedir(), ".claude.json");
}

export function skillDirs(root: string): ScopedPath[] {
	return [
		{ scope: "user", path: join(claudeHome(), "skills") },
		{ scope: "project", path: join(root, ".claude", "skills") },
	];
}

export function agentDirs(root: string): ScopedPath[] {
	return [
		{ scope: "user", path: join(claudeHome(), "agents") },
		{ scope: "project", path: join(root, ".claude", "agents") },
	];
}

export function memoryIndexPath(root: string): string {
	return join(claudeHome(), "projects", root.replace(/[^a-zA-Z0-9]/g, "-"), "memory", "MEMORY.md");
}
