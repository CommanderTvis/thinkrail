import { expect, test } from "bun:test";
import { shouldRefreshTodos } from "./useChatTodos";

test("TODO refreshes follow a terminal tool-call status and turn settlement, not a running status", () => {
	expect(
		shouldRefreshTodos({ type: "tool_call_update", toolCallId: "t1", patch: { status: "done" } }),
	).toBe(true);
	expect(
		shouldRefreshTodos({ type: "tool_call_update", toolCallId: "t1", patch: { status: "error" } }),
	).toBe(true);
	expect(
		shouldRefreshTodos({
			type: "tool_call_update",
			toolCallId: "t1",
			patch: { status: "abandoned" },
		}),
	).toBe(true);
	expect(
		shouldRefreshTodos({
			type: "tool_call_update",
			toolCallId: "t1",
			patch: { status: "running" },
		}),
	).toBe(false);
	expect(
		shouldRefreshTodos({
			type: "turn_settled",
			message: {
				role: "marker",
				id: "m1",
				timestamp: 0,
				marker: { kind: "turnSettled", stopReason: "completed" },
			},
		}),
	).toBe(true);
	expect(shouldRefreshTodos({ type: "turn_start" })).toBe(false);
});
