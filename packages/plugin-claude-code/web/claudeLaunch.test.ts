import { describe, expect, test } from "bun:test";
import {
	CLAUDE_LAUNCH_MENU,
	CLAUDE_MODELS,
	claudeLaunchCommand,
	shellQuotePath,
	withLaunchEnv,
} from "./claudeLaunch";

describe("claudeLaunchCommand", () => {
	test("a bare command runs as itself", () => {
		expect(claudeLaunchCommand("claude")).toBe("claude");
	});

	test("preset arguments are appended, not substituted", () => {
		expect(claudeLaunchCommand("claude", "--continue")).toBe("claude --continue");
	});

	test("a configured command line keeps its own flags ahead of the preset's", () => {
		expect(claudeLaunchCommand("claude --model opus", "--continue")).toBe(
			"claude --model opus --continue",
		);
	});

	test("surrounding whitespace never reaches the shell as an empty word", () => {
		expect(claudeLaunchCommand("  claude  ", "  --resume  ")).toBe("claude --resume");
	});

	test("an empty command yields nothing to run rather than a lone flag", () => {
		expect(claudeLaunchCommand("   ", "--continue")).toBe("");
	});
});

describe("shellQuotePath", () => {
	test("an ordinary path is left alone", () => {
		expect(shellQuotePath("/usr/local/bin/claude")).toBe("/usr/local/bin/claude");
		expect(shellQuotePath("~/.claude/local/claude")).toBe("~/.claude/local/claude");
	});

	test("a path with a space becomes one shell word", () => {
		expect(shellQuotePath("/Applications/My Tools/claude")).toBe("'/Applications/My Tools/claude'");
	});

	test("a quote in the path cannot end the quoting", () => {
		expect(shellQuotePath("/opt/o'brien/claude")).toBe(`'/opt/o'\\''brien/claude'`);
	});
});

describe("CLAUDE_LAUNCH_MENU", () => {
	test("every preset is a distinct entry carrying flags", () => {
		const presets = CLAUDE_LAUNCH_MENU.flat();
		expect(new Set(presets.map((preset) => preset.id)).size).toBe(presets.length);
		for (const preset of presets) {
			expect(preset.args.startsWith("--")).toBe(true);
			expect(preset.label.length).toBeGreaterThan(0);
		}
	});
});

test("the launcher's --model presets are built from the same alias list the chip uses", () => {
	const presets = CLAUDE_LAUNCH_MENU.flat().filter((preset) => preset.id.startsWith("model-"));
	expect(presets.map((preset) => preset.args)).toEqual(
		CLAUDE_MODELS.map((model) => `--model ${model.id}`),
	);
});

test("the agent-view variable is set in the syntax of the shell that reads it", () => {
	expect(withLaunchEnv("claude --continue")).toBe(
		"CLAUDE_CODE_DISABLE_AGENT_VIEW=true claude --continue",
	);
	expect(withLaunchEnv("claude", { platform: "Linux" })).toBe(
		"CLAUDE_CODE_DISABLE_AGENT_VIEW=true claude",
	);
	// A POSIX prefix typed into a Windows shell is a command, not a variable.
	expect(withLaunchEnv("claude", { platform: "win32", windowsShell: "cmd" })).toBe(
		'set "CLAUDE_CODE_DISABLE_AGENT_VIEW=true" && claude',
	);
	expect(withLaunchEnv("claude", { platform: "win32", windowsShell: "pwsh" })).toBe(
		"$env:CLAUDE_CODE_DISABLE_AGENT_VIEW='true'; claude",
	);
	// Nothing to launch, nothing to prefix.
	expect(withLaunchEnv("")).toBe("");
});
