import type { ChatEvent, ToolCallId, ToolCallStatus } from "@thinkrail/contracts";

const TODO_TOOL_PREFIX = "todo_";

const SETTLED: readonly ToolCallStatus[] = ["done", "error", "abandoned"];

const open = new Set<ToolCallId>();

export function isTodoToolEnd(event: ChatEvent): boolean {
	if (event.type === "block") {
		if (event.block.type !== "toolCall") return false;
		if (!event.block.toolName.startsWith(TODO_TOOL_PREFIX)) return false;
		if (!SETTLED.includes(event.block.status)) {
			open.add(event.block.toolCallId);
			return false;
		}
		open.delete(event.block.toolCallId);
		return true;
	}
	if (event.type !== "tool_call_update") return false;
	const named = event.patch.toolName;
	if (named !== undefined && !named.startsWith(TODO_TOOL_PREFIX)) {
		open.delete(event.toolCallId);
		return false;
	}
	if (named !== undefined) open.add(event.toolCallId);
	if (!open.has(event.toolCallId)) return false;
	if (event.patch.status === undefined || !SETTLED.includes(event.patch.status)) return false;
	open.delete(event.toolCallId);
	return true;
}

export function forgetTodoToolCalls(): void {
	open.clear();
}
