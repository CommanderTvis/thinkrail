import { expect, test } from "bun:test";
import { useClaudeCodeStore } from "./store";

test("the session's token usage stands until a newer read replaces it", () => {
	const { applyPush } = useClaudeCodeStore.getState();
	const base = { workspaceId: "w", tabKey: "t" };
	applyPush({
		...base,
		status: "running",
		report: { event: "tool_complete" },
		usage: { input: 4, output: 197, cacheRead: 2000, cacheWrite: 200 },
	});
	applyPush({ ...base, status: null, report: { event: "model_switch", model: "claude-opus-5-5" } });
	expect(useClaudeCodeStore.getState().byWorkspace.w?.t?.usage).toEqual({
		input: 4,
		output: 197,
		cacheRead: 2000,
		cacheWrite: 200,
	});
	applyPush({
		...base,
		status: "done",
		report: { event: "stop" },
		usage: { input: 6, output: 250, cacheRead: 3000, cacheWrite: 200 },
	});
	expect(useClaudeCodeStore.getState().byWorkspace.w?.t?.usage?.output).toBe(250);
});
