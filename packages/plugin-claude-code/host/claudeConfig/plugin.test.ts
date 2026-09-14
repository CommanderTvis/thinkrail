import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cachedVersion,
	PLUGIN_ID,
	pluginRefreshCommand,
	pluginStatus,
	shippedVersion,
} from "./plugin";

const priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
let configDir: string | null = null;

function isolatedClaudeHome(files: Record<string, unknown>): void {
	configDir = mkdtempSync(join(tmpdir(), "thinkrail-plugin-status-"));
	process.env.CLAUDE_CONFIG_DIR = configDir;
	for (const [relative, content] of Object.entries(files)) {
		const path = join(configDir, relative);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, JSON.stringify(content));
	}
}

afterEach(() => {
	if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
	if (configDir) rmSync(configDir, { recursive: true, force: true });
	configDir = null;
});

test("the refresh is Claude's own install when nothing is cached, its update otherwise", () => {
	expect(pluginRefreshCommand("claude", null)).toEqual([
		"claude",
		"plugin",
		"install",
		PLUGIN_ID,
		"--scope",
		"user",
		"--yes",
	]);
	expect(pluginRefreshCommand("/opt/claude --verbose", "0.1.0")).toEqual([
		"/opt/claude",
		"plugin",
		"update",
		PLUGIN_ID,
		"--scope",
		"user",
	]);
});

test("the installed version is what Claude's cache holds, not the registration stamp", () => {
	isolatedClaudeHome({
		"settings.json": {
			enabledPlugins: { [PLUGIN_ID]: true },
			extraKnownMarketplaces: { thinkrail: { thinkrailVersion: shippedVersion() } },
		},
		"plugins/installed_plugins.json": {
			version: 1,
			plugins: {
				[PLUGIN_ID]: [
					{ scope: "project", version: "0.0.1" },
					{ scope: "user", version: "0.1.0" },
				],
			},
		},
	});
	expect(cachedVersion()).toBe("0.1.0");
	const status = pluginStatus();
	expect(status.state).toBe("outdated");
	expect(status.installedVersion).toBe("0.1.0");
	expect(status.pendingChange).toContain(`plugin update ${PLUGIN_ID}`);
});

test("a registration with no cached copy still has work to do, and names the install", () => {
	isolatedClaudeHome({
		"settings.json": {
			enabledPlugins: { [PLUGIN_ID]: true },
			extraKnownMarketplaces: { thinkrail: { thinkrailVersion: shippedVersion() } },
		},
	});
	const status = pluginStatus();
	expect(status.state).toBe("outdated");
	expect(status.installedVersion).toBe(shippedVersion());
	expect(status.pendingChange).toContain(`plugin install ${PLUGIN_ID}`);
});

test("enabled means registered here and cached at the shipped version", () => {
	isolatedClaudeHome({
		"settings.json": {
			enabledPlugins: { [PLUGIN_ID]: true },
			extraKnownMarketplaces: { thinkrail: { thinkrailVersion: shippedVersion() } },
		},
		"plugins/installed_plugins.json": {
			version: 1,
			plugins: { [PLUGIN_ID]: [{ scope: "user", version: shippedVersion() }] },
		},
	});
	expect(pluginStatus()).toMatchObject({
		state: "enabled",
		installedVersion: shippedVersion(),
		pendingChange: null,
	});
});
