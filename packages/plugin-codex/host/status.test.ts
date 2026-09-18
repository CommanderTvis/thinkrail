import { expect, test } from "bun:test";
import { codexEnumValues } from "../configDocs";
import { codexLaunchLine, codexLaunchMenu } from "../launch";
import { parseHookReport } from "./status";

test("a hook payload maps to a status and keeps the facts it carries", () => {
	expect(
		parseHookReport({
			hook_event_name: "UserPromptSubmit",
			session_id: "s1",
			model: "gpt-5",
			prompt: "fix it",
		}),
	).toEqual({
		event: "UserPromptSubmit",
		status: "running",
		sessionId: "s1",
		model: "gpt-5",
		prompt: "fix it",
	});
	expect(parseHookReport({ hook_event_name: "PermissionRequest" })?.status).toBe("blocked");
	expect(parseHookReport({ hook_event_name: "Interrupt" })?.status).toBe("idle");
	expect(parseHookReport({ hook_event_name: "Stop", last_assistant_message: "ok" })).toEqual({
		event: "Stop",
		status: "done",
		lastMessage: "ok",
	});
});

test("unreadable or unknown payloads are ignored", () => {
	expect(parseHookReport(null)).toBeNull();
	expect(parseHookReport({ hook_event_name: "PreCompact" })).toBeNull();
	expect(parseHookReport({})).toBeNull();
});

test("the launch line carries MCP, model, instructions and the prompt in Codex's syntax", () => {
	expect(
		codexLaunchLine("codex", {
			model: "gpt-5",
			systemPrompt: "Be brief.",
			initialPrompt: "it's broken",
			mcp: true,
			windows: false,
		}),
	).toBe(
		`codex -c "mcp_servers.thinkrail.url=\\"$THINKRAIL_MCP_URL\\"" --model gpt-5 -c 'developer_instructions="Be brief."' 'it'\\''s broken'`,
	);
	expect(codexLaunchLine("", { resume: {}, mcp: true, windows: true })).toBe("codex resume --last");
	expect(
		codexLaunchLine("codex", { resume: { sessionId: "abc" }, mcp: false, windows: false }),
	).toBe("codex resume abc");
});

test("a menu preset puts its subcommand first and its flags after the MCP override", () => {
	const presets = codexLaunchMenu(codexEnumValues).flat();
	const find = (id: string) => presets.find((preset) => preset.id === id);
	expect(codexLaunchLine("codex", { preset: find("fork"), mcp: false, windows: false })).toBe(
		"codex fork",
	);
	expect(
		codexLaunchLine("codex", { preset: find("sandbox-read-only"), mcp: true, windows: false }),
	).toBe(`codex -c "mcp_servers.thinkrail.url=\\"$THINKRAIL_MCP_URL\\"" -s read-only`);
	expect(presets.some((preset) => preset.id.startsWith("model_reasoning_effort-"))).toBe(false);
	expect(codexLaunchLine("codex", { preset: find("full-auto"), mcp: true, windows: false })).toBe(
		`codex -c "mcp_servers.thinkrail.url=\\"$THINKRAIL_MCP_URL\\"" --sandbox workspace-write --ask-for-approval on-request`,
	);
	expect(codexLaunchLine("codex", { mcp: false, windows: false, preset: find("yolo") })).toBe(
		"codex --yolo",
	);
});

test("saved permissions apply to ordinary launches and yield to permission presets", () => {
	const presets = codexLaunchMenu(codexEnumValues).flat();
	const options = { mcp: false, windows: false, permissionMode: "yolo" };
	expect(codexLaunchLine("codex", options)).toBe("codex --yolo");
	expect(codexLaunchLine("codex", { ...options, resume: {} })).toBe("codex resume --last --yolo");
	for (const id of ["search", "model-gpt-6-astra", "fork"]) {
		const preset = presets.find((item) => item.id === id);
		expect(codexLaunchLine("codex", { ...options, preset })).toContain("--yolo");
	}
	for (const id of ["sandbox-read-only", "sandbox-workspace-write", "full-auto"]) {
		const preset = presets.find((item) => item.id === id);
		expect(codexLaunchLine("codex", { ...options, preset })).toBe(`codex ${preset?.args}`);
	}
	expect(codexLaunchLine("codex", { ...options, permissionMode: "default" })).toBe("codex");
	expect(codexLaunchLine("codex", { ...options, permissionMode: "unknown" })).toBe("codex");
	expect(codexLaunchLine("codex", { ...options, permissionMode: "full-auto" })).toBe(
		"codex --sandbox workspace-write --ask-for-approval on-request",
	);
});
