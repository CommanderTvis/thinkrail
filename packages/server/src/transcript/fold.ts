import type {
	ChatBlock,
	ChatEvent,
	ChatMessage,
	ConfigOption,
	ConfigSummary,
	MessageId,
	PromptContent,
	SessionRecord,
	SessionUsage,
	ToolCallBlock,
	ToolCallId,
	ToolCallPatch,
	ToolOutput,
	TranscriptCorpusEntry,
	TurnSettlement,
} from "@thinkrail/contracts";
import { isControlMessage, isDurableChatEvent } from "@thinkrail/contracts";
import type { LogEntry, LogHead, LogMessage, LogPart } from "./format";

const MAX_TOOL_TEXT_CHARS = 256 * 1024;

const ABANDONED_BY_TURN = "The turn ended before this tool call finished.";
const ABANDONED_BY_HOST = "The host stopped before this tool call finished.";
const TURN_LOST_TO_HOST = "The host stopped before this turn finished.";

interface ToolSite {
	messageId: MessageId;
	index: number;
}

export interface TranscriptFold {
	readonly head: LogHead;
	messages: ChatMessage[];
	byId: Map<MessageId, ChatMessage>;
	toolSites: Map<ToolCallId, ToolSite>;
	pendingTools: Set<ToolCallId>;
	openAssistant: MessageId | null;
	turnStartedAt: number | null;
	turnOpen: boolean;
	promptCount: number;
	lastSettlement: TurnSettlement | null;
	title: string | null;
	config: ConfigSummary[];
	usage: SessionUsage | null;
	updatedAt: number;
}

export interface PlannedEntry {
	entry: LogEntry;
	durable: boolean;
}

export interface IngestResult {
	entries: PlannedEntry[];
	changed: MessageId[];
}

type Emit = (entry: LogEntry, durable?: boolean) => void;

export function createFold(head: LogHead): TranscriptFold {
	return {
		head,
		messages: [],
		byId: new Map(),
		toolSites: new Map(),
		pendingTools: new Set(),
		openAssistant: null,
		turnStartedAt: null,
		turnOpen: false,
		promptCount: 0,
		lastSettlement: null,
		title: null,
		config: [],
		usage: null,
		updatedAt: head.createdAt,
	};
}

export function replay(head: LogHead, entries: readonly LogEntry[]): TranscriptFold {
	const fold = createFold(head);
	for (const entry of entries) applyEntry(fold, entry);
	return fold;
}

export function recordOf(fold: TranscriptFold): SessionRecord {
	return {
		sessionId: fold.head.sessionId,
		workspaceId: fold.head.workspaceId,
		cwd: fold.head.cwd,
		agentId: fold.head.agentId,
		title: fold.title,
		createdAt: fold.head.createdAt,
		updatedAt: fold.updatedAt,
		messageCount: fold.messages.length,
		promptCount: fold.promptCount,
		lastSettlement: fold.lastSettlement,
		usage: fold.usage,
		config: fold.config,
	};
}

export function deriveCorpus(fold: TranscriptFold): TranscriptCorpusEntry[] {
	const out: TranscriptCorpusEntry[] = [];
	for (const message of fold.messages) {
		if (message.role === "user") {
			if (message.hidden === true) continue;
			const text = plainText(message.content).trim();
			if (text) {
				out.push({ messageId: message.id, role: "user", text, timestamp: message.timestamp });
			}
			continue;
		}
		if (message.role !== "assistant") continue;
		const text = plainText(message.blocks).trim();
		if (text) {
			out.push({ messageId: message.id, role: "assistant", text, timestamp: message.timestamp });
		}
	}
	return out;
}

export function applyEntry(fold: TranscriptFold, entry: LogEntry): MessageId[] {
	switch (entry.t) {
		case "head":
			return [];
		case "msg":
			return applyMessage(fold, entry);
		case "part":
			return applyPart(fold, entry);
		case "tool": {
			const site = fold.toolSites.get(entry.id);
			if (!site) return [];
			const call = toolCallAt(fold, site);
			if (!call) return [];
			mergeToolCall(call, entry.p);
			if (call.status === "pending" || call.status === "running") fold.pendingTools.add(entry.id);
			else fold.pendingTools.delete(entry.id);
			return [site.messageId];
		}
		case "patch": {
			const message = fold.byId.get(entry.id);
			if (message === undefined || message.role !== "assistant") return [];
			if (entry.endedAt !== undefined) {
				message.endedAt = entry.endedAt;
				if (fold.openAssistant === entry.id) fold.openAssistant = null;
			}
			if (entry.superseded !== undefined) message.superseded = entry.superseded;
			return [entry.id];
		}
		case "state": {
			if (entry.title !== undefined) fold.title = entry.title;
			if (entry.config !== undefined) fold.config = entry.config;
			if (entry.usage !== undefined) fold.usage = entry.usage;
			fold.updatedAt = Math.max(fold.updatedAt, entry.ts);
			return [];
		}
	}
}

function applyMessage(fold: TranscriptFold, entry: LogMessage): MessageId[] {
	const seed = cloneMessage(entry.seed);
	const existing = fold.byId.get(seed.id);
	if (existing !== undefined) {
		const position = fold.messages.indexOf(existing);
		if (position >= 0) fold.messages[position] = seed;
		forgetToolsOf(fold, seed.id);
	} else {
		fold.messages.push(seed);
	}
	fold.byId.set(seed.id, seed);
	fold.updatedAt = Math.max(fold.updatedAt, seed.timestamp);

	switch (seed.role) {
		case "user":
			fold.turnStartedAt = seed.timestamp;
			fold.turnOpen = true;
			if (existing === undefined && seed.hidden !== true) fold.promptCount += 1;
			break;
		case "assistant":
			fold.openAssistant = seed.endedAt === undefined ? seed.id : null;
			break;
		case "marker":
			if (seed.marker.kind === "turnSettled") {
				fold.turnOpen = false;
				fold.openAssistant = null;
				fold.lastSettlement = {
					stopReason: seed.marker.stopReason,
					...(seed.marker.error !== undefined ? { error: seed.marker.error } : {}),
				};
			}
			break;
	}
	return [seed.id];
}

function applyPart(fold: TranscriptFold, entry: LogPart): MessageId[] {
	const message = fold.byId.get(entry.id);
	if (message === undefined || message.role === "marker") return [];

	if (message.role === "user") {
		const content = message.content;
		padContent(content, entry.b);
		if (entry.body.k === "chunk") {
			if (entry.body.kind !== "text") return [];
			const existing = content[entry.b];
			if (existing !== undefined && existing.type === "text") existing.text += entry.body.d;
			else content[entry.b] = { type: "text", text: entry.body.d };
			return [entry.id];
		}
		const block = entry.body.block;
		if (block.type === "thinking" || block.type === "toolCall") return [];
		content[entry.b] = clonePromptContent(block);
		return [entry.id];
	}

	const blocks = message.blocks;
	padBlocks(blocks, entry.b);
	if (entry.body.k === "chunk") {
		const existing = blocks[entry.b];
		const kind = entry.body.kind;
		if (existing !== undefined && existing.type === kind) existing.text += entry.body.d;
		else if (kind === "thinking") blocks[entry.b] = { type: "thinking", text: entry.body.d };
		else blocks[entry.b] = { type: "text", text: entry.body.d };
		return [entry.id];
	}

	const block = cloneBlock(entry.body.block);
	blocks[entry.b] = block;
	if (block.type === "toolCall") {
		fold.toolSites.set(block.toolCallId, { messageId: entry.id, index: entry.b });
		if (block.status === "pending" || block.status === "running") {
			fold.pendingTools.add(block.toolCallId);
		} else fold.pendingTools.delete(block.toolCallId);
	}
	return [entry.id];
}

function padBlocks(blocks: ChatBlock[], upTo: number): void {
	while (blocks.length < upTo) blocks.push({ type: "text", text: "" });
}

function padContent(content: PromptContent[], upTo: number): void {
	while (content.length < upTo) content.push({ type: "text", text: "" });
}

function toolCallAt(fold: TranscriptFold, site: ToolSite): ToolCallBlock | undefined {
	const message = fold.byId.get(site.messageId);
	if (message === undefined || message.role !== "assistant") return undefined;
	const block = message.blocks[site.index];
	return block !== undefined && block.type === "toolCall" ? block : undefined;
}

function forgetToolsOf(fold: TranscriptFold, messageId: MessageId): void {
	for (const [toolCallId, site] of [...fold.toolSites]) {
		if (site.messageId !== messageId) continue;
		fold.toolSites.delete(toolCallId);
		fold.pendingTools.delete(toolCallId);
	}
}

function mergeToolCall(call: ToolCallBlock, patch: ToolCallPatch): void {
	if (patch.toolName !== undefined) call.toolName = patch.toolName;
	if (patch.title !== undefined) call.title = patch.title;
	if (patch.kind !== undefined) call.kind = patch.kind;
	if (patch.status !== undefined) call.status = patch.status;
	if (patch.arguments !== undefined) call.arguments = patch.arguments;
	if (patch.locations !== undefined) call.locations = patch.locations;
	if (patch.output !== undefined) call.output = patch.output.map(capToolOutput);
	if (patch.result !== undefined) call.result = patch.result;
	if (patch.error !== undefined) call.error = patch.error;
}

function capToolOutput(item: ToolOutput): ToolOutput {
	if (item.type !== "text" || item.text.length <= MAX_TOOL_TEXT_CHARS) return item;
	return { type: "text", text: item.text.slice(0, MAX_TOOL_TEXT_CHARS), truncated: true };
}

export function ingest(fold: TranscriptFold, event: ChatEvent, now: number): IngestResult {
	const entries: PlannedEntry[] = [];
	const changed = new Set<MessageId>();
	const emit: Emit = (entry, durable = true) => {
		entries.push({ entry, durable });
		for (const id of applyEntry(fold, entry)) changed.add(id);
	};

	if (!isDurableChatEvent(event)) return { entries, changed: [] };

	switch (event.type) {
		case "message_start": {
			const { seed, parts } = splitMessage(event.message);
			emit({ t: "msg", seed });
			for (const part of parts) emit(part);
			break;
		}
		case "message_end":
			emit({ t: "patch", id: event.messageId, endedAt: event.endedAt });
			break;
		case "message_superseded":
			emit({ t: "patch", id: event.messageId, superseded: true });
			break;
		case "chunk":
			emit({
				t: "part",
				id: event.messageId,
				b: event.index,
				body: { k: "chunk", kind: event.kind, d: event.delta },
			});
			break;
		case "block":
			emit({
				t: "part",
				id: event.messageId,
				b: event.index,
				body: { k: "block", block: durableBlock(event.block) },
			});
			break;
		case "tool_call_update": {
			if (!fold.toolSites.has(event.toolCallId)) break;
			const terminal = isTerminalPatch(fold, event.toolCallId, event.patch);
			const { output, ...stable } = event.patch;
			if (Object.keys(stable).length > 0) emit({ t: "tool", id: event.toolCallId, p: stable });
			if (output !== undefined) {
				emit({ t: "tool", id: event.toolCallId, p: { output } }, terminal);
			}
			break;
		}
		case "turn_settled": {
			sweepPendingTools(fold, emit, ABANDONED_BY_TURN);
			closeOpenAssistant(fold, emit, now);
			emit({ t: "msg", seed: withTurnStart(event.message, fold.turnStartedAt) });
			break;
		}
		case "config_options":
			emit({ t: "state", ts: now, config: summarizeConfig(event.options) });
			break;
		case "usage":
			emit({ t: "state", ts: now, usage: event.usage });
			break;
		case "session_info":
			emit({
				t: "state",
				ts: event.updatedAt ?? now,
				...(event.title !== undefined ? { title: event.title } : {}),
			});
			break;
	}

	return { entries, changed: [...changed] };
}

export function repairOnOpen(
	fold: TranscriptFold,
	now: number,
	mintId: () => MessageId,
): PlannedEntry[] {
	const entries: PlannedEntry[] = [];
	if (fold.pendingTools.size === 0 && fold.openAssistant === null && !fold.turnOpen) return entries;
	const emit: Emit = (entry, durable = true) => {
		entries.push({ entry, durable });
		applyEntry(fold, entry);
	};
	sweepPendingTools(fold, emit, ABANDONED_BY_HOST);
	closeOpenAssistant(fold, emit, now);
	if (fold.turnOpen) {
		const startedAt = fold.turnStartedAt;
		emit({
			t: "msg",
			seed: {
				role: "marker",
				id: mintId(),
				timestamp: now,
				marker: {
					kind: "turnSettled",
					stopReason: "failed",
					error: TURN_LOST_TO_HOST,
					...(startedAt !== null ? { startedAt } : {}),
				},
			},
		});
	}
	return entries;
}

function splitMessage(message: ChatMessage): { seed: ChatMessage; parts: LogPart[] } {
	if (message.role === "marker") return { seed: message, parts: [] };
	if (message.role === "user") {
		const hidden = message.hidden ?? isControlMessage(plainText(message.content));
		const seed: ChatMessage = { ...message, hidden, content: [] };
		return { seed, parts: blockParts(message.id, message.content) };
	}
	const seed: ChatMessage = { ...message, blocks: [] };
	return { seed, parts: blockParts(message.id, message.blocks) };
}

function blockParts(id: MessageId, blocks: readonly ChatBlock[]): LogPart[] {
	return blocks.map((block, index) => ({
		t: "part",
		id,
		b: index,
		body: { k: "block", block: durableBlock(block) },
	}));
}

function durableBlock(block: ChatBlock): ChatBlock {
	if (block.type !== "toolCall") return block;
	if (block.status === "done" || block.status === "error" || block.status === "abandoned") {
		return block;
	}
	const { output: _output, ...rest } = block;
	return rest;
}

function withTurnStart(
	message: Extract<ChatEvent, { type: "turn_settled" }>["message"],
	startedAt: number | null,
): ChatMessage {
	if (message.marker.startedAt !== undefined || startedAt === null) return message;
	return { ...message, marker: { ...message.marker, startedAt } };
}

function isTerminalPatch(
	fold: TranscriptFold,
	toolCallId: ToolCallId,
	patch: ToolCallPatch,
): boolean {
	const status = patch.status ?? (fold.pendingTools.has(toolCallId) ? "running" : "done");
	return status === "done" || status === "error" || status === "abandoned";
}

function summarizeConfig(options: readonly ConfigOption[]): ConfigSummary[] {
	const out: ConfigSummary[] = [];
	for (const option of options) {
		if (option.control.type === "toggle") {
			out.push({
				optionId: option.id,
				category: option.category,
				value: option.control.value,
				valueName: option.control.value ? "On" : "Off",
			});
			continue;
		}
		const selected = option.control.value;
		let valueName = selected;
		for (const group of option.control.groups) {
			const choice = group.choices.find((entry) => entry.id === selected);
			if (choice !== undefined) {
				valueName = choice.name;
				break;
			}
		}
		out.push({ optionId: option.id, category: option.category, value: selected, valueName });
	}
	return out;
}

function closeOpenAssistant(fold: TranscriptFold, emit: Emit, now: number): void {
	const id = fold.openAssistant;
	if (id === null) return;
	const message = fold.byId.get(id);
	if (message !== undefined && message.role === "assistant" && message.endedAt === undefined) {
		emit({ t: "patch", id, endedAt: now });
	}
	fold.openAssistant = null;
}

function sweepPendingTools(fold: TranscriptFold, emit: Emit, error: string): void {
	for (const toolCallId of [...fold.pendingTools]) {
		if (!fold.toolSites.has(toolCallId)) {
			fold.pendingTools.delete(toolCallId);
			continue;
		}
		emit({ t: "tool", id: toolCallId, p: { status: "abandoned", error } });
	}
}

function plainText(blocks: readonly ChatBlock[]): string {
	const parts: string[] = [];
	for (const block of blocks) if (block.type === "text") parts.push(block.text);
	return parts.join("\n");
}

function cloneMessage(message: ChatMessage): ChatMessage {
	if (message.role === "user") {
		return { ...message, content: message.content.map(clonePromptContent) };
	}
	if (message.role === "assistant") return { ...message, blocks: message.blocks.map(cloneBlock) };
	return { ...message, marker: { ...message.marker } };
}

function cloneBlock(block: ChatBlock): ChatBlock {
	if (block.type !== "toolCall") return { ...block };
	return {
		...block,
		arguments: { ...block.arguments },
		...(block.locations !== undefined ? { locations: [...block.locations] } : {}),
		...(block.output !== undefined ? { output: [...block.output] } : {}),
	};
}

function clonePromptContent(block: PromptContent): PromptContent {
	return { ...block };
}
