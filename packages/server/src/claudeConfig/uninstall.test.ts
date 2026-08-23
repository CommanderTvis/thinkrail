import { expect, test } from "bun:test";
import { pluginUninstallCommand } from "./uninstall";

test("the command names the plugin, the scope, and answers the prune prompt", () => {
	expect(pluginUninstallCommand("claude", "ponytail@ponytail", "user")).toEqual([
		"claude",
		"plugin",
		"uninstall",
		"ponytail@ponytail",
		"--scope",
		"user",
		"--yes",
	]);
	expect(pluginUninstallCommand("claude", "warp@claude-code-warp", "project")[6]).toBe("--yes");
	expect(pluginUninstallCommand("claude", "warp@claude-code-warp", "local")[5]).toBe("local");
});

test("only the program comes from the launcher's command line — its flags are for a chat, not for this", () => {
	expect(
		pluginUninstallCommand("/opt/tools/claude --dangerously-skip-permissions", "a@b", "user")[0],
	).toBe("/opt/tools/claude");
	expect(pluginUninstallCommand("  claude  ", "a@b", "user")[0]).toBe("claude");
	expect(pluginUninstallCommand("", "a@b", "user")[0]).toBe("claude");
});
