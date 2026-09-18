import { expect, test } from "bun:test";
import { useCodexStore } from "./store";

test("token totals and the plan survive pushes that do not carry them", () => {
	const { applyPush } = useCodexStore.getState();
	const base = { workspaceId: "w", tabKey: "t", event: "PostToolUse" } as const;
	applyPush({
		...base,
		status: "running",
		usage: { input: 10, output: 2, cacheRead: 5, cacheWrite: 0 },
		plan: [{ content: "Fix it", status: "in_progress" }],
	});
	applyPush({ ...base, status: "done", event: "Stop" });
	expect(useCodexStore.getState().byWorkspace.w?.t).toEqual({
		status: "done",
		usage: { input: 10, output: 2, cacheRead: 5, cacheWrite: 0 },
		plan: [{ content: "Fix it", status: "in_progress" }],
	});
	applyPush({ ...base, status: "running", plan: [] });
	expect(useCodexStore.getState().byWorkspace.w?.t?.plan).toEqual([]);
});
