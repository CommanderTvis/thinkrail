import { readFileSync } from "node:fs";
import type { PromptResponse, SessionNotification } from "@agentclientprotocol/sdk";
import type { ChatEvent, PromptContent, SessionId, TokenUsage } from "@thinkrail/contracts";
import type { AssemblerClock, UnknownRecord } from "../translate";
import {
	addTokenUsage,
	asRecord,
	asString,
	SessionAssembler,
	settlementFromError,
	settlementFromResponse,
	toPromptContent,
	toTokenUsage,
} from "../translate";
import type { ClassifiedFrame, FrameDirection, FrameRecord } from "./frames";
import { classifyFrames } from "./frames";

export interface ReplayOptions {
	clock?: AssemblerClock;
}

export function deterministicClock(startedAt = 1_700_000_000_000): AssemblerClock {
	let minted = 0;
	return {
		now: () => startedAt,
		nextId: () => {
			minted += 1;
			return `m${minted}`;
		},
	};
}

function isDirection(value: unknown): value is FrameDirection {
	return value === "in" || value === "out";
}

function toRecord(line: string): FrameRecord | undefined {
	let parsed: UnknownRecord | undefined;
	try {
		parsed = asRecord(JSON.parse(line) as unknown);
	} catch {
		return undefined;
	}
	const raw = asString(parsed?.raw);
	if (parsed === undefined || raw === undefined || !isDirection(parsed.direction)) return undefined;
	return { at: typeof parsed.at === "number" ? parsed.at : 0, direction: parsed.direction, raw };
}

export function readFrameRecords(path: string): FrameRecord[] {
	const out: FrameRecord[] = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (line.trim().length === 0) continue;
		const record = toRecord(line);
		if (record !== undefined) out.push(record);
	}
	return out;
}

function promptContent(prompt: unknown): PromptContent[] {
	const out: PromptContent[] = [];
	if (!Array.isArray(prompt)) return out;
	for (const entry of prompt) {
		const part = toPromptContent(entry);
		if (part !== undefined) out.push(part);
	}
	return out;
}

function requestKey(frame: UnknownRecord): string {
	return String(frame.id);
}

class ReplaySession {
	readonly assembler: SessionAssembler;
	#tokens: TokenUsage | undefined;

	constructor(clock: AssemblerClock) {
		this.assembler = new SessionAssembler(clock);
	}

	addTurnTokens(usage: unknown): void {
		this.#tokens = addTokenUsage(this.#tokens, toTokenUsage(usage));
		this.assembler.setTokens(this.#tokens);
	}
}

export function replayRecords(
	records: readonly FrameRecord[],
	options: ReplayOptions = {},
): ChatEvent[] {
	const clock = options.clock ?? deterministicClock();
	const sessions = new Map<SessionId, ReplaySession>();
	const turns = new Map<string, SessionId>();
	const events: ChatEvent[] = [];

	const session = (sessionId: SessionId): ReplaySession => {
		const existing = sessions.get(sessionId);
		if (existing !== undefined) return existing;
		const created = new ReplaySession(clock);
		sessions.set(sessionId, created);
		return created;
	};

	const startTurn = (frame: UnknownRecord): void => {
		const params = asRecord(frame.params);
		const sessionId = asString(params?.sessionId);
		if (sessionId === undefined) return;
		turns.set(requestKey(frame), sessionId);
		events.push(...session(sessionId).assembler.beginTurn(promptContent(params?.prompt)).events);
	};

	const settleTurn = (frame: UnknownRecord): void => {
		const sessionId = turns.get(requestKey(frame));
		if (sessionId === undefined) return;
		turns.delete(requestKey(frame));
		const state = session(sessionId);
		if (frame.error !== undefined) {
			events.push(...state.assembler.settle(settlementFromError(frame.error)));
			return;
		}
		state.addTurnTokens(asRecord(frame.result)?.usage);
		events.push(...state.assembler.settle(settlementFromResponse(frame.result as PromptResponse)));
	};

	const applyUpdate = (frame: UnknownRecord): void => {
		const params = asRecord(frame.params);
		const sessionId = asString(params?.sessionId);
		if (params === undefined || sessionId === undefined) return;
		events.push(...session(sessionId).assembler.apply(frame.params as SessionNotification));
	};

	const dispatch = (classified: ClassifiedFrame): void => {
		if (classified.method !== "session/prompt" && classified.method !== "session/update") return;
		if (classified.direction === "out" && classified.kind === "request") {
			startTurn(classified.frame);
			return;
		}
		if (classified.direction !== "in") return;
		if (classified.kind === "response") settleTurn(classified.frame);
		else if (classified.kind === "notification") applyUpdate(classified.frame);
	};

	for (const classified of classifyFrames(records)) dispatch(classified);
	return events;
}

export function replayFile(path: string, options: ReplayOptions = {}): ChatEvent[] {
	return replayRecords(readFrameRecords(path), options);
}
