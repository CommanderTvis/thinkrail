import type {
	ToolCallStatus as AcpToolCallStatus,
	ToolKind as AcpToolKind,
	ToolCall,
	ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type {
	ToolCallBlock,
	ToolCallLocation,
	ToolCallPatch,
	ToolCallStatus,
	ToolKind,
} from "@thinkrail/contracts";
import { SYNTHETIC_TOOL_NAME_PREFIX } from "@thinkrail/contracts";
import { toToolOutput } from "./content";
import { asArray, asFilledString, asNumber, asRecord, asString, isVariant } from "./guards";

export const TOOL_KINDS: { readonly [K in AcpToolKind]: ToolKind } = {
	read: "read",
	edit: "edit",
	delete: "delete",
	move: "move",
	search: "search",
	execute: "execute",
	think: "think",
	fetch: "fetch",
	switch_mode: "switchMode",
	other: "other",
};

export const TOOL_CALL_STATUSES: { readonly [K in AcpToolCallStatus]: ToolCallStatus } = {
	pending: "pending",
	in_progress: "running",
	completed: "done",
	failed: "error",
};

export function toToolKind(kind: unknown): ToolKind {
	return isVariant(kind, TOOL_KINDS) ? TOOL_KINDS[kind] : "other";
}

export function toToolName(source: { name?: string | null; kind?: unknown }): string {
	return asFilledString(source.name) ?? `${SYNTHETIC_TOOL_NAME_PREFIX}${toToolKind(source.kind)}`;
}

export function toToolStatus(status: unknown): ToolCallStatus {
	return isVariant(status, TOOL_CALL_STATUSES) ? TOOL_CALL_STATUSES[status] : "running";
}

function toArguments(rawInput: unknown): Record<string, unknown> | undefined {
	const raw = asRecord(rawInput);
	return raw === undefined ? undefined : { ...raw };
}

function toLocations(locations: unknown): ToolCallLocation[] {
	const out: ToolCallLocation[] = [];
	for (const entry of asArray(locations)) {
		const raw = asRecord(entry);
		const path = raw === undefined ? undefined : asString(raw.path);
		if (raw === undefined || path === undefined) continue;
		const line = asNumber(raw.line);
		out.push({ path, ...(line !== undefined ? { line } : {}) });
	}
	return out;
}

export function toToolCallBlock(call: ToolCall): ToolCallBlock {
	const args = toArguments(call.rawInput);
	const locations = toLocations(call.locations);
	const output = toToolOutput(call.content);
	return {
		type: "toolCall",
		toolCallId: call.toolCallId,
		toolName: toToolName(call),
		title: call.title,
		kind: toToolKind(call.kind),
		status: toToolStatus(call.status),
		arguments: args ?? {},
		...(locations.length > 0 ? { locations } : {}),
		...(output.length > 0 ? { output } : {}),
		...(call.rawOutput !== undefined ? { result: call.rawOutput } : {}),
	};
}

export function toToolCallPatch(update: ToolCallUpdate): ToolCallPatch {
	const patch: ToolCallPatch = {};
	const title = asString(update.title);
	if (title !== undefined) patch.title = title;
	const name = asFilledString(update.name);
	if (name !== undefined) patch.toolName = name;
	if (update.kind != null) patch.kind = toToolKind(update.kind);
	if (update.status != null) patch.status = toToolStatus(update.status);
	if (update.rawInput !== undefined) {
		const args = toArguments(update.rawInput);
		if (args !== undefined) patch.arguments = args;
	}
	if (update.locations != null) patch.locations = toLocations(update.locations);
	if (update.content != null) patch.output = toToolOutput(update.content);
	if (update.rawOutput !== undefined) patch.result = update.rawOutput;
	return patch;
}

export function synthesizeToolCall(update: ToolCallUpdate): ToolCallBlock {
	const patch = toToolCallPatch(update);
	return {
		type: "toolCall",
		toolCallId: update.toolCallId,
		toolName:
			patch.toolName ??
			toToolName({ ...(update.name != null ? { name: update.name } : {}), kind: update.kind }),
		title: patch.title ?? update.toolCallId,
		kind: patch.kind ?? "other",
		status: patch.status ?? "running",
		arguments: patch.arguments ?? {},
		...(patch.locations !== undefined ? { locations: patch.locations } : {}),
		...(patch.output !== undefined ? { output: patch.output } : {}),
		...(patch.result !== undefined ? { result: patch.result } : {}),
	};
}
