import type { ChatEvent, SessionId, TokenUsage } from "@thinkrail/contracts";
import type { AssemblerClock } from "../translate";
import { addTokenUsage, SessionAssembler, toTokenUsage } from "../translate";

export type EventSink = (events: ChatEvent[]) => void;

export const systemClock: AssemblerClock = {
	now: () => Date.now(),
	nextId: () => crypto.randomUUID(),
};

export class SessionState {
	readonly sessionId: SessionId;
	readonly assembler: SessionAssembler;
	#tokens: TokenUsage | undefined;
	#replay: EventSink | null = null;

	constructor(sessionId: SessionId, clock: AssemblerClock) {
		this.sessionId = sessionId;
		this.assembler = new SessionAssembler(clock);
	}

	addTurnTokens(usage: unknown): void {
		this.#tokens = addTokenUsage(this.#tokens, toTokenUsage(usage));
		this.assembler.setTokens(this.#tokens);
	}

	async divert<T>(sink: EventSink | null, work: () => Promise<T>): Promise<T> {
		this.#replay = sink ?? (() => undefined);
		try {
			return await work();
		} finally {
			this.#replay = null;
		}
	}

	replaySink(): EventSink | null {
		return this.#replay;
	}
}

export class SessionRegistry {
	readonly #clock: AssemblerClock;
	readonly #sessions = new Map<SessionId, SessionState>();

	constructor(clock: AssemblerClock) {
		this.#clock = clock;
	}

	ensure(sessionId: SessionId): SessionState {
		const existing = this.#sessions.get(sessionId);
		if (existing !== undefined) return existing;
		const created = new SessionState(sessionId, this.#clock);
		this.#sessions.set(sessionId, created);
		return created;
	}

	get(sessionId: SessionId): SessionState | undefined {
		return this.#sessions.get(sessionId);
	}

	drop(sessionId: SessionId): void {
		this.#sessions.delete(sessionId);
	}

	clear(): void {
		this.#sessions.clear();
	}
}
